import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { toPaise } from "../utils/money.js";

export interface NewOrder {
  /** Whole rupees, already validated. */
  amount: number;
  name: string;
  email: string;
  phone: string | null;
  pan: string | null;
}

/** The part of Razorpay the website needs: start a payment (order) and check that the browser's "paid" message is genuine. */
export interface PaymentGateway {
  ready: boolean;
  keyId: string;
  createOrder(order: NewOrder): Promise<{ id: string }>;
  /** Razorpay Checkout signs `order_id|payment_id` with the key secret; only a real payment has a matching signature. */
  verifyPayment(orderId: string, paymentId: string, signature: string): boolean;
}

export function createGateway(env: Pick<Env, "RAZORPAY_KEY_ID" | "RAZORPAY_KEY_SECRET">): PaymentGateway {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: secret } = env;
  return {
    ready: Boolean(keyId && secret),
    keyId,
    async createOrder(order) {
      if (!keyId || !secret) throw new HttpError(503, "Online payment is not configured yet");
      const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
        body: JSON.stringify({
          amount: toPaise(order.amount),
          currency: "INR",
          receipt: `web_${Date.now()}`,
          // The webhook reads these back from the payment to fill the donation and its receipt.
          notes: { name: order.name, email: order.email, phone: order.phone ?? "", pan: order.pan ?? "", source: "website" }
        })
      });
      if (!response.ok) {
        log("error", "razorpay order failed", { status: response.status, body: (await response.text()).slice(0, 300) });
        throw new HttpError(502, "Could not start the payment. Please try again.");
      }
      return (await response.json()) as { id: string };
    },
    verifyPayment(orderId, paymentId, signature) {
      if (!secret) return false;
      const want = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
      return signature.length === want.length && timingSafeEqual(Buffer.from(signature), Buffer.from(want));
    }
  };
}
