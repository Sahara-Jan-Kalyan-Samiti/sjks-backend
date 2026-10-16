import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminUser } from "../middleware/requireAuth.js";
import { toCsv } from "../utils/csv.js";
import { HttpError, notFound } from "../utils/errors.js";
import { logActivity } from "./activity.js";
import type { Mailer } from "./mailer.js";
import { receiptNo, renderReceipt, taxEligibility, type DonationRecord } from "./receipts.js";

const CSV_COLUMNS = [
  "receipt_no",
  "donated_at",
  "mode",
  "method",
  "status",
  "amount",
  "currency",
  "donor_name",
  "donor_email",
  "donor_pan",
  "purpose",
  "reference",
  "gateway_payment_id"
];
const EXPORT_LIMIT = 50_000;

/** One donation by id, or a 404. */
export async function loadDonation(supabase: SupabaseClient, id: number): Promise<DonationRecord> {
  const { data, error } = await supabase.from("donations").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw notFound("Donation not found");
  return data as DonationRecord;
}

/** Every donation as CSV text, oldest first, with its receipt number. */
export async function exportDonationsCsv(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from("donations")
    .select("*")
    .order("donated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(EXPORT_LIMIT);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as DonationRecord[]).map((d) => ({ ...d, receipt_no: receiptNo(d) }));
  return toCsv(CSV_COLUMNS, rows as unknown as Record<string, unknown>[]);
}

/** E-mails the receipt (or the 80G tax certificate) to the donor, marks it as sent and writes the activity log. */
export async function emailReceipt(
  { supabase, mailer, admin }: { supabase: SupabaseClient; mailer: Mailer; admin: AdminUser },
  donationId: number,
  wantsTax: boolean
): Promise<void> {
  const donation = await loadDonation(supabase, donationId);
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
  await supabase
    .from("donations")
    .update({ receipt_sent_at: now, ...(wantsTax ? { tax_receipt_issued_at: now } : {}) })
    .eq("id", donation.id);
  await logActivity(supabase, admin, {
    action: "emailed",
    entity: "donations",
    entityId: donation.id,
    summary: `Emailed ${wantsTax ? "tax receipt" : "receipt"} for donation #${donation.id}`
  });
}
