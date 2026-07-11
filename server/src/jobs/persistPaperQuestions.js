import { EXTRACTION_FEATURE_FLAGS } from "../config/extractionConfig.js";
import { log } from "../lib/logger.js";
import { ensurePaperReadyForBank } from "../data/questionPapersRemote.js";
import {
  questionBankRowsFromQuestionPaper,
  upsertQuestionBank,
  deleteOrphanQuestionBankRows,
} from "../data/questionBankRemote.js";

/**
 * Persist extracted questions to question_bank (Phase 2).
 * Upserts first, deletes orphan rows second — never wipe-first.
 */
export async function persistPaperQuestions({
  supabase,
  ownerId,
  paper,
  questions,
  requestId,
  jobId,
  paperId,
}) {
  if (!EXTRACTION_FEATURE_FLAGS.persistToQuestionBank) {
    return { rowCount: 0, error: null, skipped: true };
  }

  if (!questions?.length) {
    return { rowCount: 0, error: "No questions to persist." };
  }

  const ensureErr = await ensurePaperReadyForBank(supabase, ownerId, paper);
  if (ensureErr) {
    return { rowCount: 0, error: ensureErr };
  }

  const rows = questionBankRowsFromQuestionPaper(ownerId, paper, { questions });
  if (!rows.length) {
    return { rowCount: 0, error: "Could not build question_bank rows." };
  }

  const upsertErr = await upsertQuestionBank(supabase, ownerId, rows);
  if (upsertErr) {
    log("error", "persist.upsertFailed", {
      requestId,
      jobId,
      paperId,
      error: upsertErr,
    });
    return { rowCount: 0, error: upsertErr };
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
    return { rowCount: rows.length, error: deleteErr };
  }

  log("info", "persist.completed", {
    requestId,
    jobId,
    paperId,
    rowCount: rows.length,
  });

  return { rowCount: rows.length, error: null };
}
