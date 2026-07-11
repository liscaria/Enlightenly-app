import { log } from "../lib/logger.js";

/** Load classes / units / chapters from Postgres for FK validation. */
export async function fetchCatalogStructure(supabase, ownerId) {
  const [classesRes, unitsRes, chaptersRes] = await Promise.all([
    supabase.from("classes").select("*").eq("owner_id", ownerId).order("position"),
    supabase.from("units").select("*").eq("owner_id", ownerId).order("position"),
    supabase.from("chapters").select("*").eq("owner_id", ownerId).order("position"),
  ]);

  if (classesRes.error) log("warn", "catalog.fetchClasses", { error: classesRes.error.message });
  if (unitsRes.error) log("warn", "catalog.fetchUnits", { error: unitsRes.error.message });
  if (chaptersRes.error) log("warn", "catalog.fetchChapters", { error: chaptersRes.error.message });

  return {
    classes: classesRes.data || [],
    units: unitsRes.data || [],
    chapters: chaptersRes.data || [],
  };
}

/** Build in-memory catalog tree for one class (for ensureClass sync). */
export function buildCatalogForClass({ classes, units, chapters }, classId) {
  const classRow = classes.find((c) => c.id === classId);
  if (!classRow) return [];

  const classUnits = units.filter((u) => u.class_id === classId);
  return [
    {
      id: classRow.id,
      name: classRow.name,
      units: classUnits.map((unit) => ({
        id: unit.id,
        name: unit.name,
        chapters: chapters
          .filter((ch) => ch.unit_id === unit.id)
          .map((ch) => ({ id: ch.id, name: ch.name })),
      })),
    },
  ];
}

/** Verify class FK parent exists before question_bank insert. */
export async function ensureClassExists(supabase, ownerId, classId) {
  if (!classId) return "Question paper is missing classId.";
  const { data, error } = await supabase
    .from("classes")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", classId)
    .maybeSingle();
  if (error) return error.message;
  if (!data) return `Class "${classId}" not found in database.`;
  return null;
}
