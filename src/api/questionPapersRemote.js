// Exam-level question papers (Question Bank) — Postgres + Storage bucket `question-papers`.

import {
  supabase,
  isSupabaseConfigured,
  QUESTION_PAPERS_BUCKET,
} from "../supabaseClient.js";
import { remoteUpsertClass } from "./materialsRemote.js";

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[questionPapersRemote] ${scope}:`, error.message || error);
}

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

async function resolveUploadUserId(ownerId) {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) return { userId: null, error: formatError(error) };
  const userId = session?.user?.id;
  if (!userId) {
    return { userId: null, error: "Sign in again to upload question papers." };
  }
  if (ownerId && ownerId !== userId) {
    return { userId: null, error: "Session user does not match upload owner." };
  }
  return { userId, error: null };
}

async function ensureClass(ownerId, catalog, classId) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) return "Select a valid class.";
  const classIndex = catalog.indexOf(classItem);
  return remoteUpsertClass(ownerId, {
    id: classItem.id,
    name: classItem.name,
    position: classIndex >= 0 ? classIndex : null,
  });
}

function storagePathFor(ownerId, classId, paperId, name) {
  const safe = (name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 80);
  return `${ownerId}/${classId}/${paperId}-${safe}`;
}

/**
 * @returns {{ storagePath: string|null, error: string|null }}
 */
export async function remoteSaveQuestionPaper(ownerId, record, blob, catalog) {
  if (notReady(ownerId)) {
    return {
      storagePath: null,
      error: isSupabaseConfigured
        ? "Sign in to sync question papers to the database."
        : null,
    };
  }

  const { userId, error: sessionError } = await resolveUploadUserId(ownerId);
  if (sessionError) return { storagePath: null, error: sessionError };

  if (Array.isArray(catalog)) {
    const classErr = await ensureClass(userId, catalog, record.classId);
    if (classErr) return { storagePath: null, error: classErr };
  }

  let storagePath = null;
  let storageError = null;

  if (blob) {
    storagePath = storagePathFor(userId, record.classId, record.id, record.name);
    const body =
      blob instanceof Blob
        ? blob
        : new Blob([blob], {
            type: record.mimeType || "application/octet-stream",
          });
    const { error: uploadError } = await supabase.storage
      .from(QUESTION_PAPERS_BUCKET)
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
        `Upload to Storage bucket "${QUESTION_PAPERS_BUCKET}" failed. Create the bucket and run db/supabase/policies.sql.`,
    };
  }

  const { error } = await supabase.from("question_papers").upsert(
    {
      owner_id: userId,
      id: record.id,
      class_id: record.classId,
      name: record.name,
      paper_source: record.paperSource,
      year: Number(record.year),
      file_type: record.fileType ?? null,
      mime_type: record.mimeType ?? null,
      source_kind: record.source?.kind ?? null,
      source_origin: record.source?.origin ?? null,
      storage_bucket: storagePath ? QUESTION_PAPERS_BUCKET : null,
      storage_path: storagePath,
    },
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertQuestionPaper", error);
  const dbError = formatError(error);
  return {
    storagePath,
    error: dbError || storageError,
  };
}

export async function remoteRenameQuestionPaper(ownerId, id, name) {
  if (notReady(ownerId)) return null;
  const trimmed = (name || "").trim();
  if (!trimmed) return "Display name cannot be empty.";
  const { error } = await supabase
    .from("question_papers")
    .update({ name: trimmed })
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) warn("renameQuestionPaper", error);
  return formatError(error);
}

export async function remoteListQuestionPapers(ownerId) {
  if (notReady(ownerId)) return [];
  const { data, error } = await supabase
    .from("question_papers")
    .select("*")
    .eq("owner_id", ownerId)
    .order("year", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) {
    warn("listQuestionPapers", error);
    return [];
  }
  return data || [];
}

/** Download question-paper bytes from Storage (for extraction / reprocessing). */
export async function remoteDownloadQuestionPaperBlob(ownerId, paperId) {
  if (notReady(ownerId)) return null;
  const { data: meta, error: metaError } = await supabase
    .from("question_papers")
    .select("storage_bucket, storage_path, name, mime_type")
    .eq("owner_id", ownerId)
    .eq("id", paperId)
    .maybeSingle();
  if (metaError || !meta?.storage_path) return null;
  const { data, error } = await supabase.storage
    .from(meta.storage_bucket || QUESTION_PAPERS_BUCKET)
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

export async function remoteGetQuestionPaperSignedUrl(
  ownerId,
  id,
  expiresInSec = 3600
) {
  if (notReady(ownerId)) return null;
  const { data: meta, error: metaError } = await supabase
    .from("question_papers")
    .select("storage_bucket, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (metaError || !meta?.storage_path) return null;
  const { data, error } = await supabase.storage
    .from(meta.storage_bucket || QUESTION_PAPERS_BUCKET)
    .createSignedUrl(meta.storage_path, expiresInSec);
  if (error) {
    warn("signedUrl", error);
    return null;
  }
  return data?.signedUrl || null;
}

export async function remoteDeleteQuestionPaper(ownerId, id) {
  if (notReady(ownerId)) return null;
  const { data, error: fetchError } = await supabase
    .from("question_papers")
    .select("storage_bucket, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (fetchError) warn("fetchBeforeDelete", fetchError);

  if (data?.storage_path) {
    const { error: storageError } = await supabase.storage
      .from(data.storage_bucket || QUESTION_PAPERS_BUCKET)
      .remove([data.storage_path]);
    if (storageError) warn("storage.remove", storageError);
  }

  const { error } = await supabase
    .from("question_papers")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) warn("deleteQuestionPaper", error);
  return formatError(error) || formatError(fetchError);
}
