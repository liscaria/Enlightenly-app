// Remote (Supabase Postgres + Storage) data layer for Enlightenly.
//
// Every function is a no-op when Supabase is not configured or ownerId is missing.
// All rows and storage paths are scoped to ownerId (= auth.users.id).

import {
  supabase,
  isSupabaseConfigured,
  MATERIALS_BUCKET,
} from "../supabaseClient.js";

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[materialsRemote] ${scope}:`, error.message || error);
}

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

/** @returns {string|null} error message */
function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

// ------------------------------------------------------------------
// Catalog: classes / units / chapters
// ------------------------------------------------------------------

/** Upsert the full class → unit → chapter tree (e.g. seeded Class XI) before materials can sync. */
export async function remoteSyncCatalog(ownerId, catalog) {
  if (notReady(ownerId) || !Array.isArray(catalog)) return null;
  for (let ci = 0; ci < catalog.length; ci += 1) {
    const classItem = catalog[ci];
    let err = await remoteUpsertClass(ownerId, {
      id: classItem.id,
      name: classItem.name,
      position: ci,
    });
    if (err) return err;
    const units = classItem.units || [];
    for (let ui = 0; ui < units.length; ui += 1) {
      const unit = units[ui];
      err = await remoteUpsertUnit(ownerId, classItem.id, unit, ui);
      if (err) return err;
      const chapters = unit.chapters || [];
      for (let chi = 0; chi < chapters.length; chi += 1) {
        const chapter = chapters[chi];
        err = await remoteUpsertChapter(ownerId, classItem.id, unit.id, chapter, chi);
        if (err) return err;
      }
    }
  }
  return null;
}

/** Upsert one class and its units/chapters (needed before question_bank chapter FK). */
export async function remoteSyncCatalogForClass(ownerId, catalog, classId) {
  if (notReady(ownerId) || !Array.isArray(catalog) || !classId) return null;
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) return "Could not find class in your catalog.";
  const classIndex = catalog.indexOf(classItem);
  let err = await remoteUpsertClass(ownerId, {
    id: classItem.id,
    name: classItem.name,
    position: classIndex >= 0 ? classIndex : null,
  });
  if (err) return err;
  const units = classItem.units || [];
  for (let ui = 0; ui < units.length; ui += 1) {
    const unit = units[ui];
    err = await remoteUpsertUnit(ownerId, classItem.id, unit, ui);
    if (err) return err;
    const chapters = unit.chapters || [];
    for (let chi = 0; chi < chapters.length; chi += 1) {
      const chapter = chapters[chi];
      err = await remoteUpsertChapter(ownerId, classItem.id, unit.id, chapter, chi);
      if (err) return err;
    }
  }
  return null;
}

/** Ensure one branch exists in Postgres (required FK parents for materials). */
export async function remoteEnsureCatalogBranch(
  ownerId,
  catalog,
  classId,
  unitId,
  chapterId
) {
  if (notReady(ownerId)) return null;
  const classItem = catalog.find((c) => c.id === classId);
  const unit = classItem?.units?.find((u) => u.id === unitId);
  const chapter = unit?.chapters?.find((ch) => ch.id === chapterId);
  if (!classItem || !unit || !chapter) {
    return "Could not find class, unit, or chapter in your catalog.";
  }
  const classIndex = catalog.indexOf(classItem);
  const unitIndex = classItem.units.indexOf(unit);
  const chapterIndex = unit.chapters.indexOf(chapter);

  let err = await remoteUpsertClass(ownerId, {
    id: classItem.id,
    name: classItem.name,
    position: classIndex >= 0 ? classIndex : null,
  });
  if (err) return err;
  err = await remoteUpsertUnit(ownerId, classId, unit, unitIndex >= 0 ? unitIndex : null);
  if (err) return err;
  err = await remoteUpsertChapter(
    ownerId,
    classId,
    unitId,
    chapter,
    chapterIndex >= 0 ? chapterIndex : null
  );
  return err;
}

export async function remoteUpsertClass(ownerId, classItem) {
  if (notReady(ownerId)) return null;
  const { error } = await supabase.from("classes").upsert(
    {
      owner_id: ownerId,
      id: classItem.id,
      name: classItem.name,
      position: classItem.position ?? null,
    },
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertClass", error);
  return formatError(error);
}

export async function remoteDeleteClass(ownerId, classId) {
  if (notReady(ownerId)) return;
  const { error } = await supabase
    .from("classes")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", classId);
  if (error) warn("deleteClass", error);
}

export async function remoteUpsertUnit(ownerId, classId, unit, position) {
  if (notReady(ownerId)) return null;
  const { error } = await supabase.from("units").upsert(
    {
      owner_id: ownerId,
      id: unit.id,
      class_id: classId,
      name: unit.name,
      title: unit.title ?? null,
      marks: unit.marks === "" || unit.marks == null ? null : Number(unit.marks),
      position: position ?? null,
    },
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertUnit", error);
  return formatError(error);
}

export async function remoteDeleteUnit(ownerId, unitId) {
  if (notReady(ownerId)) return;
  const { error } = await supabase
    .from("units")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", unitId);
  if (error) warn("deleteUnit", error);
}

export async function remoteUpsertChapter(ownerId, classId, unitId, chapter, position) {
  if (notReady(ownerId)) return null;
  const { error } = await supabase.from("chapters").upsert(
    {
      owner_id: ownerId,
      id: chapter.id,
      unit_id: unitId,
      class_id: classId,
      name: chapter.name,
      position: position ?? null,
    },
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertChapter", error);
  return formatError(error);
}

export async function remoteDeleteChapter(ownerId, chapterId) {
  if (notReady(ownerId)) return;
  const { error } = await supabase
    .from("chapters")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", chapterId);
  if (error) warn("deleteChapter", error);
}

// ------------------------------------------------------------------
// Materials (file + metadata)
// ------------------------------------------------------------------

function storagePathFor(ownerId, classId, unitId, chapterId, materialId, name) {
  const safe = (name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  return `${ownerId}/${classId}/${unitId}/${chapterId}/${materialId}-${safe}`;
}

/**
 * @returns {{ storagePath: string|null, error: string|null }}
 */
async function resolveUploadUserId(ownerId) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return { userId: null, error: formatError(error) };
  const userId = session?.user?.id;
  if (!userId) {
    return { userId: null, error: "Sign in again to upload files to Storage." };
  }
  if (ownerId && ownerId !== userId) {
    return { userId: null, error: "Session user does not match upload owner." };
  }
  return { userId, error: null };
}

export async function remoteSaveMaterial(ownerId, record, blob, catalog) {
  if (notReady(ownerId)) {
    return {
      storagePath: null,
      error: isSupabaseConfigured
        ? "Sign in to sync uploads to the database."
        : null,
    };
  }

  const { userId, error: sessionError } = await resolveUploadUserId(ownerId);
  if (sessionError) {
    return { storagePath: null, error: sessionError };
  }

  if (Array.isArray(catalog)) {
    const branchErr = await remoteEnsureCatalogBranch(
      userId,
      catalog,
      record.classId,
      record.unitId,
      record.chapterId
    );
    if (branchErr) {
      warn("ensureCatalogBranch", { message: branchErr });
      return { storagePath: null, error: branchErr };
    }
  }

  let storagePath = null;
  let storageError = null;

  if (blob) {
    storagePath = storagePathFor(
      userId,
      record.classId,
      record.unitId,
      record.chapterId,
      record.id,
      record.name
    );
    const body =
      blob instanceof Blob
        ? blob
        : new Blob([blob], {
            type: record.mimeType || "application/octet-stream",
          });
    const { error: uploadError } = await supabase.storage
      .from(MATERIALS_BUCKET)
      .upload(storagePath, body, {
        upsert: true,
        contentType: record.mimeType || body.type || "application/octet-stream",
      });
    if (uploadError) {
      warn("storage.upload", uploadError);
      storagePath = null;
      storageError = formatError(uploadError);
    }
  }

  if (blob && !storagePath) {
    return {
      storagePath: null,
      error:
        storageError ||
        `File upload to Storage bucket "${MATERIALS_BUCKET}" failed. Confirm the bucket exists and re-run db/supabase/policies.sql.`,
    };
  }

  const { error } = await supabase.from("materials").upsert(
    {
      owner_id: userId,
      id: record.id,
      chapter_id: record.chapterId,
      unit_id: record.unitId,
      class_id: record.classId,
      name: record.name,
      material_type: record.materialType,
      file_type: record.fileType ?? null,
      mime_type: record.mimeType ?? null,
      source_kind: record.source?.kind ?? null,
      source_origin: record.source?.origin ?? null,
      storage_bucket: storagePath ? MATERIALS_BUCKET : null,
      storage_path: storagePath,
      exam_source: record.examSource ?? null,
    },
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertMaterial", error);
  const dbError = formatError(error);
  return {
    storagePath,
    error: dbError || storageError,
  };
}

export async function remoteDeleteMaterial(ownerId, id) {
  if (notReady(ownerId)) return null;
  const { data, error: fetchError } = await supabase
    .from("materials")
    .select("storage_bucket, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError) warn("fetchMaterialBeforeDelete", fetchError);

  if (data?.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(data.storage_bucket || MATERIALS_BUCKET)
      .remove([data.storage_path]);
    if (storageError) warn("storage.remove", storageError);
  }

  const { error } = await supabase
    .from("materials")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) warn("deleteMaterial", error);
  return formatError(error) || formatError(fetchError);
}

export async function remoteRenameMaterial(ownerId, id, name) {
  if (notReady(ownerId)) return null;
  const trimmed = (name || "").trim();
  if (!trimmed) return "Display name cannot be empty.";
  const { error } = await supabase
    .from("materials")
    .update({ name: trimmed })
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) warn("renameMaterial", error);
  return formatError(error);
}

export async function remoteListMaterials(ownerId, filters = {}) {
  if (notReady(ownerId)) return [];
  let query = supabase.from("materials").select("*").eq("owner_id", ownerId);
  if (filters.classId) query = query.eq("class_id", filters.classId);
  if (filters.unitId) query = query.eq("unit_id", filters.unitId);
  if (filters.chapterId) query = query.eq("chapter_id", filters.chapterId);
  if (filters.materialType) query = query.eq("material_type", filters.materialType);
  if (filters.examSource) query = query.eq("exam_source", filters.examSource);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    warn("listMaterials", error);
    return [];
  }
  return data || [];
}

export async function remoteGetMaterialSignedUrl(ownerId, id, expiresInSec = 3600) {
  if (notReady(ownerId)) return null;
  const { data: meta, error: metaError } = await supabase
    .from("materials")
    .select("storage_bucket, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (metaError || !meta?.storage_path) return null;
  const { data, error } = await supabase.storage
    .from(meta.storage_bucket || MATERIALS_BUCKET)
    .createSignedUrl(meta.storage_path, expiresInSec);
  if (error) {
    warn("signedUrl", error);
    return null;
  }
  return data?.signedUrl || null;
}

/** Download material bytes from Storage (e.g. syllabus PDF for AI classification). */
export async function remoteDownloadMaterialBlob(ownerId, materialId) {
  if (notReady(ownerId)) return null;
  const { data: meta, error: metaError } = await supabase
    .from("materials")
    .select("storage_bucket, storage_path, name, mime_type")
    .eq("owner_id", ownerId)
    .eq("id", materialId)
    .maybeSingle();
  if (metaError || !meta?.storage_path) return null;
  const { data, error } = await supabase.storage
    .from(meta.storage_bucket || MATERIALS_BUCKET)
    .download(meta.storage_path);
  if (error) {
    warn("storage.download", error);
    return null;
  }
  return {
    blob: data,
    name: meta.name,
    mimeType: meta.mime_type,
  };
}

// ------------------------------------------------------------------
// Question bank (delegates to questionBankRemote.js)
// ------------------------------------------------------------------

export {
  remoteUpsertQuestionBank as remoteSaveQuestions,
  remoteQueryQuestionBank as remoteQueryQuestions,
  remoteReplaceQuestionBankForMaterial,
  remoteDeleteQuestionBankByMaterial,
} from "./questionBankRemote.js";
