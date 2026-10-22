/** Money is calculated in integer paise so that totals never drift. The database column is numeric(12,2) rupees. */
export const toPaise = (rupees: number | string): number => Math.round(Number(rupees) * 100);
export const toRupees = (paise: number): number => Number((paise / 100).toFixed(2));
export const formatINR = (rupees: number): string => "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ones = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split(" ");
const tens = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split(" ");
const below100 = (n: number): string => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
const below1000 = (n: number): string => (n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + below100(n % 100) : "") : below100(n));

/** 125050 paise → "One Thousand Two Hundred Fifty Rupees and Fifty Paise Only" (Indian numbering: lakh, crore). */
export function rupeesInWords(totalPaise: number): string {
  let rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  if (rupees === 0 && paise === 0) return "Zero Rupees Only";
  const parts: string[] = [];
  for (const [div, name] of [
    [10000000, "Crore"],
    [100000, "Lakh"],
    [1000, "Thousand"]
  ] as const) {
    const q = Math.floor(rupees / div);
    if (q) parts.push(below1000(q) + " " + name);
    rupees %= div;
  }
  if (rupees) parts.push(below1000(rupees));
  const rupeePart = parts.length ? `${parts.join(" ")} Rupees` : "";
  const paisePart = paise ? `${below100(paise)} Paise` : "";
  return `${[rupeePart, paisePart].filter(Boolean).join(" and ")} Only`;
}

/** Indian financial year of a date: 2026-05-01 → "2026-27", 2026-02-01 → "2025-26". */
export function financialYear(dateStr: string): string {
  // Read the year and month straight from "YYYY-MM-DD": parsing through Date would shift the day in some server timezones.
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  const year = m ? Number(m[1]) : new Date(dateStr).getFullYear();
  const month = m ? Number(m[2]) - 1 : new Date(dateStr).getMonth();
  const y = month >= 3 ? year : year - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
