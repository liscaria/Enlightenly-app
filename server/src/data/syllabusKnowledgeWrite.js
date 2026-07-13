import { log } from "../lib/logger.js";
import { sanitizeQuestionBankText } from "../data/postgresJsonSanitize.js";

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

/** Upsert syllabus_knowledge by (owner_id, chapter_id). */
export async function upsertSyllabusKnowledge(supabase, ownerId, row) {
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
    log("warn", "syllabusKnowledge.upsert", { error: error.message });
    return { id: null, error: formatError(error) };
  }
  return { id: data?.id ?? null, error: null };
}

export async function markSyllabusKnowledgePending(supabase, ownerId, meta) {
  return upsertSyllabusKnowledge(supabase, ownerId, {
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

export async function replaceChapterConcepts(
  supabase,
  ownerId,
  syllabusKnowledgeId,
  chapterId,
  concepts = []
) {
  if (!syllabusKnowledgeId) {
    return "syllabus_knowledge id is required.";
  }

  const { error: delError } = await supabase
    .from("chapter_concepts")
    .delete()
    .eq("owner_id", ownerId)
    .eq("syllabus_knowledge_id", syllabusKnowledgeId);

  if (delError) {
    log("warn", "syllabusKnowledge.deleteConcepts", { error: delError.message });
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
    log("warn", "syllabusKnowledge.insertConcepts", { error: insError.message });
    return formatError(insError);
  }
  return null;
}
