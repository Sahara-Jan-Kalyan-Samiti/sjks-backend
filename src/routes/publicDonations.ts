import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { formLimiter } from "../middleware/rateLimit.js";
import { findDonationByPayment } from "../services/donations.js";
import { canIssueReceipt, renderReceipt } from "../services/receipts.js";
import { HttpError } from "../utils/errors.js";
import { toPaise } from "../utils/money.js";
import { donationOrderSchema, paymentProofSchema } from "../utils/validators.js";

/**
 * Website donations through Razorpay Checkout.
 * 1. POST /donations/order   creates a Razorpay order for the amount and returns what Checkout needs.
 * 2. The donor pays in the Checkout popup. Razorpay then calls the webhook, which records the donation and e-mails the receipt.
 * 3. POST /donations/verify  lets the page confirm the payment is genuine (the webhook stays the source of truth).
 * 4. GET  /donations/receipt opens the receipt for the donor who holds the signed payment proof.
 */
export function publicDonationRoutes({ gateway, supabase }: AppDeps): Router {
  const router = Router();

  router.post(
    "/donations/order",
    formLimiter(10),
    asyncHandler(async (req, res) => {
      const body = donationOrderSchema.parse(req.body);
      const order = await gateway.createOrder(body);
      res.json({ keyId: gateway.keyId, orderId: order.id, amount: toPaise(body.amount), currency: "INR" });
    })
  );

  router.post(
    "/donations/verify",
    formLimiter(30),
    asyncHandler(async (req, res) => {
      const p = paymentProofSchema.parse(req.body);
      if (!gateway.verifyPayment(p.order_id, p.payment_id, p.signature)) throw new HttpError(400, "Payment could not be verified");
      res.json({ ok: true });
    })
  );

  router.get(
    "/donations/receipt",
    formLimiter(30),
    asyncHandler(async (req, res) => {
      const p = paymentProofSchema.parse(req.query);
      if (!gateway.verifyPayment(p.order_id, p.payment_id, p.signature)) throw new HttpError(400, "Payment could not be verified");
      const donation = await findDonationByPayment(supabase, p.payment_id);
      // The webhook can arrive a few seconds after the browser callback.
      if (!donation || !canIssueReceipt(donation)) throw new HttpError(404, "Your receipt is still being prepared. Please try again in a minute.");
      const nonce = randomBytes(16).toString("base64");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`
      );
      res.type("html").send(renderReceipt(donation, { forPage: true, nonce }));
    })
  );

  return router;
}
