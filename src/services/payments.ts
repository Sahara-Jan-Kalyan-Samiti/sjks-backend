import { formatINR, toPaise, toRupees } from "../utils/money.js";

export type DonationStatus = "pending" | "success" | "failed" | "refunded" | "cancelled";

export interface PaymentDonation {
  id: number;
  status: DonationStatus;
  amount: number;
  donor_name?: string | null;
  donor_email?: string | null;
  donor_phone?: string | null;
  donor_pan?: string | null;
  notes?: string | null;
}
export type DonationInsert = Record<string, unknown> & { gateway_payment_id: string };

/** The few database operations the payment logic needs. The Supabase version is in paymentStore.ts; tests use an in-memory one. */
export interface PaymentStore {
  /** Stores the provider event id; "duplicate" if this exact event was already received. */
  recordEvent(event: { provider: string; event_id: string; event_type: string; payload: unknown }): Promise<"new" | "duplicate">;
  forgetEvent(eventId: string): Promise<void>;
  linkEvent(eventId: string, donationId: number): Promise<void>;
  findDonationByPaymentId(paymentId: string): Promise<PaymentDonation | null>;
  /** Throws DuplicateDonationError if a row with this gateway_payment_id already exists (two webhooks racing). */
  insertDonation(row: DonationInsert): Promise<PaymentDonation>;
  updateDonation(id: number, patch: Record<string, unknown>): Promise<void>;
}
export class DuplicateDonationError extends Error {}

interface RazorpayPayment {
  id: string;
  status: string;
  amount: number;
  currency?: string;
  order_id?: string | null;
  method?: string;
  email?: string;
  contact?: string;
  created_at?: number;
  error_description?: string | null;
  /** Set by the website when it creates the order (see gateway.ts); an empty array when Razorpay has none. */
  notes?: { name?: string; email?: string; phone?: string; pan?: string; source?: string } | unknown[];
}
interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
}
export interface RazorpayEvent {
  event: string;
  payload?: { payment?: { entity?: RazorpayPayment }; refund?: { entity?: RazorpayRefund } };
}

export type Outcome = "created" | "updated" | "partial_refund" | "ignored" | "ignored_out_of_order" | "duplicate";

const STATUS_FROM_RAZORPAY: Record<string, DonationStatus> = {
  captured: "success",
  authorized: "pending",
  created: "pending",
  failed: "failed",
  refunded: "refunded"
};

/**
 * A payment only moves forward: pending → success → refunded (or pending → failed).
 * A late "authorized" event arriving after "captured" must never turn a paid donation back into pending.
 */
export function canTransition(from: DonationStatus, to: DonationStatus): boolean {
  if (from === to) return true;
  if (from === "pending") return to === "success" || to === "failed" || to === "refunded";
  if (from === "success") return to === "refunded";
  return false; // failed, refunded and cancelled are final
}

const isoDate = (unixSeconds?: number): string => new Date((unixSeconds ?? Date.now() / 1000) * 1000).toISOString().slice(0, 10);

export async function processRazorpayEvent(store: PaymentStore, eventId: string, evt: RazorpayEvent): Promise<Outcome> {
  const stored = await store.recordEvent({ provider: "razorpay", event_id: eventId, event_type: evt.event, payload: evt });
  if (stored === "duplicate") return "duplicate";
  try {
    return await apply(store, evt, eventId);
  } catch (error) {
    // Forget the event so that Razorpay's automatic retry is processed instead of being skipped as a duplicate.
    await store.forgetEvent(eventId).catch(() => undefined);
    throw error;
  }
}

async function apply(store: PaymentStore, evt: RazorpayEvent, eventId: string): Promise<Outcome> {
  const payment = evt.payload?.payment?.entity;
  const refund = evt.payload?.refund?.entity;

  if (evt.event === "refund.processed" && refund?.payment_id) return applyRefund(store, refund, eventId);
  if (!payment?.id) return "ignored";

  const next: DonationStatus = STATUS_FROM_RAZORPAY[payment.status] ?? "pending";
  const existing = await store.findDonationByPaymentId(payment.id);
  if (!existing) return create(store, payment, next, eventId);
  return update(store, existing, payment, next, eventId);
}

