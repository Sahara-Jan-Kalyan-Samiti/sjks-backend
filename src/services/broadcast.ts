import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminUser } from "../middleware/requireAuth.js";
import { HttpError } from "../utils/errors.js";
import { logActivity } from "./activity.js";
import type { Mailer } from "./mailer.js";

export type Audience = "volunteers" | "donors" | "all";
export const AUDIENCES: Audience[] = ["volunteers", "donors", "all"];
const BATCH = 40;
const HISTORY_LIMIT = 20;
const FOOTER = "You receive this because you volunteered with or donated to us. Reply to this email to opt out.";

/** Unique, lower-cased e-mail addresses: active volunteers and/or donors with a successful donation. */
export async function recipients(supabase: SupabaseClient, audience: Audience): Promise<string[]> {
  const set = new Set<string>();
  if (audience !== "donors") {
    const { data } = await supabase.from("volunteers").select("email").eq("status", "active").not("email", "is", null);
    data?.forEach((v) => v.email && set.add(String(v.email).toLowerCase()));
  }
  if (audience !== "volunteers") {
    const { data } = await supabase.from("donations").select("donor_email").eq("status", "success").not("donor_email", "is", null);
    data?.forEach((d) => d.donor_email && set.add(String(d.donor_email).toLowerCase()));
  }
  return [...set];
}

/** How many people each audience has, and the most recent broadcasts. */
export async function audienceOverview(supabase: SupabaseClient) {
  const counts = Object.fromEntries(await Promise.all(AUDIENCES.map(async (a) => [a, (await recipients(supabase, a)).length])));
  const { data: history } = await supabase.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(HISTORY_LIMIT);
  return { counts, history: history ?? [] };
}

/**
 * Sends one message to an audience in BCC batches, so recipients never see each other. A failed batch is counted, not fatal;
 * if the very first batch fails because e-mail is not set up, the error is passed on.
 */
export async function sendBroadcast(
  { supabase, mailer, admin }: { supabase: SupabaseClient; mailer: Mailer; admin: AdminUser },
  { audience, subject, message }: { audience: Audience; subject: string; message: string }
): Promise<{ sent: number; failed: number }> {
  const list = await recipients(supabase, audience);
  if (!list.length) throw new HttpError(400, "No recipients with an email address in that audience");

  let failed = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    try {
      await mailer.send({ bcc: list.slice(i, i + BATCH), subject, text: `${message}\n\n--\n${FOOTER}` });
    } catch (error) {
      if (i === 0 && error instanceof HttpError && error.status === 503) throw error;
      failed += Math.min(BATCH, list.length - i);
    }
  }

  const sent = list.length - failed;
  await supabase.from("broadcasts").insert({ admin_id: admin.id, audience, subject, body: message, recipients: sent, failed });
  await logActivity(supabase, admin, { action: "emailed", entity: "broadcasts", summary: `Sent a broadcast to ${sent} recipient(s)` });
  return { sent, failed };
}
