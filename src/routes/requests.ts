import { Router } from "express";
import type { AppDeps } from "../app.js";
import { orgConfig } from "../config/org.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { logActivity } from "../services/activity.js";
import { HttpError, notFound } from "../utils/errors.js";
import { idParam, sendRequestSchema } from "../utils/validators.js";

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

/**
 * Document requests. Staff upload the files straight to the private `request-files` bucket from the admin panel; the backend
 * reads them with the service role and e-mails them, then marks the request as sent.
 */
export function requestRoutes({ supabase, auth, mailer }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get(
    "/:id/default-message",
    requireRole("admin", "editor"),
    asyncHandler(async (req, res) => {
      const { data } = await supabase.from("document_requests").select("id, reference, name, email, document_type, admin_message").eq("id", idParam.parse(req.params.id)).maybeSingle();
      if (!data) throw notFound("Request not found");
      res.json({ message: data.admin_message || defaultMessage(data as RequestRow), mailReady: mailer.ready });
    })
  );

  router.post(
    "/:id/send",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const { subject, message } = sendRequestSchema.parse(req.body);
      const { data: request } = await supabase.from("document_requests").select("id, reference, name, email, document_type").eq("id", id).maybeSingle();
      if (!request) throw notFound("Request not found");
      const { data: rows } = await supabase.from("request_attachments").select("id, filename, storage_path, mime, size_bytes").eq("request_id", id);
      const attachments = (rows ?? []) as AttachmentRow[];
      if (!attachments.length) throw new HttpError(400, "Attach at least one document before sending");
      if (attachments.reduce((sum, a) => sum + (a.size_bytes ?? 0), 0) > MAX_TOTAL_BYTES) throw new HttpError(400, "Attachments exceed 20 MB in total. Remove some or send a download link instead.");

      const files = await Promise.all(
        attachments.map(async (a) => {
          const { data, error } = await supabase.storage.from(BUCKET).download(a.storage_path);
          if (error || !data) throw new Error(`Could not read ${a.filename}: ${error?.message ?? "empty"}`);
          return { filename: a.filename, content: Buffer.from(await data.arrayBuffer()), contentType: a.mime ?? undefined };
        })
      );
      await mailer.send({ to: (request as RequestRow).email, subject, text: message, attachments: files });
      await supabase.from("document_requests").update({ status: "sent", sent_at: new Date().toISOString(), admin_message: message }).eq("id", id);
      await logActivity(supabase, req.admin!, { action: "emailed", entity: "document_requests", entityId: id, summary: `Sent documents for request ${(request as RequestRow).reference ?? "#" + id}` });
      res.json({ ok: true });
    })
  );

  return router;
}
