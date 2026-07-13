// Supabase CRUD for syllabus knowledge base (Phase 3).

import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import { sanitizeQuestionBankText } from "./postgresJsonSanitize.js";

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[syllabusKnowledgeRemote] ${scope}:`, error.message || error);
}

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

/** UI-friendly shape (no embeddings). */
export function syllabusKnowledgeRowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    classId: row.class_id,
    unitId: row.unit_id,
    chapterId: row.chapter_id,
    materialId: row.material_id,
    chapterName: row.chapter_name,
    summary: row.summary,
    extractStatus: row.extract_status,
    extractError: row.extract_error,
    mismatchWarning: Boolean(row.mismatch_warning),
    conceptCount: row.concept_count ?? 0,
    extractedAt: row.extracted_at,
    updatedAt: row.updated_at,
  };
}

const STATUS_SELECT =
  "id, class_id, unit_id, chapter_id, material_id, chapter_name, summary, extract_status, extract_error, mismatch_warning, concept_count, extracted_at, updated_at";

/** @returns {Promise<Array>} */
export async function remoteQuerySyllabusKnowledge(ownerId, { classId } = {}) {
  if (notReady(ownerId)) return [];
  let query = supabase
    .from("syllabus_knowledge")
    .select(STATUS_SELECT)
    .eq("owner_id", ownerId);
  if (classId) query = query.eq("class_id", classId);
  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) {
    warn("query", error);
    return [];
  }
  return (data || []).map(syllabusKnowledgeRowToEntry);
}

/**
 * Upsert syllabus_knowledge by (owner_id, chapter_id).
 * Embeddings: pass as number[] or null.
 * @returns {Promise<{ id: string|null, error: string|null }>}
 */
export async function remoteUpsertSyllabusKnowledge(ownerId, row) {
  if (notReady(ownerId)) {
    return { id: null, error: "Supabase is not configured." };
  }

  const payload = {
    owner_id: ownerId,
    class_id: row.classId,
    unit_id: row.unitId,
    chapter_id: row.chapterId,
    material_id: row.materialId ?? null,
    chapter_name: sanitizeQuestionBankText(row.chapterName ?? ""),
    summary: row.summary ? sanitizeQuestionBankText(row.summary) : null,
    title_embedding: row.titleEmbedding ?? null,
    summary_embedding: row.summaryEmbedding ?? null,
    extract_status: row.extractStatus ?? "pending",
    extract_error: row.extractError ? sanitizeQuestionBankText(row.extractError) : null,
    mismatch_warning: Boolean(row.mismatchWarning),
    concept_count: Number.isFinite(row.conceptCount) ? row.conceptCount : 0,
    extracted_at: row.extractedAt ?? null,
  };

  const { data, error } = await supabase
    .from("syllabus_knowledge")
    .upsert(payload, { onConflict: "owner_id,chapter_id" })
    .select("id")
    .single();

  if (error) {
    warn("upsert", error);
    return { id: null, error: formatError(error) };
  }
  return { id: data?.id ?? null, error: null };
}

/** Mark a chapter KB row as pending before async extraction. */
export async function remoteMarkSyllabusKnowledgePending(ownerId, meta) {
  return remoteUpsertSyllabusKnowledge(ownerId, {
    ...meta,
    summary: null,
    titleEmbedding: null,
    summaryEmbedding: null,
    extractStatus: "pending",
    extractError: null,
    mismatchWarning: false,
    conceptCount: 0,
    extractedAt: null,
  });
}

/**
 * Replace all concepts for a syllabus_knowledge row.
 * @param {Array<{ conceptName: string, conceptEmbedding: number[]|null, position: number }>} concepts
 */
export async function remoteReplaceChapterConcepts(
  ownerId,
  syllabusKnowledgeId,
  chapterId,
  concepts = []
) {
  if (notReady(ownerId) || !syllabusKnowledgeId) {
    return formatError({ message: "Supabase is not configured." });
  }

  const { error: delError } = await supabase
    .from("chapter_concepts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("syllabus_knowledge_id", syllabusKnowledgeId);

  if (delError) {
    warn("deleteConcepts", delError);
    return formatError(delError);
  }

  if (!concepts.length) return null;

  const rows = concepts.map((c, index) => ({
    owner_id: ownerId,
    chapter_id: chapterId,
    syllabus_knowledge_id: syllabusKnowledgeId,
    concept_name: sanitizeQuestionBankText(c.conceptName ?? ""),
    concept_embedding: c.conceptEmbedding ?? null,
    position: c.position ?? index,
  }));

  const { error: insError } = await supabase.from("chapter_concepts").insert(rows);
  if (insError) {
    warn("insertConcepts", insError);
    return formatError(insError);
  }
  return null;
}

/**
 * Concept rows for one class (names only, no embeddings).
 * @returns {Promise<Array<{ chapterId: string, chapterName: string, unitId: string, conceptName: string, position: number }>>}
 */
export async function remoteQueryChapterConceptsByClass(ownerId, classId) {
  if (notReady(ownerId) || !classId) return [];

  const { data, error } = await supabase
    .from("chapter_concepts")
    .select(
      "chapter_id, concept_name, position, syllabus_knowledge!inner(chapter_name, class_id, unit_id)"
    )
    .eq("owner_id", ownerId)
    .eq("syllabus_knowledge.class_id", classId)
    .order("position");

  if (error) {
    warn("queryConcepts", error);
    return [];
  }

  return (data || []).map((row) => ({
    chapterId: row.chapter_id,
    chapterName: row.syllabus_knowledge?.chapter_name ?? "",
    unitId: row.syllabus_knowledge?.unit_id ?? "",
    conceptName: row.concept_name,
    position: row.position ?? 0,
  }));
}

/**
 * Concept rows for one unit (names only, no embeddings).
 * @returns {Promise<Array<{ chapterId: string, chapterName: string, unitId: string, conceptName: string, position: number }>>}
 */
export async function remoteQueryChapterConceptsByUnit(ownerId, unitId) {
  if (notReady(ownerId) || !unitId) return [];

  const { data, error } = await supabase
    .from("chapter_concepts")
    .select(
      "chapter_id, concept_name, position, syllabus_knowledge!inner(chapter_name, class_id, unit_id)"
    )
    .eq("owner_id", ownerId)
    .eq("syllabus_knowledge.unit_id", unitId)
    .order("position");

  if (error) {
    warn("queryConceptsByUnit", error);
    return [];
  }

  return (data || []).map((row) => ({
    chapterId: row.chapter_id,
    chapterName: row.syllabus_knowledge?.chapter_name ?? "",
    unitId: row.syllabus_knowledge?.unit_id ?? "",
    conceptName: row.concept_name,
    position: row.position ?? 0,
  }));
}

function parseEmbedding(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? raw : null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Chapter KB profiles with embeddings for vector classification (Phase 4).
 */
export async function remoteQueryKnowledgeEmbeddingsForClass(ownerId, classId) {
  if (notReady(ownerId) || !classId) return [];

  const { data: knowledgeRows, error: kErr } = await supabase
    .from("syllabus_knowledge")
    .select(
      "chapter_id, unit_id, chapter_name, title_embedding, summary_embedding, extract_status"
    )
    .eq("owner_id", ownerId)
    .eq("class_id", classId);

  if (kErr) {
    warn("queryKnowledgeEmbeddings", kErr);
    return [];
  }

  const chapterIds = (knowledgeRows || []).map((r) => r.chapter_id).filter(Boolean);
  if (!chapterIds.length) return [];

  const { data: conceptRows, error: cErr } = await supabase
    .from("chapter_concepts")
    .select("chapter_id, concept_name, concept_embedding, position")
    .eq("owner_id", ownerId)
    .in("chapter_id", chapterIds)
    .order("position");

  if (cErr) {
    warn("queryConceptEmbeddings", cErr);
  }

  const conceptsByChapter = {};
  for (const row of conceptRows || []) {
    const emb = parseEmbedding(row.concept_embedding);
    if (!emb) continue;
    if (!conceptsByChapter[row.chapter_id]) conceptsByChapter[row.chapter_id] = [];
    conceptsByChapter[row.chapter_id].push({
      conceptName: row.concept_name,
      embedding: emb,
    });
  }

  return (knowledgeRows || [])
    .map((row) => {
      const titleEmbedding = parseEmbedding(row.title_embedding);
      const summaryEmbedding = parseEmbedding(row.summary_embedding);
      const concepts = conceptsByChapter[row.chapter_id] || [];
      if (!titleEmbedding && !summaryEmbedding && !concepts.length) return null;
      return {
        chapterId: row.chapter_id,
        unitId: row.unit_id,
        chapterName: row.chapter_name,
        titleEmbedding,
        summaryEmbedding,
        concepts,
        extractStatus: row.extract_status,
      };
    })
    .filter(Boolean);
}
