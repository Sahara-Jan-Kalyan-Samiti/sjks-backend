import { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * GET /health is the liveness check for Cloud Run / uptime monitors: it only proves the process is running.
 * GET /ready also proves the database answers, so a wrong Supabase URL or key shows up before real traffic does.
 */
export function healthRoutes(supabase: SupabaseClient): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });
  router.get("/ready", async (_req, res) => {
    try {
      const { error } = await supabase.from("admin_profiles").select("id", { head: true, count: "exact" }).limit(1);
      if (error) throw new Error(error.message);
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  return router;
}
