/**
 * One-off import of the old Node server's SQLite file (server/data.db of the previous project) into Supabase.
 *
 *   npm run migrate:sqlite -- <path-to-data.db>            # dry run: prints what would be copied
 *   npm run migrate:sqlite -- <path-to-data.db> --apply    # really copies (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *
 * Needs Node 22.5 or newer (built-in node:sqlite). Safe to re-run: rows are matched on a natural key and skipped when they exist.
 * NOT migrated on purpose: admin_users (passwords: create the staff in Supabase Auth instead), activity_log (history of the old server),
 * and uploaded files (copy server/uploads and server/storage/requests into the Supabase Storage buckets by hand).
 */
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";

const [, , dbPath, flag] = process.argv;
if (!dbPath) {
  console.error("Usage: npm run migrate:sqlite -- <path-to-data.db> [--apply]");
  process.exit(1);
}
const apply = flag === "--apply";
const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[];
const bool = (v: unknown) => v === 1 || v === true || v === "1";

interface Plan {
  table: string;
  /** Column(s) that identify a row, to skip rows that were already copied. */
  key: string[];
  rows: Record<string, unknown>[];
}

const plans: Plan[] = [
  {
    table: "projects",
    key: ["name", "created_at"],
    rows: all("SELECT * FROM projects").map((r) => ({
      name: r.name,
      area: r.area,
      location: r.location,
      description: r.description,
      status: r.status,
      beneficiaries: r.beneficiaries ?? 0,
      published: bool(r.published),
      created_at: r.created_at
    }))
  },
  {
    table: "volunteers",
    key: ["name", "phone", "created_at"],
    rows: all("SELECT * FROM volunteers").map((r) => ({
      name: r.name,
      phone: r.phone,
      email: r.email,
      area: r.area,
      message: r.message,
      status: r.status,
      created_at: r.created_at
    }))
  },
  {
    table: "events",
    key: ["title", "event_date"],
    rows: all("SELECT * FROM events").map((r) => ({
      title: r.title,
      event_date: r.event_date,
      event_time: r.event_time,
      place: r.place,
      description: r.description,
      published: bool(r.published),
      created_at: r.created_at
    }))
  },
  {
    table: "document_requests",
    key: ["reference"],
    rows: all("SELECT * FROM document_requests").map((r) => ({
      reference: r.reference,
      request_type: r.request_type,
      document_type: r.document_type,
      financial_year: r.financial_year,
      delivery: r.delivery ?? "PDF by email",
      delivery_address: r.delivery_address,
      name: r.name,
      organisation: r.organisation,
      email: r.email,
      phone: r.phone,
      purpose: r.purpose,
      message: r.message,
      status: r.status,
      admin_message: r.admin_message,
      sent_at: r.sent_at,
      completed_at: r.completed_at,
      created_at: r.created_at
    }))
  },
  {
    // amount is stored as rupees with two decimals in Supabase; rounding removes the floating-point noise of the old REAL column
    table: "donations",
    key: ["donor_name", "donated_at", "amount", "reference"],
    rows: all("SELECT * FROM donations").map((r) => ({
      donated_at: r.donated_at,
      mode: r.mode,
      method: r.method,
      status: r.status,
      amount: Math.round(Number(r.amount) * 100) / 100,
      currency: r.currency,
      donor_name: r.donor_name,
      donor_email: r.donor_email,
      donor_phone: r.donor_phone,
      donor_pan: r.donor_pan,
      donor_address: r.donor_address,
      purpose: r.purpose,
      reference: r.reference,
      notes: r.notes,
      gateway: r.gateway,
      gateway_payment_id: r.gateway_payment_id,
      gateway_order_id: r.gateway_order_id,
      gateway_status: r.gateway_status,
      gateway_error: r.gateway_error,
      receipt_sent_at: r.receipt_sent_at,
      tax_receipt_issued_at: r.tax_receipt_issued_at,
      created_at: r.created_at
    }))
  },
  {
    table: "broadcasts",
    key: ["subject", "created_at"],
    rows: all("SELECT * FROM broadcasts").map((r) => ({
      audience: r.audience,
      subject: r.subject,
      body: r.body,
      recipients: r.recipients ?? 0,
      failed: r.failed ?? 0,
      created_at: r.created_at
    }))
  }
];

console.log(`${apply ? "APPLY" : "DRY RUN"}: ${dbPath}`);
for (const p of plans) console.log(`  ${p.table.padEnd(20)} ${p.rows.length} row(s)`);

if (!apply) {
  console.log("\nNothing was written. Add --apply to copy the rows.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

for (const p of plans) {
  let copied = 0;
  let skipped = 0;
  for (const row of p.rows) {
    let query = supabase.from(p.table).select("id").limit(1);
    for (const k of p.key) query = row[k] == null ? query.is(k, null) : query.eq(k, row[k] as string);
    const { data: found, error: findError } = await query;
    if (findError) throw new Error(`${p.table}: ${findError.message}`);
    if (found?.length) {
      skipped++;
      continue;
    }
    const { error } = await supabase.from(p.table).insert(row);
    if (error) throw new Error(`${p.table}: ${error.message} (row: ${JSON.stringify(row).slice(0, 200)})`);
    copied++;
  }
  console.log(`  ${p.table.padEnd(20)} copied ${copied}, already there ${skipped}`);
}
console.log("\nDone. Next: create the staff users in Supabase Auth, copy the uploaded files to Storage, then compare the counts above with the admin panel.");
