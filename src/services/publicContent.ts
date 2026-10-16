import type { SupabaseClient } from "@supabase/supabase-js";

interface EventRow {
  id: number;
  title: string;
  event_date: string;
  event_time: string | null;
  place: string | null;
  description: string | null;
  images: { id: number; path: string }[] | null;
}

/** Published events in the shape the website expects. Images become full public Storage URLs. */
export async function listPublicEvents(supabase: SupabaseClient, supabaseUrl: string) {
  const { data, error } = await supabase.from("v_public_events").select("*");
  if (error) throw new Error(error.message);
  const imageUrl = (path: string) => `${supabaseUrl}/storage/v1/object/public/event-images/${path}`;
  return ((data ?? []) as EventRow[]).map((e) => ({
    id: `db-${e.id}`,
    title: e.title,
    date: e.event_date,
    time: e.event_time || undefined,
    place: e.place || "",
    text: e.description || "",
    images: (e.images ?? []).map((img) => imageUrl(img.path))
  }));
}

/** Published projects. Ids are prefixed `db-` so they never clash with the website's built-in projects. */
export async function listPublicProjects(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("v_public_projects").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p: { id: number }) => ({ ...p, id: `db-${p.id}` }));
}

/** Stores a volunteer sign-up from the website; it waits for approval as `pending`. */
export async function createVolunteer(supabase: SupabaseClient, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from("volunteers").insert({ ...fields, status: "pending" });
  if (error) throw new Error(error.message);
}
