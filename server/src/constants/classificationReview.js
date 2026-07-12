/** Chapter classification confidence and review thresholds. */

export const CLASSIFICATION_REVIEW = {
  AUTO_APPROVED_MIN: 0.85,
  SUGGEST_REVIEW_MIN: 0.6,
};

export const REVIEW_STATUS = {
  AUTO_APPROVED: "AUTO_APPROVED",
  SUGGEST_REVIEW: "SUGGEST_REVIEW",
  MANUAL_REVIEW_REQUIRED: "MANUAL_REVIEW_REQUIRED",
};

export const CLASSIFICATION_SOURCE = {
  VECTOR: "VECTOR",
  AI_RERANK: "AI_RERANK",
  MANUAL_OVERRIDE: "MANUAL_OVERRIDE",
  HEURISTIC_FALLBACK: "HEURISTIC_FALLBACK",
};

/** @param {number} confidence 0–1 */
export function reviewStatusFromConfidence(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return REVIEW_STATUS.MANUAL_REVIEW_REQUIRED;
  if (c >= CLASSIFICATION_REVIEW.AUTO_APPROVED_MIN) return REVIEW_STATUS.AUTO_APPROVED;
  if (c >= CLASSIFICATION_REVIEW.SUGGEST_REVIEW_MIN) return REVIEW_STATUS.SUGGEST_REVIEW;
  return REVIEW_STATUS.MANUAL_REVIEW_REQUIRED;
}

/** Display confidence on question_bank: 0–100 integer. */
export function confidenceToDisplayPercent(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return null;
  return Math.max(0, Math.min(100, Math.round(c * 100)));
}
