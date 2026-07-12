import { EXTRACTION_FEATURE_FLAGS } from "../config/extractionConfig.js";
import { log } from "../lib/logger.js";
import { ensurePaperReadyForBank } from "../data/questionPapersRemote.js";
import {
  questionBankRowsFromQuestionPaper,
  upsertQuestionBank,
  deleteOrphanQuestionBankRows,
} from "../data/questionBankRemote.js";
import { upsertQuestionClassifications } from "../data/questionClassificationRemote.js";
import { classificationFromQuestion } from "./classifyPaperQuestions.js";

/**
 * Persist extracted (and optionally classified) questions to question_bank (Phase 2/2b).
 * Upserts first, deletes orphan rows second — never wipe-first.
 */
export async function persistPaperQuestions({
  supabase,
  ownerId,
  paper,
  questions,
  classifiedBy = "none",
  requestId,
  jobId,
  paperId,
}) {
  if (!EXTRACTION_FEATURE_FLAGS.persistToQuestionBank) {
    return { rowCount: 0, classificationCount: 0, assignedCount: 0, error: null, skipped: true };
  }

  if (!questions?.length) {
    return { rowCount: 0, classificationCount: 0, assignedCount: 0, error: "No questions to persist." };
  }

  const ensureErr = await ensurePaperReadyForBank(supabase, ownerId, paper);
  if (ensureErr) {
    return { rowCount: 0, classificationCount: 0, assignedCount: 0, error: ensureErr };
  }

  const rows = questionBankRowsFromQuestionPaper(ownerId, paper, { questions });
  if (!rows.length) {
    return {
      rowCount: 0,
      classificationCount: 0,
      assignedCount: 0,
      error: "Could not build question_bank rows.",
    };
  }

  const upsertErr = await upsertQuestionBank(supabase, ownerId, rows);
  if (upsertErr) {
    log("error", "persist.upsertFailed", {
      requestId,
      jobId,
      paperId,
      error: upsertErr,
    });
    return { rowCount: 0, classificationCount: 0, assignedCount: 0, error: upsertErr };
  }

  const keepIds = rows.map((r) => r.id).filter(Boolean);
  const deleteErr = await deleteOrphanQuestionBankRows(
    supabase,
    ownerId,
    paper.id,
    keepIds
  );
  if (deleteErr) {
    log("error", "persist.deleteOrphansFailed", {
      requestId,
      jobId,
      paperId,
      error: deleteErr,
    });
    return { rowCount: rows.length, classificationCount: 0, assignedCount: 0, error: deleteErr };
  }

  let classificationCount = 0;
  if (EXTRACTION_FEATURE_FLAGS.classifyToChapters && classifiedBy !== "none") {
    const sourceByClassifiedBy = {
      vector: "VECTOR",
      ai: "AI_RERANK",
      heuristic: "HEURISTIC_FALLBACK",
    };
    const defaultSource = sourceByClassifiedBy[classifiedBy] ?? "AI_RERANK";

    const clsRows = questions
      .filter((q) => q.chapterId)
      .map((q) => classificationFromQuestion(q, defaultSource))
      .filter(Boolean);

    if (clsRows.length) {
      const clsErr = await upsertQuestionClassifications(supabase, ownerId, clsRows);
      if (clsErr) {
        log("error", "persist.classificationsFailed", {
          requestId,
          jobId,
          paperId,
          error: clsErr,
        });
        return {
          rowCount: rows.length,
          classificationCount: 0,
          assignedCount: clsRows.length,
          error: clsErr,
        };
      }
      classificationCount = clsRows.length;
    }
  }

  const assignedCount = questions.filter((q) => q.chapterId).length;

  log("info", "persist.completed", {
    requestId,
    jobId,
    paperId,
    rowCount: rows.length,
    classificationCount,
    assignedCount,
    classifiedBy,
  });

  return { rowCount: rows.length, classificationCount, assignedCount, error: null };
}
