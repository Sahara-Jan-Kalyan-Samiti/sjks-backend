import { Router } from "express";
import type { AppDeps } from "../app.js";
import { asyncHandler } from "../middleware/errorHandler.js";

interface EventRow {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  place: string | null;
  description: string | null;
  images: { id: number; path: string }[] | null;
}

/** Read-only endpoints for the website: only published rows and only public fields (the views already filter). */
export function publicRoutes({ supabase, env }: AppDeps): Router {
  const router = Router();
  const imageUrl = (path: string) => `${env.SUPABASE_URL}/storage/v1/object/public/event-images/${path}`;

  router.get(
    "/events",
    asyncHandler(async (_req, res) => {
      const { data, error } = await supabase.from("v_public_events").select("*");
      if (error) throw new Error(error.message);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json(
        ((data ?? []) as EventRow[]).map((e) => ({
          id: `db-${e.id}`,
          title: e.title,
          date: e.event_date,
          time: e.event_time || undefined,
          place: e.place || "",
          text: e.description || "",
          images: (e.images ?? []).map((img) => imageUrl(img.path))
        }))
      );
    })
  );

  router.get(
    "/projects",
    asyncHandler(async (_req, res) => {
      const { data, error } = await supabase.from("v_public_projects").select("*");
      if (error) throw new Error(error.message);
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json((data ?? []).map((p: { id: number }) => ({ ...p, id: `db-${p.id}` })));
    })
  );

  return router;
}
