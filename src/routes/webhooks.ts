import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { processRazorpayEvent, type RazorpayEvent } from "../services/payments.js";
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
export function webhookRoutes({ env, payments }: AppDeps): Router {
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
      res.json({ ok: true, outcome });
    })
  );
  return router;
}
