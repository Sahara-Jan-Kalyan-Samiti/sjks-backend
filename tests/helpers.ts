import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppDeps } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import type { AdminUser, Authenticator } from "../src/middleware/requireAuth.js";
import type { Mailer, MailOptions } from "../src/services/mailer.js";
import { DuplicateDonationError, type DonationInsert, type PaymentDonation, type PaymentStore } from "../src/services/payments.js";

export const WEBHOOK_SECRET = "test-webhook-secret";

export const testEnv = () =>
  parseEnv({
    NODE_ENV: "test",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40),
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CORS_ORIGINS: "https://www.saharangosag.com"
  });

/** In-memory PaymentStore: same behaviour as the Supabase one, including the unique constraints. */
export class MemoryPaymentStore implements PaymentStore {
  events = new Map<string, { event_type: string; donation_id?: number }>();
  donations: (PaymentDonation & Record<string, unknown>)[] = [];
  private nextId = 1;

  async recordEvent(e: { event_id: string; event_type: string }) {
    if (this.events.has(e.event_id)) return "duplicate" as const;
    this.events.set(e.event_id, { event_type: e.event_type });
    return "new" as const;
  }
  async forgetEvent(id: string) {
    this.events.delete(id);
  }
  async linkEvent(id: string, donationId: number) {
    const e = this.events.get(id);
    if (e) e.donation_id = donationId;
  }
  async findDonationByPaymentId(paymentId: string) {
    return this.donations.find((d) => d.gateway_payment_id === paymentId) ?? null;
  }
  async insertDonation(row: DonationInsert) {
    if (this.donations.some((d) => d.gateway_payment_id === row.gateway_payment_id)) throw new DuplicateDonationError("duplicate");
    const created = { ...row, id: this.nextId++ } as unknown as PaymentDonation & Record<string, unknown>;
    this.donations.push(created);
    return created;
  }
  async updateDonation(id: number, patch: Record<string, unknown>) {
    Object.assign(
      this.donations.find((d) => d.id === id)!,
      patch
    );
  }
}

export class FakeMailer implements Mailer {
  ready = true;
  sent: MailOptions[] = [];
  async send(options: MailOptions) {
    this.sent.push(options);
  }
}

export const admins: Record<string, AdminUser> = {
  "admin-token": { id: "u1", email: "admin@example.org", label: "Admin", role: "admin" },
  "editor-token": { id: "u2", email: "editor@example.org", label: "Editor", role: "editor" },
  "viewer-token": { id: "u3", email: "viewer@example.org", label: "Viewer", role: "viewer" }
};
export const fakeAuth: Authenticator = { verify: async (token) => admins[token] ?? null };

/** A Supabase stand-in with canned table rows. It records inserts and updates; reads return the rows given for that table. */
export function fakeSupabase(tables: Record<string, unknown[]> = {}, files: Record<string, string> = {}) {
  const inserts: { table: string; row: unknown }[] = [];
  const updates: { table: string; patch: unknown }[] = [];
  const createdUsers: string[] = [];
  const chain = (table: string, single = false): unknown =>
    new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve({ data: single ? ((tables[table] ?? [])[0] ?? null) : (tables[table] ?? []), error: null });
        }
        if (prop === "insert")
          return (row: unknown) => {
            inserts.push({ table, row });
            return chain(table, single);
          };
        if (prop === "update")
          return (patch: unknown) => {
            updates.push({ table, patch });
            return chain(table, single);
          };
        if (prop === "maybeSingle" || prop === "single") return () => chain(table, true);
        return () => chain(table, single);
      }
    });
  const client = {
    from: (table: string) => chain(table),
    storage: {
      from: () => ({
        download: async (path: string) => (path in files ? { data: new Blob([files[path]]), error: null } : { data: null, error: { message: "not found" } })
      })
    },
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          createdUsers.push(email);
          return { data: { user: { id: "new-user" } }, error: null };
        },
        deleteUser: async () => ({ error: null })
      }
    }
  } as unknown as SupabaseClient;
  return { client, inserts, updates, createdUsers };
}

export function makeDeps(overrides: Partial<AppDeps> = {}, tables: Record<string, unknown[]> = {}, files: Record<string, string> = {}) {
  const payments = new MemoryPaymentStore();
  const mailer = new FakeMailer();
  const sb = fakeSupabase(tables, files);
  const deps: AppDeps = { env: testEnv(), supabase: sb.client, auth: fakeAuth, payments, mailer, ...overrides };
  return { deps, payments, mailer, inserts: sb.inserts, updates: sb.updates, createdUsers: sb.createdUsers };
}

export const sign = (body: string, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

export const paymentEvent = (event: string, status: string, over: Record<string, unknown> = {}) => ({
  event,
  payload: {
    payment: {
      entity: {
        id: "pay_1",
        status,
        amount: 150000,
        currency: "INR",
        method: "upi",
        email: "donor@example.org",
        contact: "+919876543210",
        created_at: 1786000000,
        notes: { name: "Asha" },
        ...over
      }
    }
  }
});
