import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { audienceOverview, sendBroadcast } from "../services/broadcast.js";
import { broadcastSchema } from "../utils/validators.js";

/** E-mail to volunteers and/or donors: audience sizes with history, and sending. */
export function broadcastRoutes({ supabase, auth, mailer }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth), requireRole("admin"));

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      res.json({ ...(await audienceOverview(supabase)), mailReady: mailer.ready });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await sendBroadcast({ supabase, mailer, admin: req.admin! }, broadcastSchema.parse(req.body)));
    })
  );

  return router;
}
