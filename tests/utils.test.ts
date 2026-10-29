import { describe, expect, it } from "vitest";
import { receiptNo, renderReceipt, taxEligibility, type DonationRecord } from "../src/services/receipts.js";
import { csvCell, toCsv } from "../src/utils/csv.js";
import { financialYear, formatINR, rupeesInWords, toPaise, toRupees } from "../src/utils/money.js";
import { isEmail, isPhone } from "../src/utils/validators.js";

describe("money", () => {
  it("converts without floating-point drift", () => {
    expect(toPaise("1499.99")).toBe(149999);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toRupees(149999)).toBe(1499.99);
  });
  it("formats rupees", () => expect(formatINR(125000)).toBe("₹1,25,000.00"));
  it("writes amounts in words using lakh and crore", () => {
    expect(rupeesInWords(toPaise(1500))).toBe("One Thousand Five Hundred Rupees Only");
    expect(rupeesInWords(toPaise(125050.5))).toBe("One Lakh Twenty Five Thousand Fifty Rupees and Fifty Paise Only");
    expect(rupeesInWords(toPaise(20000000))).toBe("Two Crore Rupees Only");
    expect(rupeesInWords(0)).toBe("Zero Rupees Only");
  });
  it("finds the Indian financial year", () => {
    expect(financialYear("2026-05-01")).toBe("2026-27");
    expect(financialYear("2026-02-01")).toBe("2025-26");
  });
});

describe("csv", () => {
  it("blocks spreadsheet formula injection and escapes quotes", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it("builds rows in column order", () => expect(toCsv(["a", "b"], [{ b: 2, a: 1 }])).toBe(`a,b\n"1","2"`));
});

describe("validators", () => {
  it("checks e-mail and phone numbers", () => {
    expect(isEmail("info@saharangosag.com")).toBe(true);
    expect(isEmail("a..b@example.com")).toBe(false);
    expect(isPhone("+91 98765 43210")).toBe(true);
    expect(isPhone("5876543210")).toBe(false);
  });
});

describe("receipts", () => {
  const donation: DonationRecord = {
    id: 42,
    donated_at: "2026-05-01",
    status: "success",
    amount: 1500,
    currency: "INR",
    method: "UPI",
    donor_name: "Asha <script>"
  };

  it("numbers receipts by financial year and donation id", () => {
    expect(receiptNo(donation)).toBe("2026-2027/SJKS-EReceipt/000042");
    expect(receiptNo({ ...donation, donated_at: "2027-02-10" })).toBe("2026-2027/SJKS-EReceipt/000042");
  });
  it("refuses a tax certificate for unsuccessful or large cash donations", () => {
    expect(taxEligibility(donation).ok).toBe(true);
    expect(taxEligibility({ ...donation, status: "pending" }).ok).toBe(false);
    expect(taxEligibility({ ...donation, method: "Cash", amount: 5000 }).ok).toBe(false);
  });
  it("escapes donor-supplied text", () => {
    const html = renderReceipt(donation);
    expect(html).toContain("Asha &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("puts the CSP nonce on the print script of the full page", () => {
    expect(renderReceipt(donation, { forPage: true, nonce: "abc" })).toContain('<script nonce="abc">');
  });
});
