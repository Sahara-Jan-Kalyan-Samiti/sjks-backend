import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { logActivity } from "../services/activity.js";
import { HttpError } from "../utils/errors.js";
import { broadcastSchema } from "../utils/validators.js";

type Audience = "volunteers" | "donors" | "all";
const AUDIENCES: Audience[] = ["volunteers", "donors", "all"];
const BATCH = 40;

/** Unique, lower-cased e-mail addresses: active volunteers and/or donors with a successful donation. */
async function recipients(supabase: SupabaseClient, audience: Audience): Promise<string[]> {
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

/** E-mail to volunteers and/or donors. Sent in BCC batches so recipients never see each other. */
export function broadcastRoutes({ supabase, auth, mailer }: AppDeps): Router {
  const router = Router();
  router.use(requireAuth(auth), requireRole("admin"));

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const counts = Object.fromEntries(await Promise.all(AUDIENCES.map(async (a) => [a, (await recipients(supabase, a)).length])));
      const { data: history } = await supabase.from("broadcasts").select("*").order("created_at", { ascending: false }).limit(20);
      res.json({ counts, history: history ?? [], mailReady: mailer.ready });
    })
  );

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { audience, subject, message } = broadcastSchema.parse(req.body);
      const list = await recipients(supabase, audience);
      if (!list.length) throw new HttpError(400, "No recipients with an email address in that audience");
      let failed = 0;
      for (let i = 0; i < list.length; i += BATCH) {
        try {
          await mailer.send({
            bcc: list.slice(i, i + BATCH),
            subject,
            text: `${message}\n\n--\nYou receive this because you volunteered with or donated to us. Reply to this email to opt out.`
          });
        } catch (error) {
          if (i === 0 && error instanceof HttpError && error.status === 503) throw error; // e-mail not configured
          failed += Math.min(BATCH, list.length - i);
        }
      }
      const sent = list.length - failed;
      await supabase.from("broadcasts").insert({ admin_id: req.admin!.id, audience, subject, body: message, recipients: sent, failed });
      await logActivity(supabase, req.admin!, { action: "emailed", entity: "broadcasts", summary: `Sent a broadcast to ${sent} recipient(s)` });
      res.json({ sent, failed });
    })
  );

  return router;
}
