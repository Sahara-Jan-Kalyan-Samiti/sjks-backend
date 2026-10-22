import { describe, expect, it } from "vitest";
import { canTransition, processRazorpayEvent } from "../src/services/payments.js";
import { MemoryPaymentStore, paymentEvent } from "./helpers.js";

describe("canTransition", () => {
  it("only moves forward", () => {
    expect(canTransition("pending", "success")).toBe(true);
    expect(canTransition("success", "refunded")).toBe(true);
    expect(canTransition("success", "pending")).toBe(false);
    expect(canTransition("refunded", "success")).toBe(false);
    expect(canTransition("failed", "success")).toBe(false);
  });
});

describe("processRazorpayEvent", () => {
  it("creates a donation from a captured payment (amount in rupees)", async () => {
    const store = new MemoryPaymentStore();
    expect(await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"))).toBe("created");
    expect(store.donations[0]).toMatchObject({ status: "success", amount: 1500, mode: "online", donor_name: "Asha", gateway_payment_id: "pay_1" });
  });

  it("ignores the same event delivered twice", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"));
    expect(await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"))).toBe("duplicate");
    expect(store.donations).toHaveLength(1);
  });

  it("does not turn a paid donation back to pending when 'authorized' arrives late", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"));
    expect(await processRazorpayEvent(store, "e2", paymentEvent("payment.authorized", "authorized"))).toBe("ignored_out_of_order");
    expect(store.donations[0].status).toBe("success");
  });

  it("moves pending → success when the capture follows the authorisation", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.authorized", "authorized"));
    expect(store.donations[0].status).toBe("pending");
    expect(await processRazorpayEvent(store, "e2", paymentEvent("payment.captured", "captured"))).toBe("updated");
    expect(store.donations[0].status).toBe("success");
  });

  it("keeps donor details entered by an admin", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.authorized", "authorized"));
    store.donations[0].donor_email = "kept@example.org";
    await processRazorpayEvent(store, "e2", paymentEvent("payment.captured", "captured", { email: "other@example.org" }));
    expect(store.donations[0].donor_email).toBe("kept@example.org");
  });

  it("marks a full refund as refunded and a partial refund only in the notes", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"));
    const refund = (amount: number, id: string) => ({ event: "refund.processed", payload: { refund: { entity: { id, payment_id: "pay_1", amount } } } });

    expect(await processRazorpayEvent(store, "e2", refund(50000, "rfnd_1"))).toBe("partial_refund");
    expect(store.donations[0].status).toBe("success");
    expect(String(store.donations[0].notes)).toContain("Partial refund ₹500.00");

    expect(await processRazorpayEvent(store, "e3", refund(150000, "rfnd_2"))).toBe("updated");
    expect(store.donations[0].status).toBe("refunded");
  });

  it("ignores events that carry no payment", async () => {
    const store = new MemoryPaymentStore();
    expect(await processRazorpayEvent(store, "e1", { event: "order.paid" })).toBe("ignored");
  });

  it("forgets the event when processing fails, so Razorpay's retry is handled", async () => {
    const store = new MemoryPaymentStore();
    store.insertDonation = async () => {
      throw new Error("database down");
    };
    await expect(processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured"))).rejects.toThrow("database down");
    expect(store.events.has("e1")).toBe(false);
  });
});

describe("donor details from the website order", () => {
  it("keeps the PAN and falls back to the e-mail typed on the page", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured", { email: undefined, notes: { name: "Asha", email: "typed@example.org", pan: "abcde1234f" } }));
    expect(store.donations[0]).toMatchObject({ donor_name: "Asha", donor_email: "typed@example.org", donor_pan: "ABCDE1234F" });
  });

  it("ignores a PAN that is not valid", async () => {
    const store = new MemoryPaymentStore();
    await processRazorpayEvent(store, "e1", paymentEvent("payment.captured", "captured", { notes: { name: "Asha", pan: "bad" } }));
    expect(store.donations[0].donor_pan).toBeNull();
  });
});
