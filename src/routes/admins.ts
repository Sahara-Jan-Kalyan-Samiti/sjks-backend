import { Router } from "express";
import { z } from "zod";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { logActivity } from "../services/activity.js";
import { HttpError } from "../utils/errors.js";
import { isEmail } from "../utils/validators.js";

const createAdminSchema = z.object({
  email: z.string().trim().toLowerCase().refine(isEmail, "Email looks invalid"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use 72 characters or fewer"),
  display_name: z.string().trim().max(80).optional().transform((v) => v || null)
});

/**
 * Creating a staff account needs the service-role key (Supabase "admin" API), so it is done here and not in the browser.
 * Public sign-up stays switched off in Supabase. The new person gets the `admin` role and is already confirmed.
 */
export function adminRoutes({ supabase, auth }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth), requireRole("admin"));

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { email, password, display_name } = createAdminSchema.parse(req.body);
      const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) {
        const exists = /already|registered|exists/i.test(error?.message ?? "");
        throw new HttpError(exists ? 409 : 400, exists ? "This email already has an account." : (error?.message ?? "Could not create the account"));
      }
      const profile = { id: data.user.id, display_name: display_name || email.split("@")[0], role: "admin", is_active: true, email };
      const { data: row, error: profileError } = await supabase.from("admin_profiles").insert(profile).select().single();
      if (profileError) {
        await supabase.auth.admin.deleteUser(data.user.id); // do not leave an account without a profile behind
        throw new Error(profileError.message);
      }
      await logActivity(supabase, req.admin!, { action: "created", entity: "admin_profiles", entityId: data.user.id, summary: `Added admin ${email}` });
      res.status(201).json(row);
    })
  );

  return router;
}
