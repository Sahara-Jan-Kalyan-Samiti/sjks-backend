import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { emailReceiptForPayment } from "../services/donations.js";
import { isWebsiteDonation, processRazorpayEvent, type RazorpayEvent } from "../services/payments.js";
import { HttpError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

/** True when `signature` is the HMAC-SHA256 of the raw body under `secret` (compared in constant time). */
export function validSignature(raw: Buffer, signature: string, secret: string): boolean {
  const want = createHmac("sha256", secret).update(raw).digest("hex");
  return signature.length === want.length && timingSafeEqual(Buffer.from(signature), Buffer.from(want));
}

/**
 * Razorpay webhook: Dashboard -> Settings -> Webhooks -> https://api.<domain>/api/webhooks/razorpay, same secret as RAZORPAY_WEBHOOK_SECRET.
 * Events: payment.authorized, payment.captured, payment.failed, refund.processed.
 */
export function webhookRoutes({ env, payments, supabase, mailer }: AppDeps): Router {
  const router = Router();
  router.post(
    "/razorpay",
    express.raw({ type: "*/*", limit: "200kb" }),
    asyncHandler(async (req, res) => {
      if (!env.RAZORPAY_WEBHOOK_SECRET) throw new HttpError(503, "Webhook secret not configured");
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (!validSignature(raw, String(req.header("x-razorpay-signature") ?? ""), env.RAZORPAY_WEBHOOK_SECRET)) throw new HttpError(400, "Bad signature");

      let event: RazorpayEvent;
      try {
        event = JSON.parse(raw.toString("utf8")) as RazorpayEvent;
      } catch {
        throw new HttpError(400, "Invalid JSON");
      }
      // Razorpay sends a unique id per delivery; the body hash is the fallback so duplicates are still recognised.
      const eventId = req.header("x-razorpay-event-id") || createHash("sha256").update(raw).digest("hex");
      const outcome = await processRazorpayEvent(payments, eventId, event);
      log("info", "razorpay webhook", { requestId: req.requestId, event: event.event, outcome });

      // Donors who paid through the website form get their receipt as soon as the money is confirmed (payments made through a
      // Razorpay.me link are only recorded). A mail problem must not make Razorpay retry the whole
      // event (the donation is already saved), so it is logged and an admin can resend from the panel.
      const paymentId = event.payload?.payment?.entity?.id;
      if (event.event === "payment.captured" && isWebsiteDonation(event) && paymentId && outcome !== "duplicate" && mailer.ready) {
        try {
          const sent = await emailReceiptForPayment({ supabase, mailer }, paymentId);
          log("info", "donor receipt", { requestId: req.requestId, paymentId, sent });
        } catch (error) {
          log("error", "donor receipt failed", { requestId: req.requestId, paymentId, message: error instanceof Error ? error.message : String(error) });
        }
      }
      res.json({ ok: true, outcome });
    })
  );
  return router;
}
