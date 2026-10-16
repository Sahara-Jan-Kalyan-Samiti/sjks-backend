import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { createAdminAccount } from "../services/adminAccounts.js";
import { createAdminSchema } from "../utils/validators.js";

/** Staff accounts. Only an administrator may create one. */
export function adminRoutes({ supabase, auth }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth), requireRole("admin"));

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const row = await createAdminAccount({ supabase, admin: req.admin! }, createAdminSchema.parse(req.body));
      res.status(201).json(row);
    })
  );

  return router;
}
