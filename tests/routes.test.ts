import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { parseEnv } from "../src/config/env.js";
import { makeDeps } from "./helpers.js";

const admin = { Authorization: "Bearer admin-token" };
const editor = { Authorization: "Bearer editor-token" };

const donation = { id: 42, donated_at: "2026-05-01", status: "success", amount: 1500, currency: "INR", method: "UPI", donor_name: "Asha <b>Rao</b>", donor_email: "asha@example.org", donor_pan: "ABCDE1234F", purpose: "Education" };

describe("readiness", () => {
  it("answers /ready when the database answers", async () => {
    const res = await request(createApp(makeDeps().deps)).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
  });
});

describe("environment", () => {
  const base = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "x".repeat(40) };
  it("refuses to start in production without the webhook secret or CORS list", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/RAZORPAY_WEBHOOK_SECRET[\s\S]*CORS_ORIGINS/);
    expect(parseEnv({ ...base, NODE_ENV: "production", RAZORPAY_WEBHOOK_SECRET: "s", CORS_ORIGINS: "https://a.example" }).CORS_ORIGINS).toEqual(["https://a.example"]);
  });
  it("is relaxed in development", () => {
    expect(parseEnv({ ...base, NODE_ENV: "development" }).RAZORPAY_WEBHOOK_SECRET).toBe("");
  });
});

describe("public data", () => {
  it("returns published events with full image URLs and a short cache", async () => {
    const events = [{ id: 7, title: "Health camp", event_date: "2026-06-01", event_time: null, place: "Sagar", description: null, images: [{ id: 1, path: "a/b.jpg" }] }];
    const res = await request(createApp(makeDeps({}, { v_public_events: events }).deps)).get("/api/public/events");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("max-age=60");
    expect(res.body).toEqual([
      { id: "db-7", title: "Health camp", date: "2026-06-01", place: "Sagar", text: "", images: ["https://example.supabase.co/storage/v1/object/public/event-images/a/b.jpg"] }
    ]);
  });
  it("prefixes project ids", async () => {
    const res = await request(createApp(makeDeps({}, { v_public_projects: [{ id: 3, title: "Solar" }] }).deps)).get("/api/public/projects");
    expect(res.body).toEqual([{ id: "db-3", title: "Solar" }]);
  });
});

describe("document request form", () => {
  const body = { request_type: "Certificate", document_type: "80G certificate", name: "Ravi", email: "ravi@example.org", phone: "9876543210", purpose: "Tax filing" };
  it("stores a request and returns its reference", async () => {
    const { deps, inserts } = makeDeps();
    const res = await request(createApp(deps)).post("/api/public/document-requests").send(body);
    expect(res.status).toBe(200);
    expect(res.body.reference).toMatch(/^REQ-\d{4}-[A-Z0-9]{6}$/);
    expect(inserts[0]).toMatchObject({ table: "document_requests", row: { status: "new", delivery: "PDF by email", delivery_address: null } });
  });
  it("asks for a postal address when the document is posted", async () => {
    const res = await request(createApp(makeDeps().deps)).post("/api/public/document-requests").send({ ...body, delivery: "Post" });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("delivery_address");
  });
});

describe("receipts", () => {
  it("shows a receipt page to an editor with a strict CSP, escaping donor text", async () => {
    const res = await request(createApp(makeDeps({}, { donations: [donation] }).deps)).get("/api/donations/42/receipt").set(editor);
    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'none'.*script-src 'nonce-/);
    expect(res.text).toContain("Asha &lt;b&gt;Rao&lt;/b&gt;");
    expect(res.text).not.toContain("<b>Rao</b>");
  });
  it("answers 404 for a missing donation and 400 for a bad id", async () => {
    const app = createApp(makeDeps().deps);
    expect((await request(app).get("/api/donations/42/receipt").set(editor)).status).toBe(404);
    expect((await request(app).get("/api/donations/abc/receipt").set(editor)).status).toBe(400);
  });
  it("e-mails a receipt, marks it sent and refuses an editor", async () => {
    const { deps, mailer, updates, inserts } = makeDeps({}, { donations: [donation] });
    const app = createApp(deps);
    expect((await request(app).post("/api/donations/42/send-receipt").set(editor).send({})).status).toBe(403);
    const res = await request(app).post("/api/donations/42/send-receipt").set(admin).send({ type: "tax" });
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: "asha@example.org", subject: expect.stringContaining("Tax receipt") });
    expect(updates[0]).toMatchObject({ table: "donations", patch: { receipt_sent_at: expect.any(String), tax_receipt_issued_at: expect.any(String) } });
    expect(inserts.some((i) => i.table === "activity_log")).toBe(true);
  });
  it("will not issue a tax certificate for a failed donation", async () => {
    const res = await request(createApp(makeDeps({}, { donations: [{ ...donation, status: "failed" }] }).deps)).post("/api/donations/42/send-receipt").set(admin).send({ type: "tax" });
    expect(res.status).toBe(400);
  });
  it("needs a donor e-mail address", async () => {
    const res = await request(createApp(makeDeps({}, { donations: [{ ...donation, donor_email: null }] }).deps)).post("/api/donations/42/send-receipt").set(admin).send({});
    expect(res.status).toBe(400);
  });
});

