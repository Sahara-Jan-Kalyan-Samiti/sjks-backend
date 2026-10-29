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
  donor_phone?: string | null;
  donor_pan?: string | null;
  donor_address?: string | null;
  purpose?: string | null;
  reference?: string | null;
  gateway_payment_id?: string | null;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** 2026-2027/SJKS-EReceipt/000042. The sequence is the donation id; a tax certificate carries the same number as the receipt. */
export const receiptNo = (d: Pick<DonationRecord, "id" | "donated_at">): string => {
  const start = financialYear(d.donated_at).slice(0, 4);
  return `${start}-${Number(start) + 1}/${orgConfig.receiptPrefix}/${String(d.id).padStart(6, "0")}`;
};

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

const CSS = `body{font-family:"Times New Roman",Times,serif;color:#111;margin:0;background:#f3f5f8}.sheet{max-width:760px;margin:16px auto;background:#fff;border:1px solid #cfd6e2;padding:30px 34px;font-size:15px;line-height:1.5}
.logo{display:block}.reg{text-align:right;margin-top:6px}.addr{text-align:center;margin:2px 0 6px}.rule{border:0;border-top:1px solid #777;margin:6px 0 8px}
.no{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.donor{margin:14px 0 0;line-height:1.6}.recv{margin:22px 0 14px;font-weight:bold;text-align:justify}p{margin:0 0 14px;text-align:justify}
.amt{margin-top:26px}.small{font-size:12px;color:#555;margin-top:18px}.sig{margin-top:30px;text-align:right}.sig img{display:inline-block;margin:6px 0}.bar{max-width:760px;margin:12px auto;text-align:right}
.bar button{padding:8px 16px;background:#1479d1;color:#fff;border:0;border-radius:6px;cursor:pointer}@media print{.bar{display:none}body{background:#fff}.sheet{border:0;margin:0}}`;

export interface RenderOptions {
  /** Kept for callers that ask for the "tax" version: the receipt itself now carries the 80G details whenever the donation qualifies. */
  tax?: boolean;
  /** Full printable page (with a Print button) instead of an e-mail-safe fragment. */
  forPage?: boolean;
  /** CSP nonce for the Print button script, required when forPage is true. */
  nonce?: string;
}

/** "AAHTS0799M" → "AAH TS0799M" (as printed on the Samiti's receipts). */
const spacedPan = (pan: string): string => pan.replace(/^(\w{3})(\w+)$/, "$1 $2");

export function renderReceipt(d: DonationRecord, { forPage = false, nonce = "" }: RenderOptions = {}): string {
  const o = orgConfig;
  const t = o.taxReceipt;
  const r = o.receipt;
  const amount = Number(d.amount);
  const isInr = d.currency === "INR";
  const amountText = isInr ? amount.toLocaleString("en-IN", { minimumFractionDigits: 2 }) : amount.toFixed(2);
  // "One Thousand Rupees Only" → "One Thousand Rupees" (the sentence adds its own "only")
  const sum = isInr ? rupeesInWords(toPaise(amount)).replace(/ Only$/, "") : `${d.currency} ${amountText}`;
  const from = `${esc(d.donor_name || "Well-wisher")}${d.donor_pan ? `, PAN No ${esc(d.donor_pan)}` : ""}`;
  const exemption =
    t.enabled && taxEligibility(d).ok
      ? t.type === "501c3"
        ? `<p>${esc(o.name)} is a tax-exempt organization under Section 501(c)(3)${t.ein ? " (EIN " + esc(t.ein) + ")" : ""}. No goods or services were provided in exchange for this contribution.</p>`
        : `<p>EXEMPTION U/S.80-G OF THE I.T. ACT${t.orderDate ? " order approved on <b>" + esc(t.orderDate) + "</b>" : ""}, 80G Unique Registration Number <b>${esc(t.registrationNo)}</b>, valid ${esc(t.validity)}${t.approvalClause ? ", approved under " + esc(t.approvalClause) : ""}.</p>
<p>PAN NO.: <b>${esc(spacedPan(o.pan))}</b></p>`
      : "";
  const donorLines = [
    ["Name", d.donor_name || "Well-wisher"],
    ["Email", d.donor_email],
    ["Phone", d.donor_phone],
    ["PAN", d.donor_pan],
    ["Address", d.donor_address]
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<b>${k}:</b> ${esc(v)}`)
    .join("<br>");
  const details = [
    [d.method, d.mode].filter(Boolean).join(" / ") && `Mode: ${[d.method, d.mode].filter(Boolean).join(" / ")}`,
    (d.gateway_payment_id || d.reference) && `Ref: ${d.gateway_payment_id || d.reference}`,
    d.purpose && `Purpose: ${d.purpose}`
  ]
    .filter(Boolean)
    .map((x) => esc(x))
    .join(" · ");
  const body = `<div class="sheet"><img class="logo" src="${logoDataUri}" alt="${esc(o.name)}" height="84">
<div class="reg">Regd. No. ${esc(r.regNo)}</div>
<div class="addr">${esc(r.address)}<br>Tel: ${esc(r.phone)} &nbsp; Email: ${esc(r.email)}</div><hr class="rule">
<div class="no"><span><b>Receipt No.</b> ${esc(receiptNo(d))}</span><span><b>Receipt Date:</b> ${esc(formatDate(d.donated_at))}</span></div>
<div class="donor"><b>Donor details</b><br>${donorLines}</div>
<p class="recv">Received with thanks from ${from} the sum of ${isInr ? esc(sum) : esc(sum)} only as donations.</p>
${exemption}
<p class="amt"><b>${esc(isInr ? "INR" : d.currency)} ${esc(amountText)} only</b><br>Subject to realization</p>
<div class="sig">FOR ${esc(o.name.toUpperCase())}<br><img src="${signatureDataUri}" alt="Signature" height="56"><br>${esc(o.signatory)}</div>${details ? `<div class="small">${details}</div>` : ""}</div>`;
  if (!forPage) return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(receiptNo(d))}</title><style>${CSS}</style></head><body><div class="bar"><button id="print">Print / Save as PDF</button></div>${body}<script nonce="${nonce}">document.getElementById("print").addEventListener("click",function(){window.print()})</script></body></html>`;
}
