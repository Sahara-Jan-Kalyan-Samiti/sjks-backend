import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminUser } from "../middleware/requireAuth.js";

/** One readable line in `activity_log` for actions only the backend performs (e-mails sent). Table edits are logged by database triggers. */
export async function logActivity(
  supabase: SupabaseClient,
  admin: AdminUser,
  entry: { action: string; entity: string; entityId?: string | number; summary: string }
): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      admin_id: admin.id,
      admin_label: admin.label,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId === undefined ? null : String(entry.entityId),
      summary: entry.summary.slice(0, 300)
    });
  } catch {
    // logging must never break the real action
  }
}
