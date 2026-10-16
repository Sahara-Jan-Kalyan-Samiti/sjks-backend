import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { listPublicEvents, listPublicProjects } from "../services/publicContent.js";

/** Read-only endpoints for the website: only published rows and only public fields (the views already filter). */
export function publicRoutes({ supabase, env }: AppDeps): Router {
  const router = Router();

  router.get(
    "/events",
    asyncHandler(async (_req, res) => {
      const events = await listPublicEvents(supabase, env.SUPABASE_URL);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(events);
    })
  );

  router.get(
    "/projects",
    asyncHandler(async (_req, res) => {
      const projects = await listPublicProjects(supabase);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(projects);
    })
  );

  return router;
}
