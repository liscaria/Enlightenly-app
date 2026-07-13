// Phase 4: question_classifications CRUD.

import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import {
  CLASSIFICATION_SOURCE,
  confidenceToDisplayPercent,
  reviewStatusFromConfidence,
} from "../constants/classificationReview.js";

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[questionClassificationRemote] ${scope}:`, error.message || error);
}

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

export function classificationRowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    questionId: row.question_id,
    chapterId: row.chapter_id,
    confidence: Number(row.confidence),
    alternatives: Array.isArray(row.alternatives) ? row.alternatives : [],
    reviewStatus: row.review_status,
    classificationSource: row.classification_source,
    updatedAt: row.updated_at,
  };
}

/** @returns {Promise<Record<string, object>>} map questionId → entry */
export async function remoteQueryClassificationsByQuestionIds(ownerId, questionIds) {
  if (notReady(ownerId) || !questionIds?.length) return {};
  const { data, error } = await supabase
    .from("question_classifications")
    .select("*")
    .eq("owner_id", ownerId)
    .in("question_id", questionIds);

  if (error) {
    warn("queryByQuestionIds", error);
    return {};
  }

  const map = {};
  for (const row of data || []) {
    map[row.question_id] = classificationRowToEntry(row);
  }
  return map;
}

export async function remoteUpsertQuestionClassifications(ownerId, rows) {
  if (notReady(ownerId) || !rows?.length) return null;

  const payload = rows.map((r) => ({
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
    warn("upsertClassifications", error);
    return formatError(error);
  }
  return null;
}

/** Skip reclassify for teacher-overridden questions. */
export async function remoteQueryManualOverrideQuestionIds(ownerId, questionIds) {
  if (notReady(ownerId) || !questionIds?.length) return new Set();
  const { data, error } = await supabase
    .from("question_classifications")
    .select("question_id")
    .eq("owner_id", ownerId)
    .eq("classification_source", CLASSIFICATION_SOURCE.MANUAL_OVERRIDE)
    .in("question_id", questionIds);

  if (error) {
    warn("queryOverrides", error);
    return new Set();
  }
  return new Set((data || []).map((r) => r.question_id));
}

/**
 * Teacher override: update classification + denormalized question_bank fields.
 */
export async function remoteOverrideQuestionClassification(
  ownerId,
  questionId,
  { chapterId, chapterName, unitId, previousClassification = null }
) {
  if (notReady(ownerId)) return "Not signed in.";

  const alternatives = previousClassification?.alternatives ?? [];

  const { error: clsError } = await supabase.from("question_classifications").upsert(
    {
      owner_id: ownerId,
      question_id: questionId,
      chapter_id: chapterId,
      confidence: 1,
      alternatives,
      review_status: reviewStatusFromConfidence(1),
      classification_source: CLASSIFICATION_SOURCE.MANUAL_OVERRIDE,
    },
    { onConflict: "owner_id,question_id" }
  );

  if (clsError) {
    warn("overrideClassification", clsError);
    return formatError(clsError);
  }

  const { error: qbError } = await supabase
    .from("question_bank")
    .update({
      chapter_id: chapterId,
      chapter_name: chapterName,
      unit_id: unitId,
      chapter_confidence: confidenceToDisplayPercent(1),
    })
    .eq("owner_id", ownerId)
    .eq("id", questionId);

  if (qbError) {
    warn("overrideQuestionBank", qbError);
    return formatError(qbError);
  }

  return null;
}
