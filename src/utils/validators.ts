import { z } from "zod";

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

export const isEmail = (v: string): boolean => v.length <= 160 && !v.includes("..") && EMAIL_RE.test(v);

/** Indian mobile (10 digits starting 6-9, optional +91 / 91 / 0 prefix) or an international number with a leading + (8-15 digits). */
export function isPhone(v: string): boolean {
  const s = v.trim();
  if (!/^\+?[\d\s().-]+$/.test(s)) return false;
  const d = s.replace(/\D/g, "");
  if (s.startsWith("+") && !s.startsWith("+91")) return d.length >= 8 && d.length <= 15;
  const n = d.startsWith("91") && d.length === 12 ? d.slice(2) : d.startsWith("0") && d.length === 11 ? d.slice(1) : d;
  return /^[6-9]\d{9}$/.test(n);
}

const text = (max: number) => z.string().trim().max(max);
const required = (label: string, max: number) => text(max).min(1, `${label} is required`);
const optional = (max: number) =>
  text(max)
    .optional()
    .transform((v) => v || null);
const phone = z.string().trim().max(30).refine(isPhone, "Phone number looks invalid");
const email = z.string().trim().refine(isEmail, "Email looks invalid");

export const documentRequestSchema = z
  .object({
    request_type: z.enum(["Certificate", "Audit report"]),
    document_type: required("Document type", 200),
    financial_year: optional(40),
    delivery: text(80)
      .optional()
      .transform((v) => v || "PDF by email"),
    delivery_address: optional(400),
    name: required("Name", 120),
    organisation: optional(160),
    email,
    phone,
    purpose: required("Purpose", 120),
    message: optional(2000),
    reference: text(40).optional(),
    website: z.string().optional() // honeypot: real visitors leave it empty
  })
  .refine((d) => d.delivery === "PDF by email" || !!d.delivery_address, { message: "Postal address is required", path: ["delivery_address"] });

export const volunteerSchema = z.object({
  name: required("Name", 120),
  phone,
  email: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isEmail(v), "Email looks invalid"),
  area: optional(80),
  message: optional(2000),
  website: z.string().optional()
});

export const sendRequestSchema = z.object({ subject: required("Subject", 200), message: required("Message", 5000) });
export const receiptQuerySchema = z.object({ type: z.enum(["tax", "receipt"]).optional() });
export const broadcastSchema = z.object({
  audience: z.enum(["volunteers", "donors", "all"]),
  subject: required("Subject", 200),
  message: required("Message", 5000)
});
export const idParam = z.coerce.number().int().positive();

export const sendReceiptSchema = z.object({ type: z.enum(["tax", "receipt"]).optional() });
export const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isEmail, "Email looks invalid"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
  display_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null)
});
