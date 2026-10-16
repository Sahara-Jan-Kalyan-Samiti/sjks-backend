import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { orgConfig } from "../config/org.js";
import type { AdminUser } from "../middleware/requireAuth.js";
import { HttpError, notFound } from "../utils/errors.js";
import { logActivity } from "./activity.js";
import type { Mailer } from "./mailer.js";

const BUCKET = "request-files";
const MAX_TOTAL_BYTES = 20_000_000;

interface RequestRow {
  id: number;
  reference: string | null;
  name: string | null;
  email: string;
  document_type: string | null;
}
interface AttachmentRow {
  id: number;
  filename: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
}

/** The text pre-filled in the "send documents" box, from the organisation's template. */
export const defaultMessage = (r: Pick<RequestRow, "name" | "reference" | "document_type">): string =>
  orgConfig.defaultRequestMessage.replace(/{{(\w+)}}/g, (_, key: string) => {
    const values: Record<string, string> = {
      name: r.name || "Sir/Madam",
      org: orgConfig.name,
      reference: r.reference || "",
      document_type: r.document_type || "the requested document"
    };
    return values[key] ?? "";
  });

/** The message to show in the "send documents" box: the one saved earlier, or the organisation's template. */
export async function messageForRequest(supabase: SupabaseClient, id: number): Promise<string> {
  const { data } = await supabase.from("document_requests").select("id, reference, name, email, document_type, admin_message").eq("id", id).maybeSingle();
  if (!data) throw notFound("Request not found");
  return data.admin_message || defaultMessage(data as RequestRow);
}

/**
 * Staff upload the files straight to the private `request-files` bucket from the admin panel. This reads them with the service role,
 * e-mails them to the requester, marks the request as sent and writes the activity log.
 */
export async function sendRequestDocuments(
  { supabase, mailer, admin }: { supabase: SupabaseClient; mailer: Mailer; admin: AdminUser },
  id: number,
  { subject, message }: { subject: string; message: string }
): Promise<void> {
  const { data: request } = await supabase.from("document_requests").select("id, reference, name, email, document_type").eq("id", id).maybeSingle();
  if (!request) throw notFound("Request not found");
  const row = request as RequestRow;

  const { data: rows } = await supabase.from("request_attachments").select("id, filename, storage_path, mime, size_bytes").eq("request_id", id);
  const attachments = (rows ?? []) as AttachmentRow[];
  if (!attachments.length) throw new HttpError(400, "Attach at least one document before sending");
  if (attachments.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0) > MAX_TOTAL_BYTES) {
    throw new HttpError(400, "Attachments exceed 20 MB in total. Remove some or send a download link instead.");
  }

  const files = await Promise.all(
    attachments.map(async (a) => {
      const { data, error } = await supabase.storage.from(BUCKET).download(a.storage_path);
      if (error || !data) throw new Error(`Could not read ${a.filename}: ${error?.message ?? "empty"}`);
      return { filename: a.filename, content: Buffer.from(await data.arrayBuffer()), contentType: a.mime ?? undefined };
    })
  );

  await mailer.send({ to: row.email, subject, text: message, attachments: files });
  await supabase.from("document_requests").update({ status: "sent", sent_at: new Date().toISOString(), admin_message: message }).eq("id", id);
  await logActivity(supabase, admin, {
    action: "emailed",
    entity: "document_requests",
    entityId: id,
    summary: `Sent documents for request ${row.reference ?? "#" + id}`
  });
}

const newReference = () => `REQ-${new Date().getFullYear()}-${randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;

/** A reference nobody else has: the one the website suggested if it looks right and is free, otherwise a new one. */
async function uniqueReference(supabase: SupabaseClient, wanted?: string): Promise<string> {
  let ref = wanted && /^REQ-\d{4}-[A-Z0-9]{6}$/.test(wanted) ? wanted : newReference();
  for (let i = 0; i < 5; i++) {
    const { data } = await supabase.from("document_requests").select("id").eq("reference", ref).limit(1);
    if (!data?.length) return ref;
    ref = newReference();
  }
  return ref;
}

/** Stores a document request from the website form and returns its reference number. */
export async function createDocumentRequest(
  supabase: SupabaseClient,
  { reference, ...fields }: { reference?: string; delivery: string; delivery_address: string | null } & Record<string, unknown>
): Promise<string> {
  const row = {
    ...fields,
    delivery_address: fields.delivery === "PDF by email" ? null : fields.delivery_address,
    reference: await uniqueReference(supabase, reference),
    status: "new"
  };
  const { error } = await supabase.from("document_requests").insert(row);
  if (error) throw new Error(error.message);
  return row.reference;
}
