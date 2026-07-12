import { log } from "../lib/logger.js";
import { CLASSIFICATION_SOURCE } from "../constants/classificationReview.js";

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

const UPSERT_BATCH_SIZE = 40;

export async function upsertQuestionClassifications(supabase, ownerId, rows) {
  if (!rows?.length) return null;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const payload = batch.map((r) => ({
      owner_id: ownerId,
      question_id: r.questionId,
      chapter_id: r.chapterId,
      confidence: Math.max(0, Math.min(1, Number(r.confidence))),
      alternatives: r.alternatives ?? [],
      review_status: r.reviewStatus,
      classification_source: r.classificationSource,
    }));

    const { error } = await supabase
      .from("question_classifications")
      .upsert(payload, { onConflict: "owner_id,question_id" });

    if (error) {
      log("warn", "classifications.upsert", { error: error.message });
      return formatError(error);
    }
  }
  return null;
}

/**
 * Load MANUAL_OVERRIDE rows for a paper keyed by question_no (for re-extract with new UUIDs).
 * @returns {Promise<Map<number, object>>}
 */
export async function queryManualOverridesByQuestionNo(supabase, ownerId, questionPaperId) {
  const map = new Map();
  if (!ownerId || !questionPaperId) return map;

  const { data: bankRows, error: bankErr } = await supabase
    .from("question_bank")
    .select("id, question_no")
    .eq("owner_id", ownerId)
    .eq("question_paper_id", questionPaperId);

  if (bankErr || !bankRows?.length) {
    if (bankErr) log("warn", "classifications.queryOverrides.bank", { error: bankErr.message });
    return map;
  }

  const ids = bankRows.map((r) => r.id);
  const { data: clsRows, error: clsErr } = await supabase
    .from("question_classifications")
    .select("question_id, chapter_id, confidence, alternatives, review_status, classification_source")
    .eq("owner_id", ownerId)
    .eq("classification_source", CLASSIFICATION_SOURCE.MANUAL_OVERRIDE)
    .in("question_id", ids);

  if (clsErr) {
    log("warn", "classifications.queryOverrides.cls", { error: clsErr.message });
    return map;
  }

  const noById = new Map(bankRows.map((r) => [r.id, r.question_no]));
  for (const row of clsRows || []) {
    const questionNo = noById.get(row.question_id);
    if (questionNo == null) continue;
    map.set(Number(questionNo), {
      chapterId: row.chapter_id,
      confidence: Number(row.confidence),
      alternatives: Array.isArray(row.alternatives) ? row.alternatives : [],
      reviewStatus: row.review_status,
      classificationSource: row.classification_source,
    });
  }
  return map;
}
