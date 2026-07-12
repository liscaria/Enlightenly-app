import { log } from "../lib/logger.js";

const MATERIALS_BUCKET = process.env.SUPABASE_BUCKET || "materials";

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
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

export async function listMaterials(supabase, ownerId, filters = {}) {
  if (!ownerId) return [];
  let query = supabase.from("materials").select("*").eq("owner_id", ownerId);
  if (filters.classId) query = query.eq("class_id", filters.classId);
  if (filters.unitId) query = query.eq("unit_id", filters.unitId);
  if (filters.chapterId) query = query.eq("chapter_id", filters.chapterId);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    log("warn", "materials.list", { error: error.message });
    return [];
  }
  return data || [];
}

/** Download material bytes from Storage (e.g. syllabus PDF for classification). */
export async function downloadMaterialBlob(supabase, ownerId, materialId) {
  if (!ownerId || !materialId) return null;
  const { data: meta, error: metaError } = await supabase
    .from("materials")
    .select("storage_bucket, storage_path, name, mime_type")
    .eq("owner_id", ownerId)
    .eq("id", materialId)
    .maybeSingle();
  if (metaError || !meta?.storage_path) return null;
  const bucket = meta.storage_bucket || MATERIALS_BUCKET;
  const { data, error } = await supabase.storage.from(bucket).download(meta.storage_path);
  if (error) {
    log("warn", "materials.download", { error: error.message, materialId });
    return null;
  }
  return {
    blob: data,
    name: meta.name,
    mimeType: meta.mime_type,
  };
}

export { MATERIALS_BUCKET, formatError };
