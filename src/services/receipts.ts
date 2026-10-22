import { orgConfig } from "../config/org.js";
import { logoDataUri, signatureDataUri } from "../config/receiptAssets.js";
import { financialYear, rupeesInWords, toPaise } from "../utils/money.js";

export interface DonationRecord {
  id: number;
  donated_at: string;
  status: string;
  amount: number | string;
  currency: string;
  method?: string | null;
  mode?: string | null;
  donor_name?: string | null;
  donor_email?: string | null;
  donor_pan?: string | null;
  donor_address?: string | null;
  purpose?: string | null;
  reference?: string | null;
  gateway_payment_id?: string | null;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** SJKS/2026-27/00042 (tax certificates: SJKS/TAX/2026-27/00042). The sequence is the donation id. */
export const receiptNo = (d: Pick<DonationRecord, "id" | "donated_at">, tax = false): string =>
  `${orgConfig.receiptPrefix}/${tax ? "TAX/" : ""}${financialYear(d.donated_at)}/${String(d.id).padStart(5, "0")}`;

/** "2026-04-01" → "01-04-2026" (the database column is a plain date). */
export const formatDate = (iso: string): string => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("-") : iso);

/** A receipt acknowledges money received, so only successful donations get one (pending, failed and refunded ones do not). */
export const canIssueReceipt = (d: Pick<DonationRecord, "status">): boolean => d.status === "success";

/** Is a tax certificate allowed for this donation? */
export function taxEligibility(d: DonationRecord): { ok: boolean; reason: string } {
  const t = orgConfig.taxReceipt;
  if (!t.enabled) return { ok: false, reason: "Tax receipts are switched off in src/config/org.json" };
  if (d.status !== "success") return { ok: false, reason: "Only successful donations can get a tax certificate" };
  if (t.type === "80G" && d.currency === "INR" && /cash/i.test(d.method || "") && Number(d.amount) > t.cashLimit)
    return { ok: false, reason: `Cash donations above ₹${t.cashLimit} are not eligible for 80G deduction` };
  return { ok: true, reason: "" };
}

const CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#1d2433;margin:0;background:#f3f5f8}.sheet{max-width:760px;margin:16px auto;background:#fff;border:1px solid #cfd6e2;padding:28px}
h1{font-size:20px;margin:0}h2{font-size:16px;margin:18px 0 6px;text-align:center;text-transform:uppercase;letter-spacing:.04em}.muted{color:#5c6679;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:10px}td{padding:7px 8px;border:1px solid #d9dfea;font-size:13px;vertical-align:top}td.k{width:34%;background:#f6f8fb;font-weight:bold}
table.head{margin:0 0 4px}table.head td{border:0;padding:0 12px 0 0}td.logo{width:1%;white-space:nowrap}.sig img{display:inline-block;margin:6px 0}.note{margin-top:14px;font-size:12px;line-height:1.5}.sig{margin-top:40px;text-align:right;font-size:13px}.bar{max-width:760px;margin:12px auto;text-align:right}
.bar button{padding:8px 16px;background:#1479d1;color:#fff;border:0;border-radius:6px;cursor:pointer}@media print{.bar{display:none}body{background:#fff}.sheet{border:0;margin:0}}`;

export interface RenderOptions {
  tax?: boolean;
  /** Full printable page (with a Print button) instead of an e-mail-safe fragment. */
  forPage?: boolean;
  /** CSP nonce for the Print button script, required when forPage is true. */
  nonce?: string;
}

export function renderReceipt(d: DonationRecord, { tax = false, forPage = false, nonce = "" }: RenderOptions = {}): string {
  const o = orgConfig;
  const t = o.taxReceipt;
  const isTax = tax && taxEligibility(d).ok;
  const row = (k: string, v: unknown) => (v ? `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>` : "");
  const amount = Number(d.amount);
  const amountText = d.currency === "INR" ? `₹ ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : `${d.currency} ${amount.toFixed(2)}`;
  const statement = !isTax
    ? "This receipt acknowledges the donation received with thanks."
    : t.type === "501c3"
      ? `${esc(o.name)} is a tax-exempt organization under Section 501(c)(3)${t.ein ? " (EIN " + esc(t.ein) + ")" : ""}. No goods or services were provided in exchange for this contribution.`
      : `Donation is eligible for deduction under Section 80G of the Income-tax Act, 1961 (Approval/Registration No. ${esc(t.registrationNo)}, valid ${esc(t.validity)}), subject to applicable rules. ${t.section12A ? "Section 12A Reg. No. " + esc(t.section12A) + "." : ""}`;
  const heading = isTax ? (t.type === "501c3" ? "Donation Tax Receipt" : "Donation Certificate (Section 80G)") : "Donation Receipt";
  const body = `<div class="sheet"><table class="head"><tr><td class="logo"><img src="${logoDataUri}" alt="${esc(o.name)}" height="64"></td><td class="org"><h1>${esc(o.name)}</h1><div class="muted">${esc(o.address)}<br>${esc(o.email)} · ${esc(o.phone)} · PAN ${esc(o.pan)}</div></td></tr></table>
<h2>${heading}</h2>
<table>${row("Receipt No.", receiptNo(d, isTax))}${row("Date of donation", formatDate(d.donated_at))}${row("Received from", d.donor_name || "Well-wisher")}${isTax || d.donor_pan ? row("Donor PAN", d.donor_pan) : ""}${row("Address", d.donor_address)}${row("Email", d.donor_email)}
${row("Amount", amountText)}${d.currency === "INR" ? row("Amount in words", rupeesInWords(toPaise(amount))) : ""}${row("Mode of payment", [d.method, d.mode].filter(Boolean).join(" / "))}${row("Payment reference", d.gateway_payment_id || d.reference)}${row("Purpose", d.purpose)}</table>
<p class="note">${statement}</p><div class="sig">For ${esc(o.name)}<br><img src="${signatureDataUri}" alt="Signature" height="56"><br>${esc(o.signatory)}</div></div>`;
  if (!forPage) return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(receiptNo(d, isTax))}</title><style>${CSS}</style></head><body><div class="bar"><button id="print">Print / Save as PDF</button></div>${body}<script nonce="${nonce}">document.getElementById("print").addEventListener("click",function(){window.print()})</script></body></html>`;
}
