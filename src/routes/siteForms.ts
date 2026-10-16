import { randomBytes } from "node:crypto";
import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { formLimiter } from "../middleware/rateLimit.js";
import { documentRequestSchema, volunteerSchema } from "../utils/validators.js";

const newReference = () => `REQ-${new Date().getFullYear()}-${randomBytes(4).toString("hex").slice(0, 6).toUpperCase()}`;

async function uniqueReference(supabase: SupabaseClient, wanted?: string): Promise<string> {
  let ref = wanted && /^REQ-\d{4}-[A-Z0-9]{6}$/.test(wanted) ? wanted : newReference();
  for (let i = 0; i < 5; i++) {
    const { data } = await supabase.from("document_requests").select("id").eq("reference", ref).limit(1);
    if (!data?.length) return ref;
    ref = newReference();
  }
  return ref;
}

/** Public POST endpoints used by the website forms. Validated, rate-limited, with a honeypot field named "website". */
export function siteFormRoutes({ supabase }: AppDeps): Router {
  const router = Router();

  router.post(
    "/document-requests",
    formLimiter(),
    asyncHandler(async (req, res) => {
      const { website, reference, ...fields } = documentRequestSchema.parse(req.body);
      if (website) return void res.json({ ok: true }); // spam trap: pretend success, store nothing
      const row = {
        ...fields,
        delivery_address: fields.delivery === "PDF by email" ? null : fields.delivery_address,
        reference: await uniqueReference(supabase, reference),
        status: "new"
      };
      const { error } = await supabase.from("document_requests").insert(row);
      if (error) throw new Error(error.message);
      res.json({ ok: true, reference: row.reference });
    })
  );

  router.post(
    "/volunteers",
    formLimiter(),
    asyncHandler(async (req, res) => {
      const { website, ...fields } = volunteerSchema.parse(req.body);
      if (website) return void res.json({ ok: true });
      const { error } = await supabase.from("volunteers").insert({ ...fields, status: "pending" });
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    })
  );

  return router;
}
