import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { messageForRequest, sendRequestDocuments } from "../services/documentRequests.js";
import { idParam, sendRequestSchema } from "../utils/validators.js";

/** Document requests: the message to pre-fill, and e-mailing the attached documents to the requester. */
export function requestRoutes({ supabase, auth, mailer }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth));

  router.get(
    "/:id/default-message",
    requireRole("admin", "editor"),
    asyncHandler(async (req, res) => {
      const message = await messageForRequest(supabase, idParam.parse(req.params.id));
      res.json({ message, mailReady: mailer.ready });
    })
  );

  router.post(
    "/:id/send",
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      await sendRequestDocuments({ supabase, mailer, admin: req.admin! }, idParam.parse(req.params.id), sendRequestSchema.parse(req.body));
      res.json({ ok: true });
    })
  );

  return router;
}
