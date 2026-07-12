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

import {
  listMaterials,
  materialRowToCatalogFile,
} from "./materialsRemote.js";

/** Attach syllabus/material files to catalog chapters for one class. */
export function applyMaterialsToCatalog(catalog, materialRows) {
  const next = catalog.map((c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      chapters: u.chapters.map((ch) => ({
        ...ch,
        files: [...(ch.files || [])],
      })),
    })),
  }));

  for (const row of materialRows) {
    const file = materialRowToCatalogFile(row);
    const classItem = next.find((c) => c.id === row.class_id);
    const unit = classItem?.units.find((u) => u.id === row.unit_id);
    const chapter = unit?.chapters.find((ch) => ch.id === row.chapter_id);
    if (!chapter) continue;
    if (!chapter.files.some((f) => f.id === file.id)) {
      chapter.files.push(file);
    }
  }

  return next;
}

/** Load catalog tree + materials for classification (syllabus PDF download). */
export async function fetchCatalogWithMaterialsForClass(supabase, ownerId, classId) {
  const structure = await fetchCatalogStructure(supabase, ownerId);
  const catalog = buildCatalogForClass(structure, classId);
  if (!catalog.length) return [];

  const materialRows = await listMaterials(supabase, ownerId, { classId });
  return applyMaterialsToCatalog(catalog, materialRows);
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
