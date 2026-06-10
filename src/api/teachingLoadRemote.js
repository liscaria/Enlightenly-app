// Load a signed-in teacher's catalog, materials, and question papers from Supabase.

import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import { remoteListMaterials, remoteSyncCatalog } from "./materialsRemote.js";
import { remoteListQuestionPapers } from "./questionPapersRemote.js";
import { remoteQueryQuestionBank } from "./questionBankRemote.js";

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[teachingLoadRemote] ${scope}:`, error.message || error);
}

export function materialRowToCatalogFile(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.file_type || "PDF",
    materialCategory: row.material_type,
    mimeType: row.mime_type || null,
    examSource: row.exam_source ?? null,
    storedAt: row.created_at,
    source: {
      kind: row.source_kind || "local",
      origin: row.source_origin || row.name,
    },
    remoteStorageBucket: row.storage_bucket,
    remoteStoragePath: row.storage_path,
  };
}

export function questionPaperRowToUi(row, catalog) {
  const classItem = catalog.find((c) => c.id === row.class_id);
  return {
    id: row.id,
    name: row.name,
    classId: row.class_id,
    className: classItem?.name || row.class_id,
    paperSource: row.paper_source,
    year: row.year,
    fileType: row.file_type,
    mimeType: row.mime_type,
    source: {
      kind: row.source_kind || "local",
      origin: row.source_origin || row.name,
    },
    storedAt: row.created_at,
    remoteStorageBucket: row.storage_bucket,
    remoteStoragePath: row.storage_path,
  };
}

async function remoteFetchCatalogStructure(ownerId) {
  const [classesRes, unitsRes, chaptersRes] = await Promise.all([
    supabase.from("classes").select("*").eq("owner_id", ownerId).order("position"),
    supabase.from("units").select("*").eq("owner_id", ownerId).order("position"),
    supabase.from("chapters").select("*").eq("owner_id", ownerId).order("position"),
  ]);
  if (classesRes.error) warn("fetchClasses", classesRes.error);
  if (unitsRes.error) warn("fetchUnits", unitsRes.error);
  if (chaptersRes.error) warn("fetchChapters", chaptersRes.error);
  return {
    classes: classesRes.data || [],
    units: unitsRes.data || [],
    chapters: chaptersRes.data || [],
  };
}

/** Merge Postgres catalog rows into the in-memory tree (keeps local-only nodes). */
export function mergeCatalogWithRemoteStructure(baseCatalog, { classes, units, chapters }) {
  const catalog = baseCatalog.map((c) => ({
    ...c,
    units: c.units.map((u) => ({
      ...u,
      chapters: u.chapters.map((ch) => ({
        ...ch,
        files: [...(ch.files || [])],
      })),
    })),
  }));

  const classById = new Map(catalog.map((c) => [c.id, c]));

  for (const row of classes) {
    if (!classById.has(row.id)) {
      const created = { id: row.id, name: row.name, units: [] };
      catalog.push(created);
      classById.set(row.id, created);
    } else {
      classById.get(row.id).name = row.name;
    }
  }

  for (const row of units) {
    const classItem = classById.get(row.class_id);
    if (!classItem) continue;
    let unit = classItem.units.find((u) => u.id === row.id);
    if (!unit) {
      unit = {
        id: row.id,
        name: row.name,
        title: row.title || "",
        marks: row.marks,
        chapters: [],
      };
      classItem.units.push(unit);
    } else {
      unit.name = row.name;
      unit.title = row.title ?? unit.title;
      unit.marks = row.marks ?? unit.marks;
    }
  }

  for (const row of chapters) {
    const classItem = classById.get(row.class_id);
    if (!classItem) continue;
    const unit = classItem.units.find((u) => u.id === row.unit_id);
    if (!unit) continue;
    if (!unit.chapters.find((ch) => ch.id === row.id)) {
      unit.chapters.push({ id: row.id, name: row.name, files: [] });
    }
  }

  return catalog;
}

export function applyRemoteMaterialsToCatalog(catalog, materialRows) {
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
    } else {
      chapter.files = chapter.files.map((f) =>
        f.id === file.id ? { ...f, ...file } : f
      );
    }
  }

  return next;
}

/**
 * @returns {{ catalog, questionPapers, questionBankEntries, error: string|null }}
 */
export async function remoteHydrateUserLibrary(ownerId, localCatalog) {
  if (notReady(ownerId)) {
    return { catalog: localCatalog, questionPapers: [], questionBankEntries: [], error: null };
  }

  try {
    const structure = await remoteFetchCatalogStructure(ownerId);
    let catalog = mergeCatalogWithRemoteStructure(localCatalog, structure);
    const materialRows = await remoteListMaterials(ownerId);
    catalog = applyRemoteMaterialsToCatalog(catalog, materialRows);
    const qpRows = await remoteListQuestionPapers(ownerId);
    const questionPapers = qpRows.map((row) => questionPaperRowToUi(row, catalog));
    const questionBankEntries = await remoteQueryQuestionBank(ownerId, {});

    const syncErr = await remoteSyncCatalog(ownerId, catalog);
    return {
      catalog,
      questionPapers,
      questionBankEntries,
      error: syncErr,
    };
  } catch (err) {
    return {
      catalog: localCatalog,
      questionPapers: [],
      questionBankEntries: [],
      error: err.message || String(err),
    };
  }
}

export function mergeQuestionPaperLists(localPapers, remotePapers) {
  const byId = new Map((localPapers || []).map((p) => [p.id, p]));
  for (const paper of remotePapers || []) {
    byId.set(paper.id, { ...byId.get(paper.id), ...paper });
  }
  return [...byId.values()].sort(
    (a, b) => new Date(b.storedAt || 0) - new Date(a.storedAt || 0)
  );
}

export function findCatalogFile(catalog, fileId) {
  for (const classItem of catalog) {
    for (const unit of classItem.units || []) {
      for (const chapter of unit.chapters || []) {
        const file = chapter.files?.find((f) => f.id === fileId);
        if (file) {
          return { file, classItem, unit, chapter };
        }
      }
    }
  }
  return null;
}
