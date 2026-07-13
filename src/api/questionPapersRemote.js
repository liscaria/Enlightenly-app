// Exam-level question papers (Question Bank) — Postgres + Storage bucket `question-papers`.

import {
  supabase,
  isSupabaseConfigured,
  QUESTION_PAPERS_BUCKET,
} from "../supabaseClient.js";
import { remoteUpsertClass } from "./materialsRemote.js";
import { remoteDeleteQuestionBankByQuestionPaper } from "./questionBankRemote.js";

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

/** Base question_papers row — omit solution columns unless a solution file was uploaded. */
function questionPaperRowForUpsert(
  userId,
  record,
  { storagePath = null, solutionStoragePath = null, solutionMimeType = null } = {}
) {
  const row = {
    owner_id: userId,
    id: record.id,
    class_id: record.classId ?? record.class_id,
    name: record.name,
    paper_source: record.paperSource ?? record.paper_source ?? "Others",
    year: Number(record.year) || new Date().getFullYear(),
    file_type: record.fileType ?? record.file_type ?? null,
    mime_type: record.mimeType ?? record.mime_type ?? null,
    source_kind: record.source?.kind ?? record.source_kind ?? null,
    source_origin: record.source?.origin ?? record.source_origin ?? null,
    storage_bucket: storagePath ? QUESTION_PAPERS_BUCKET : null,
    storage_path: storagePath,
  };
  if (solutionStoragePath) {
    row.solution_storage_path = solutionStoragePath;
    row.solution_mime_type = solutionMimeType ?? null;
  }
  return row;
}

/**
 * @returns {{ storagePath: string|null, solutionStoragePath: string|null, error: string|null }}
 */
export async function remoteSaveQuestionPaper(
  ownerId,
  record,
  blob,
  catalog,
  { solutionBlob = null, solutionName = null, solutionMimeType = null } = {}
) {
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
  let solutionStoragePath = null;
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

  if (solutionBlob) {
    const safeSolution = (solutionName || "solution")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(0, 80);
    solutionStoragePath = `${userId}/${record.classId}/${record.id}/solution-${safeSolution}`;
    const solutionBody =
      solutionBlob instanceof Blob
        ? solutionBlob
        : new Blob([solutionBlob], {
            type: solutionMimeType || "application/octet-stream",
          });
    const { error: solutionUploadError } = await supabase.storage
      .from(QUESTION_PAPERS_BUCKET)
      .upload(solutionStoragePath, solutionBody, {
        upsert: true,
        contentType: solutionMimeType || solutionBody.type || "application/octet-stream",
      });
    if (solutionUploadError) {
      warn("storage.uploadSolution", solutionUploadError);
      if (!storageError) storageError = formatError(solutionUploadError);
      solutionStoragePath = null;
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
    questionPaperRowForUpsert(userId, record, {
      storagePath,
      solutionStoragePath,
      solutionMimeType,
    }),
    { onConflict: "owner_id,id" }
  );
  if (error) warn("upsertQuestionPaper", error);
  const dbError = formatError(error);
  return {
    storagePath,
    solutionStoragePath,
    error: dbError || storageError,
  };
}

/**
 * Ensure question_papers row exists before writing question_bank rows (FK).
 * Re-runs class sync and upserts metadata when storage succeeded but DB upsert failed.
 */
export async function remoteEnsureQuestionPaperRecord(ownerId, paper, catalog) {
  if (notReady(ownerId)) {
    return "Sign in to sync question papers to the database.";
  }

  const { userId, error: sessionError } = await resolveUploadUserId(ownerId);
  if (sessionError) return sessionError;

  const classId = paper.classId ?? paper.class_id;
  if (!classId) return "Question paper is missing classId.";

  if (Array.isArray(catalog)) {
    const classErr = await ensureClass(userId, catalog, classId);
    if (classErr) return classErr;
  }

  const { data: existing, error: fetchError } = await supabase
    .from("question_papers")
    .select("id")
    .eq("owner_id", userId)
    .eq("id", paper.id)
    .maybeSingle();
  if (fetchError) {
    warn("ensureQuestionPaper.fetch", fetchError);
    return formatError(fetchError);
  }
  if (existing) return null;

  const storagePath = storagePathFor(userId, classId, paper.id, paper.name);
  const { error } = await supabase.from("question_papers").upsert(
    questionPaperRowForUpsert(userId, paper, { storagePath }),
    { onConflict: "owner_id,id" }
  );
  if (error) {
    warn("ensureQuestionPaper.upsert", error);
    return formatError(error);
  }
  return null;
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

  const bankErr = await remoteDeleteQuestionBankByQuestionPaper(ownerId, id);
  if (bankErr) return bankErr;

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

  if (!data) {
    return null;
  }

  const { error } = await supabase
    .from("question_papers")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) {
    warn("deleteQuestionPaper", error);
    return formatError(error);
  }
  return null;
}
