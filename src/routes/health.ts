import { Router } from "express";

/** Used by the Cloud Run / uptime check. Does not touch the database, so it only proves the process is alive. */
export function healthRoutes(): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: Math.round(process.uptime()) });
  });
  return router;
}
