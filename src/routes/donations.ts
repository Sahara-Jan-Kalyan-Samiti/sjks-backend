import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { emailReceipt, exportDonationsCsv, loadDonation } from "../services/donations.js";
import { canIssueReceipt, renderReceipt } from "../services/receipts.js";
import { HttpError } from "../utils/errors.js";
import { idParam, receiptQuerySchema, sendReceiptSchema } from "../utils/validators.js";

/**
 * Receipts and exports. Recording or editing a donation is done by the admin panel directly in Supabase (row-level security allows
 * admins), and the database logs it; the backend only does what needs a secret or an e-mail account.
 */
export function donationRoutes({ supabase, auth, mailer }: AppDeps, options: { exportsOnly?: boolean } = {}): Router {
  const router = Router();
  router.use(requireAuth(auth));

  if (options.exportsOnly) {
    router.get(
      "/donations.csv",
      requireRole("admin"),
      asyncHandler(async (_req, res) => {
        const csv = await exportDonationsCsv(supabase);
        res.type("text/csv; charset=utf-8").setHeader("Content-Disposition", 'attachment; filename="donations.csv"');
        res.send(csv);
      })
    );
    return router;
  }

  router.get(
    "/:id/receipt",
    requireRole("admin", "editor"),
    asyncHandler(async (req, res) => {
      const donation = await loadDonation(supabase, idParam.parse(req.params.id));
      const { type } = receiptQuerySchema.parse(req.query);
      if (!canIssueReceipt(donation)) throw new HttpError(400, "Only successful donations get a receipt");
      const nonce = randomBytes(16).toString("base64");
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`
      );
      res.type("html").send(renderReceipt(donation, { tax: type === "tax", forPage: true, nonce }));
    })
  );

  router.post(
    "/:id/send-receipt",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const { type } = sendReceiptSchema.parse(req.body ?? {});
      await emailReceipt({ supabase, mailer, admin: req.admin! }, id, type === "tax");
      res.json({ ok: true });
    })
  );

  return router;
}
