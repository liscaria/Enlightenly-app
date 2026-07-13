import { normalizeDifficultyLevel } from "../constants/difficultyLevels.js";
import { sourceFromQuestionPaper } from "../constants/questionSources.js";
import {
  metadataForQuestionBank,
  sanitizeQuestionBankText,
} from "./postgresJsonSanitize.js";
import { log } from "../lib/logger.js";

const UPSERT_BATCH_SIZE = 40;

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

function isMissingDifficultyColumnError(error) {
  const msg = (error?.message || "").toLowerCase();
  return msg.includes("difficulty_level") && msg.includes("column");
}

function isMissingChapterConfidenceColumnError(error) {
  const msg = (error?.message || "").toLowerCase();
  return msg.includes("chapter_confidence") && msg.includes("column");
}

/** Normalize DB row or API paper object for bank row builders. */
export function paperRecordForBank(paper) {
  return {
    id: paper.id,
    classId: paper.classId ?? paper.class_id,
    paperSource: paper.paperSource ?? paper.paper_source ?? "Others",
    year: paper.year != null ? Number(paper.year) : null,
  };
}

export function questionBankRowsFromQuestionPaper(ownerId, paper, { questions = [] } = {}) {
  if (!questions.length) return [];
  const normalized = paperRecordForBank(paper);
  return questions.map((q, index) => ({
    owner_id: ownerId,
    id: q.id,
    origin_type: "question_paper",
    material_id: null,
    question_paper_id: normalized.id,
    class_id: normalized.classId,
    unit_id: q.unitId ?? q.unit_id ?? null,
    chapter_id: q.chapterId ?? q.chapter_id ?? null,
    chapter_name: q.chapterName ?? q.chapter_name ?? null,
    chapter_confidence: q.chapterConfidence ?? q.chapter_confidence ?? null,
    question_no: q.questionNo ?? q.question_no ?? index + 1,
    question_text: sanitizeQuestionBankText(q.questionText ?? q.question_text ?? ""),
    marks: q.marks ?? null,
    solution: q.solution ? sanitizeQuestionBankText(q.solution) : null,
    difficulty_level: normalizeDifficultyLevel(q.difficultyLevel ?? q.difficulty_level),
    source: sourceFromQuestionPaper(normalized.paperSource),
    year: normalized.year,
    topic: q.topic ? sanitizeQuestionBankText(q.topic) : null,
    extracted_by: q.extractedBy ?? q.extracted_by ?? "manual",
    metadata: metadataForQuestionBank(q.metadata ?? {}),
  }));
}

function buildUpsertRow(ownerId, r, { includeDifficulty = true, includeChapterConfidence = true } = {}) {
  const row = {
    owner_id: ownerId,
    ...(r.id ? { id: r.id } : {}),
    origin_type: r.origin_type,
    material_id: r.material_id ?? null,
    question_paper_id: r.question_paper_id ?? null,
    class_id: r.class_id,
    unit_id: r.unit_id ?? null,
    chapter_id: r.chapter_id ?? null,
    chapter_name: r.chapter_name ? sanitizeQuestionBankText(r.chapter_name) : null,
    question_no: r.question_no ?? null,
    question_text: sanitizeQuestionBankText(r.question_text),
    marks: r.marks ?? null,
    solution: r.solution ? sanitizeQuestionBankText(r.solution) : null,
    source: r.source,
    year: r.year ?? null,
    topic: r.topic ? sanitizeQuestionBankText(r.topic) : null,
    extracted_by: r.extracted_by || "manual",
    metadata: metadataForQuestionBank(r.metadata || {}),
  };
  if (includeChapterConfidence) {
    row.chapter_confidence =
      r.chapter_confidence != null ? Number(r.chapter_confidence) : null;
  }
  if (includeDifficulty) {
    row.difficulty_level = normalizeDifficultyLevel(r.difficulty_level);
  }
  return row;
}

async function upsertBatch(
  supabase,
  ownerId,
  batch,
  { includeDifficulty = true, includeChapterConfidence = true } = {}
) {
  const rows = batch.map((r) =>
    buildUpsertRow(ownerId, r, { includeDifficulty, includeChapterConfidence })
  );
  const { error } = await supabase.from("question_bank").upsert(rows, { onConflict: "id" });
  return error;
}

export async function upsertQuestionBank(supabase, ownerId, records) {
  if (!records?.length) return null;

  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    const batch = records.slice(i, i + UPSERT_BATCH_SIZE);
    let includeChapterConfidence = true;
    let includeDifficulty = true;
    let error = await upsertBatch(supabase, ownerId, batch, {
      includeDifficulty,
      includeChapterConfidence,
    });

    if (error && isMissingDifficultyColumnError(error)) {
      includeDifficulty = false;
      error = await upsertBatch(supabase, ownerId, batch, {
        includeDifficulty,
        includeChapterConfidence,
      });
    }

    if (error && isMissingChapterConfidenceColumnError(error)) {
      includeChapterConfidence = false;
      error = await upsertBatch(supabase, ownerId, batch, {
        includeDifficulty,
        includeChapterConfidence,
      });
    }

    if (error) {
      log("warn", "questionBank.upsert", { error: error.message });
      return formatError(error);
    }
  }
  return null;
}

export async function queryQuestionBankIdsForPaper(supabase, ownerId, questionPaperId) {
  const { data, error } = await supabase
    .from("question_bank")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("origin_type", "question_paper")
    .eq("question_paper_id", questionPaperId);

  if (error) {
    log("warn", "questionBank.queryIds", { error: error.message });
    return [];
  }
  return (data || []).map((r) => r.id);
}

/** Delete bank rows for this paper that are not in keepIds (after successful upsert). */
export async function deleteOrphanQuestionBankRows(
  supabase,
  ownerId,
  questionPaperId,
  keepIds
) {
  const keepSet = new Set(keepIds || []);
  const existing = await queryQuestionBankIdsForPaper(supabase, ownerId, questionPaperId);
  const orphanIds = existing.filter((id) => !keepSet.has(id));
  if (!orphanIds.length) return null;

  for (let i = 0; i < orphanIds.length; i += UPSERT_BATCH_SIZE) {
    const batch = orphanIds.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from("question_bank")
      .delete()
      .eq("owner_id", ownerId)
      .in("id", batch);
    if (error) {
      log("warn", "questionBank.deleteOrphans", { error: error.message });
      return formatError(error);
    }
  }
  return null;
}

export async function countQuestionBankForPaper(supabase, ownerId, questionPaperId) {
  const { count, error } = await supabase
    .from("question_bank")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("origin_type", "question_paper")
    .eq("question_paper_id", questionPaperId);

  if (error) {
    log("warn", "questionBank.count", { error: error.message });
    return 0;
  }
  return count ?? 0;
}

/** Load all question_bank rows for one exam paper. */
export async function queryQuestionBankForPaper(supabase, ownerId, questionPaperId) {
  const { data, error } = await supabase
    .from("question_bank")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("origin_type", "question_paper")
    .eq("question_paper_id", questionPaperId)
    .order("question_no", { ascending: true });

  if (error) {
    log("warn", "questionBank.queryForPaper", { error: error.message });
    return [];
  }
  return data || [];
}
