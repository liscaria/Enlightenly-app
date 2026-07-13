/**
 * Validate exam paper extractions: one row per question number, drop junk,
 * confirm count against the paper's stated total (not a fixed global cap).
 */

import {
  normalizeSectionRules,
  parseTotalQuestionsFromInstructions,
  maxQuestionNoFromSectionRules,
  CBSE_PHYSICS_DEFAULT_SECTION_MARKS,
  inferMarksForQuestionNo,
} from "./cbseMarksInference.js";
import { mergeDuplicateQuestionEntries } from "./questionMerge.js";

/** Fallback when paper metadata is unavailable (typical CBSE Physics). */
export const CBSE_PHYSICS_DEFAULT_QUESTION_COUNT = 33;

/** Sanity ceiling for hallucinated question numbers when expected count is unknown. */
const ABSOLUTE_MAX_QUESTION_NO = 500;

const INSTRUCTION_JUNK =
  /General Instructions|All questions are compulsory|contains \d+ questions|Read the following instructions|SECTION\s*[-–—]\s*[A-E]\s*$/im;

function setKeyFor(q) {
  return `${q.metadata?.series ?? ""}:${q.metadata?.set ?? ""}:${q.metadata?.codeNo ?? ""}`;
}

function isValidQuestionRow(q, maxQuestionNo) {
  const no = Number(q.questionNo);
  if (!Number.isFinite(no) || no < 1 || no > maxQuestionNo) return false;
  const text = (q.questionText || "").trim();
  if (text.length < 12) return false;
  if (INSTRUCTION_JUNK.test(text)) return false;
  return true;
}

/**
 * Infer how many questions this paper should contain (priority: AI field → instructions → section rules).
 */
export function inferExpectedQuestionCount({
  totalQuestions = null,
  sectionRules = [],
  instructionsText = "",
  questions = [],
} = {}) {
  const fromAi = Number(totalQuestions);
  if (Number.isFinite(fromAi) && fromAi >= 1 && fromAi <= ABSOLUTE_MAX_QUESTION_NO) {
    return fromAi;
  }

  const fromInstructions = parseTotalQuestionsFromInstructions(instructionsText);
  if (fromInstructions) return fromInstructions;

  if (questions?.length) {
    const fromMeta = inferExpectedFromQuestionsMetadata(questions);
    if (fromMeta) return fromMeta;

    const fromMarks = inferExpectedFromMarksPattern(questions);
    if (fromMarks) return fromMarks;
  }

  const fromRules = maxQuestionNoFromSectionRules(sectionRules);
  if (fromRules) {
    const maxPresent = maxQuestionNumberInSet(questions);
    // Partial AI section rules must not cap below questions already extracted.
    if (!maxPresent || fromRules >= maxPresent) return fromRules;
  }

  return null;
}

function maxQuestionNumberInSet(questions) {
  if (!questions?.length) return null;
  let max = 0;
  for (const q of questions) {
    const no = Number(q.questionNo);
    if (Number.isFinite(no) && no > max) max = no;
  }
  return max >= 1 ? max : null;
}

function inferExpectedFromQuestionsMetadata(questions) {
  for (const q of questions) {
    const meta = q.metadata || {};
    const tq = Number(meta.totalQuestions ?? meta.total_questions);
    if (Number.isFinite(tq) && tq >= 1 && tq <= ABSOLUTE_MAX_QUESTION_NO) return tq;
    const parsed = parseTotalQuestionsFromInstructions(meta.generalInstructions || "");
    if (parsed) return parsed;
  }
  return null;
}

/** When marks match CBSE Physics section rules, infer total from the highest section end. */
function inferExpectedFromMarksPattern(questions) {
  if (!questions?.length || questions.length < 16) return null;

  let checked = 0;
  let matches = 0;
  for (const q of questions) {
    const no = Number(q.questionNo);
    if (!Number.isFinite(no) || no < 1 || no > 40) continue;
    const expected = inferMarksForQuestionNo(no, CBSE_PHYSICS_DEFAULT_SECTION_MARKS);
    if (expected == null) continue;
    checked += 1;
    if (q.marks != null && Number(q.marks) === expected) matches += 1;
  }
  if (checked < 15 || matches / checked < 0.65) return null;
  return Math.max(...CBSE_PHYSICS_DEFAULT_SECTION_MARKS.map((r) => r.questionTo));
}

