import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { formLimiter } from "../middleware/rateLimit.js";
import { createDocumentRequest } from "../services/documentRequests.js";
import { createVolunteer } from "../services/publicContent.js";
import { documentRequestSchema, volunteerSchema } from "../utils/validators.js";

/** Public POST endpoints used by the website forms. Validated, rate-limited, with a honeypot field named "website". */
export function siteFormRoutes({ supabase }: AppDeps): Router {
  const router = Router();

  router.post(
    "/document-requests",
    formLimiter(),
    asyncHandler(async (req, res) => {
      const { website, ...fields } = documentRequestSchema.parse(req.body);
      if (website) return void res.json({ ok: true }); // spam trap: pretend success, store nothing
      res.json({ ok: true, reference: await createDocumentRequest(supabase, fields) });
    })
  );

  router.post(
    "/volunteers",
    formLimiter(),
    asyncHandler(async (req, res) => {
      const { website, ...fields } = volunteerSchema.parse(req.body);
      if (website) return void res.json({ ok: true });
      await createVolunteer(supabase, fields);
      res.json({ ok: true });
    })
  );

  return router;
}