/** True for a payment started from the website donate form (it tags its payments with source "website"); false for Razorpay.me links and the like. */
export function isWebsiteDonation(evt: RazorpayEvent): boolean {
  const notes = evt.payload?.payment?.entity?.notes;
  return !Array.isArray(notes) && notes?.source === "website";
}

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** Name, e-mail and PAN the donor typed on the website, read back from the payment's notes. */
function donorNotes(payment: RazorpayPayment): { name: string | null; email: string | null; pan: string | null } {
  const n = Array.isArray(payment.notes) ? {} : (payment.notes ?? {});
  const pan = String(n.pan ?? "").trim().toUpperCase();
  return { name: n.name ? String(n.name).slice(0, 120) : null, email: n.email ? String(n.email).slice(0, 160) : null, pan: PAN_RE.test(pan) ? pan : null };
}

function newRow(payment: RazorpayPayment, status: DonationStatus): DonationInsert {
  const note = donorNotes(payment);
  return {
    mode: "online",
    gateway: "Razorpay",
    gateway_payment_id: payment.id,
    gateway_order_id: payment.order_id ?? null,
    gateway_status: payment.status,
    status,
    amount: toRupees(payment.amount),
    currency: payment.currency || "INR",
    method: payment.method || "Razorpay",
    donated_at: isoDate(payment.created_at),
    gateway_error: payment.error_description ?? null,
    donor_email: payment.email ?? note.email,
    donor_phone: payment.contact ?? null,
    donor_name: note.name,
    donor_pan: note.pan
  };
}

async function create(store: PaymentStore, payment: RazorpayPayment, status: DonationStatus, eventId: string): Promise<Outcome> {
  try {
    const row = await store.insertDonation(newRow(payment, status));
    await store.linkEvent(eventId, row.id);
    return "created";
  } catch (error) {
    if (!(error instanceof DuplicateDonationError)) throw error;
    const existing = await store.findDonationByPaymentId(payment.id); // another webhook created it a moment ago
    if (!existing) throw error;
    return update(store, existing, payment, status, eventId);
  }
}

async function update(store: PaymentStore, existing: PaymentDonation, payment: RazorpayPayment, next: DonationStatus, eventId: string): Promise<Outcome> {
  await store.linkEvent(eventId, existing.id);
  if (!canTransition(existing.status, next)) return "ignored_out_of_order";
  const patch: Record<string, unknown> = { status: next, gateway_status: payment.status, gateway_error: payment.error_description ?? null };
  // Donor details entered by an admin are kept; only blanks are filled from the payment.
  if (!existing.donor_email && payment.email) patch.donor_email = payment.email;
  if (!existing.donor_phone && payment.contact) patch.donor_phone = payment.contact;
  const note = donorNotes(payment);
  if (!existing.donor_name && note.name) patch.donor_name = note.name;
  if (!existing.donor_pan && note.pan) patch.donor_pan = note.pan;
  await store.updateDonation(existing.id, patch);
  return "updated";
}

async function applyRefund(store: PaymentStore, refund: RazorpayRefund, eventId: string): Promise<Outcome> {
  const donation = await store.findDonationByPaymentId(refund.payment_id);
  if (!donation) return "ignored";
  await store.linkEvent(eventId, donation.id);
  if (refund.amount >= toPaise(donation.amount)) {
    if (!canTransition(donation.status, "refunded")) return "ignored_out_of_order";
    await store.updateDonation(donation.id, { status: "refunded", gateway_status: "refunded" });
    return "updated";
  }
  // Partial refund: the donation stays successful and the amount refunded is recorded in its notes.
  const line = `Partial refund ${formatINR(toRupees(refund.amount))} (${refund.id})`;
  const notes = [donation.notes, line].filter(Boolean).join("\n").slice(0, 500);
  await store.updateDonation(donation.id, { notes });
  return "partial_refund";
}
