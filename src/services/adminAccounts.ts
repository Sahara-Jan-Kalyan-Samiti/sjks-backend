import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminUser } from "../middleware/requireAuth.js";
import { HttpError } from "../utils/errors.js";
import { logActivity } from "./activity.js";

/**
 * Creates a confirmed staff account with the `admin` role. It needs the service-role key (Supabase "admin" API), so it runs here and
 * not in the browser; public sign-up stays switched off in Supabase.
 */
export async function createAdminAccount(
  { supabase, admin }: { supabase: SupabaseClient; admin: AdminUser },
  { email, password, display_name }: { email: string; password: string; display_name: string | null }
) {
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

  await logActivity(supabase, admin, { action: "created", entity: "admin_profiles", entityId: data.user.id, summary: `Added admin ${email}` });
  return row;
}