export function confirmQuestionNumbering(questions, expectedCount) {
  if (!expectedCount) {
    return {
      confirmed: null,
      expectedCount: null,
      actualCount: questions.length,
      missing: [],
      extra: [],
    };
  }

  const present = new Set(questions.map((q) => q.questionNo));
  const missing = [];
  for (let i = 1; i <= expectedCount; i += 1) {
    if (!present.has(i)) missing.push(i);
  }
  const extra = [
    ...new Set(
      questions
        .filter((q) => q.questionNo < 1 || q.questionNo > expectedCount)
        .map((q) => q.questionNo)
    ),
  ].sort((a, b) => a - b);

  const confirmed =
    missing.length === 0 && extra.length === 0 && questions.length === expectedCount;

  return {
    confirmed,
    expectedCount,
    actualCount: questions.length,
    missing,
    extra,
  };
}

/**
 * Enforce one row per questionNo, drop near-duplicates and junk, confirm against paper total.
 */
export function validateCbseQuestionSet(
  questions,
  {
    expectedQuestionCount = null,
    sectionRules = [],
    instructionsText = "",
    totalQuestions = null,
  } = {}
) {
  const rules = normalizeSectionRules(sectionRules);

  const expectedCount =
    expectedQuestionCount ??
    inferExpectedQuestionCount({
      totalQuestions,
      sectionRules: rules,
      instructionsText,
    });

  const maxQuestionNo = expectedCount ?? ABSOLUTE_MAX_QUESTION_NO;

  if (!questions?.length) {
    return {
      questions: [],
      dropped: 0,
      expectedCount,
      ...confirmQuestionNumbering([], expectedCount),
    };
  }

  let dropped = 0;

  let filtered = questions.filter((q) => {
    if (!isValidQuestionRow(q, maxQuestionNo)) {
      dropped += 1;
      return false;
    }
    return true;
  });

  const byNumber = new Map();
  for (const q of filtered) {
    const key = `${setKeyFor(q)}::${q.questionNo}`;
    const existing = byNumber.get(key);
    if (!existing) {
      byNumber.set(key, q);
    } else {
      byNumber.set(key, mergeDuplicateQuestionEntries(existing, q));
      dropped += 1;
    }
  }
  filtered = [...byNumber.values()].sort((a, b) => a.questionNo - b.questionNo);

  let final = filtered.sort((a, b) => a.questionNo - b.questionNo);
  if (expectedCount) {
    final = final.filter((q) => q.questionNo >= 1 && q.questionNo <= expectedCount);
  }

  dropped = questions.length - final.length;

  const confirmation = confirmQuestionNumbering(final, expectedCount);

  if (dropped > 0 || !confirmation.confirmed) {
    console.warn("[questionExtraction] Question set validation.", {
      before: questions.length,
      after: final.length,
      expectedCount,
      dropped,
      missing: confirmation.missing,
      extra: confirmation.extra,
    });
  }

  return {
    questions: final,
    dropped,
    expectedCount,
    ...confirmation,
  };
}

export function extractionCountWarning(validation) {
  if (!validation?.expectedCount) return null;

  const { expectedCount, actualCount, missing, confirmed } = validation;
  if (confirmed) return null;

  const parts = [];
  if (actualCount !== expectedCount) {
    parts.push(`Extracted ${actualCount} of ${expectedCount} expected questions.`);
  }
  if (missing?.length) {
    const shown = missing.slice(0, 10);
    const suffix = missing.length > 10 ? ` (+${missing.length - 10} more)` : "";
    parts.push(`Missing: Q${shown.join(", Q")}${suffix}.`);
    const firstGap = missing[0];
    if (firstGap && firstGap <= 20) {
      parts.push(
        `A gap at Q${firstGap} often shifts later numbers (e.g. paper Q17 shown as Q16). Re-run Update question bank.`
      );
    }
  }
  if (validation.dropped > 0) {
    parts.push(`Removed ${validation.dropped} duplicate or invalid row(s).`);
  }
  if (actualCount < expectedCount * 0.5 && !missing?.length) {
    parts.push("Try Update question bank again or use a clearer PDF.");
  }
  return parts.join(" ");
}
