import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { emailReceiptForPayment } from "../src/services/donations.js";
import { KEY_SECRET, fakeSupabase, makeDeps, FakeMailer, paymentEvent, sign } from "./helpers.js";

const proof = (orderId = "order_TEST123456", paymentId = "pay_TEST123456") => ({
  order_id: orderId,
  payment_id: paymentId,
  signature: createHmac("sha256", KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex")
});
const paid = {
  id: 7,
  donated_at: "2026-05-01",
  status: "success",
  amount: 500,
  currency: "INR",
  donor_name: "Asha",
  donor_email: "asha@example.org",
  receipt_sent_at: null
};
const form = { amount: 500, name: " Asha Rao ", email: "asha@example.org", pan: "abcde1234f" };

describe("POST /api/public/donations/order", () => {
  it("creates an order for exactly the chosen amount, in paise", async () => {
    const { deps } = makeDeps();
    const res = await request(createApp(deps)).post("/api/public/donations/order").send(form);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ keyId: "rzp_test_key", orderId: "order_TEST123456", amount: 50000, currency: "INR" });
    expect((deps.gateway as unknown as { orders: unknown[] }).orders[0]).toMatchObject({ amount: 500, name: "Asha Rao", pan: "ABCDE1234F" });
  });

  it.each([
    [{ ...form, amount: 0 }],
    [{ ...form, amount: 12.5 }],
    [{ ...form, amount: 20_000_000 }],
    [{ ...form, amount: "500" }],
    [{ ...form, email: "nope" }],
    [{ ...form, name: "" }],
    [{ ...form, pan: "12345" }]
  ])("rejects bad input %#", async (body) => {
    const res = await request(createApp(makeDeps().deps)).post("/api/public/donations/order").send(body);
    expect(res.status).toBe(400);
  });
});

describe("payment proof", () => {
  it("accepts a genuine signature and rejects a forged one", async () => {
    const app = createApp(makeDeps().deps);
    expect((await request(app).post("/api/public/donations/verify").send(proof())).status).toBe(200);
    expect(
      (
        await request(app)
          .post("/api/public/donations/verify")
          .send({ ...proof(), signature: "0".repeat(64) })
      ).status
    ).toBe(400);
  });

  it("shows the receipt only after the webhook saved a successful donation", async () => {
    const query = proof();
    const waiting = await request(createApp(makeDeps({}, { donations: [] }).deps))
      .get("/api/public/donations/receipt")
      .query(query);
    expect(waiting.status).toBe(404);
    const done = await request(createApp(makeDeps({}, { donations: [paid] }).deps))
      .get("/api/public/donations/receipt")
      .query(query);
    expect(done.status).toBe(200);
    expect(done.text).toContain("2026-2027/SJKS-EReceipt/000007");
    expect(done.text).toContain("INR 500.00 only");
    expect(done.text).toContain("01-05-2026");
  });

  it("refuses a receipt for an unpaid donation", async () => {
    const res = await request(createApp(makeDeps({}, { donations: [{ ...paid, status: "pending" }] }).deps))
      .get("/api/public/donations/receipt")
      .query(proof());
    expect(res.status).toBe(404);
  });
});

describe("receipt e-mail after payment", () => {
  it("e-mails the donor once when the payment is captured", async () => {
    const { deps, mailer } = makeDeps({}, { donations: [paid] });
    const body = JSON.stringify(paymentEvent("payment.captured", "captured", { id: "pay_TEST123456", notes: { name: "Asha", source: "website" } }));
    const res = await request(createApp(deps))
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("asha@example.org");
    expect(mailer.sent[0].subject).toContain("2026-2027/SJKS-EReceipt/000007");
  });

  it("leaves payments that did not come from the website form alone (e.g. a Razorpay.me link)", async () => {
    const { deps, mailer, payments } = makeDeps({}, { donations: [paid] });
    const body = JSON.stringify(paymentEvent("payment.captured", "captured", { id: "pay_LINK1", notes: [] }));
    const res = await request(createApp(deps))
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", sign(body))
      .send(body);
    expect(res.status).toBe(200);
    expect(payments.donations).toHaveLength(1); // still recorded
    expect(mailer.sent).toHaveLength(0);
  });

  it("does not e-mail for a failed payment or when already sent", async () => {
    const mailer = new FakeMailer();
    const failed = fakeSupabase({ donations: [{ ...paid, status: "failed" }] }).client;
    expect(await emailReceiptForPayment({ supabase: failed, mailer }, "pay_1")).toBe("skipped");
    const none = fakeSupabase({ donations: [] }).client;
    expect(await emailReceiptForPayment({ supabase: none, mailer }, "pay_1")).toBe("skipped");
    expect(mailer.sent).toHaveLength(0);
  });
});
