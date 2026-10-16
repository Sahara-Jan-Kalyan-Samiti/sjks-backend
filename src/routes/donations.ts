import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { logActivity } from "../services/activity.js";
import { renderReceipt, receiptNo, taxEligibility, type DonationRecord } from "../services/receipts.js";
import { toCsv } from "../utils/csv.js";
import { HttpError, notFound } from "../utils/errors.js";
import { idParam, receiptQuerySchema } from "../utils/validators.js";
import { z } from "zod";

const CSV_COLUMNS = ["receipt_no", "donated_at", "mode", "method", "status", "amount", "currency", "donor_name", "donor_email", "donor_pan", "purpose", "reference", "gateway_payment_id"];
const sendReceiptSchema = z.object({ type: z.enum(["tax", "receipt"]).optional() });

/**
 * Receipts and exports. Recording or editing a donation is done by the admin panel directly in Supabase (row-level security allows
 * admins), and the database logs it; the backend only does what needs a secret or an e-mail account.
 */
export function donationRoutes({ supabase, auth, mailer }: AppDeps, options: { exportsOnly?: boolean } = {}): Router {
  const router = Router();
  router.use(requireAuth(auth));

  async function loadDonation(rawId: string): Promise<DonationRecord> {
    const { data, error } = await supabase.from("donations").select("*").eq("id", idParam.parse(rawId)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw notFound("Donation not found");
    return data as DonationRecord;
  }

  if (options.exportsOnly) {
    router.get(
      "/donations.csv",
      requireRole("admin"),
      asyncHandler(async (_req, res) => {
        const { data, error } = await supabase.from("donations").select("*").order("donated_at", { ascending: true }).order("id", { ascending: true }).limit(50000);
        if (error) throw new Error(error.message);
        const rows = ((data ?? []) as DonationRecord[]).map((d) => ({ ...d, receipt_no: receiptNo(d) }));
        res.type("text/csv; charset=utf-8").setHeader("Content-Disposition", 'attachment; filename="donations.csv"');
        res.send(toCsv(CSV_COLUMNS, rows as unknown as Record<string, unknown>[]));
      })
    );
    return router;
  }

  router.get(
    "/:id/receipt",
    requireRole("admin", "editor"),
    asyncHandler(async (req, res) => {
      const donation = await loadDonation(req.params.id);
      const { type } = receiptQuerySchema.parse(req.query);
      const nonce = randomBytes(16).toString("base64");
      res.setHeader("Content-Security-Policy", `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`);
      res.type("html").send(renderReceipt(donation, { tax: type === "tax", forPage: true, nonce }));
    })
  );

  router.post(
    "/:id/send-receipt",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const donation = await loadDonation(req.params.id);
      const wantsTax = sendReceiptSchema.parse(req.body ?? {}).type === "tax";
      if (!donation.donor_email) throw new HttpError(400, "This donation has no donor email");
      const eligibility = taxEligibility(donation);
      if (wantsTax && !eligibility.ok) throw new HttpError(400, eligibility.reason);
      await mailer.send({
        to: donation.donor_email,
        subject: `${wantsTax ? "Tax receipt" : "Donation receipt"} ${receiptNo(donation, wantsTax)}`,
        text: "Thank you for your donation. Your receipt is below.",
        html: renderReceipt(donation, { tax: wantsTax })
      });
      const now = new Date().toISOString();
      await supabase.from("donations").update({ receipt_sent_at: now, ...(wantsTax ? { tax_receipt_issued_at: now } : {}) }).eq("id", donation.id);
      await logActivity(supabase, req.admin!, { action: "emailed", entity: "donations", entityId: donation.id, summary: `Emailed ${wantsTax ? "tax receipt" : "receipt"} for donation #${donation.id}` });
      res.json({ ok: true });
    })
  );

  return router;
}