describe("CSV export", () => {
  it("gives an administrator a file with receipt numbers, safe against formulas", async () => {
    const rows = [{ ...donation, donor_name: "=HYPERLINK(1)" }];
    const res = await request(createApp(makeDeps({}, { donations: rows }).deps)).get("/api/exports/donations.csv").set(admin);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("donations.csv");
    expect(res.text).toContain("00042");
    expect(res.text).toContain(`"'=HYPERLINK(1)"`);
  });
});

describe("document e-mail", () => {
  const row = { id: 5, reference: "REQ-2026-ABC123", name: "Ravi", email: "ravi@example.org", document_type: "80G certificate", admin_message: null };
  it("pre-fills the message", async () => {
    const res = await request(createApp(makeDeps({}, { document_requests: [row] }).deps)).get("/api/requests/5/default-message").set(editor);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("Ravi");
    expect(res.body.mailReady).toBe(true);
  });
  it("sends the attached files and marks the request sent", async () => {
    const attachments = [{ id: 1, filename: "cert.pdf", storage_path: "5/cert.pdf", mime: "application/pdf", size_bytes: 10 }];
    const { deps, mailer, updates } = makeDeps({}, { document_requests: [row], request_attachments: attachments }, { "5/cert.pdf": "PDFDATA" });
    const res = await request(createApp(deps)).post("/api/requests/5/send").set(admin).send({ subject: "Your certificate", message: "Attached." });
    expect(res.status).toBe(200);
    expect(mailer.sent[0].to).toBe("ravi@example.org");
    expect(mailer.sent[0].attachments?.[0]).toMatchObject({ filename: "cert.pdf", contentType: "application/pdf" });
    expect(updates[0]).toMatchObject({ table: "document_requests", patch: { status: "sent" } });
  });
  it("refuses to send without an attachment", async () => {
    const res = await request(createApp(makeDeps({}, { document_requests: [row] }).deps)).post("/api/requests/5/send").set(admin).send({ subject: "Hi", message: "Hello" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Attach at least one/);
  });
  it("validates the subject and message", async () => {
    const res = await request(createApp(makeDeps({}, { document_requests: [row] }).deps)).post("/api/requests/5/send").set(admin).send({ subject: "", message: "x" });
    expect(res.status).toBe(400);
  });
});

describe("broadcast", () => {
  it("sends in BCC to unique addresses and records the result", async () => {
    const tables = { volunteers: [{ email: "A@example.org" }, { email: "b@example.org" }], donations: [{ donor_email: "a@example.org" }] };
    const { deps, mailer, inserts } = makeDeps({}, tables);
    const res = await request(createApp(deps)).post("/api/broadcast").set(admin).send({ audience: "all", subject: "News", message: "Hello" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 2, failed: 0 });
    expect(mailer.sent[0].bcc).toEqual(["a@example.org", "b@example.org"]);
    expect(mailer.sent[0].to).toBeUndefined();
    expect(inserts.some((i) => i.table === "broadcasts")).toBe(true);
  });
  it("refuses an empty audience", async () => {
    const res = await request(createApp(makeDeps().deps)).post("/api/broadcast").set(admin).send({ audience: "donors", subject: "News", message: "Hello" });
    expect(res.status).toBe(400);
  });
  it("rejects an unknown audience", async () => {
    const res = await request(createApp(makeDeps().deps)).post("/api/broadcast").set(admin).send({ audience: "everyone", subject: "News", message: "Hello" });
    expect(res.status).toBe(400);
  });
});

describe("staff accounts", () => {
  it("creates an account and its admin profile", async () => {
    const { deps, createdUsers, inserts } = makeDeps({}, { admin_profiles: [{ id: "new-user", role: "admin" }] });
    const res = await request(createApp(deps)).post("/api/admins").set(admin).send({ email: "New@Example.org", password: "longenough1", display_name: "New Person" });
    expect(res.status).toBe(201);
    expect(createdUsers).toEqual(["new@example.org"]);
    expect(inserts.find((i) => i.table === "admin_profiles")?.row).toMatchObject({ id: "new-user", role: "admin", is_active: true });
  });
});
