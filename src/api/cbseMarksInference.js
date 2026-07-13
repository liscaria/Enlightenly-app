/**
 * CBSE exam papers often print marks per section in General Instructions,
 * not beside each question. Infer marks from question number when missing.
 */

/** Typical CBSE Class 11/12 Physics paper (33 questions). */
export const CBSE_PHYSICS_DEFAULT_SECTION_MARKS = [
  { section: "A", questionFrom: 1, questionTo: 16, marks: 1 },
  { section: "B", questionFrom: 17, questionTo: 21, marks: 2 },
  { section: "C", questionFrom: 22, questionTo: 28, marks: 3 },
  { section: "D", questionFrom: 29, questionTo: 30, marks: 4 },
  { section: "E", questionFrom: 31, questionTo: 33, marks: 5 },
];

export function normalizeSectionRules(rawRules) {
  if (!Array.isArray(rawRules)) return [];
  return rawRules
    .map((r) => ({
      section: r.section ?? r.sectionId ?? null,
      questionFrom: Number(r.from ?? r.questionFrom ?? r.question_from ?? r.start),
      questionTo: Number(r.to ?? r.questionTo ?? r.question_to ?? r.end),
      marks: Number(r.marks ?? r.mark),
    }))
    .filter(
      (r) =>
        Number.isFinite(r.questionFrom) &&
        Number.isFinite(r.questionTo) &&
        Number.isFinite(r.marks) &&
        r.questionFrom <= r.questionTo
    );
}

/**
 * Parse "Section A – Questions no. 1 to 16 … carries 1 mark" blocks from instructions text.
 */
export function parseSectionMarksFromInstructions(text) {
  if (!text?.trim()) return [];
  const rules = [];
  const patterns = [
    /Section\s+([A-E])\s*[–—-][\s\S]*?Questions?\s*(?:no\.?\s*)?(\d{1,2})\s*(?:to|-)\s*(\d{1,2})[\s\S]*?carries?\s*(\d{1,2})\s*marks?/gi,
    /Section\s+([A-E])[\s\S]*?(\d{1,2})\s*(?:to|-)\s*(\d{1,2})[\s\S]*?(\d{1,2})\s*marks?\s*each/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const questionFrom = Number(match[2]);
      const questionTo = Number(match[3]);
      const marks = Number(match[4]);
      if (!Number.isFinite(marks)) continue;
      rules.push({
        section: match[1].toUpperCase(),
        questionFrom: Math.min(questionFrom, questionTo),
        questionTo: Math.max(questionFrom, questionTo),
        marks,
      });
    }
  }

  const bySection = new Map();
  for (const rule of rules) {
    bySection.set(rule.section, rule);
  }
  return [...bySection.values()].sort((a, b) => a.questionFrom - b.questionFrom);
}

/** e.g. "Maximum Marks: 70" or "Total Marks : 70" */
export function parseTotalMarksFromInstructions(text) {
  if (!text?.trim()) return null;
  const patterns = [
    /maximum\s+marks?\s*[:\-–—]?\s*(\d{1,3})/i,
    /total\s+marks?\s*[:\-–—]?\s*(\d{1,3})/i,
    /(?:paper|examination)\s+(?:is\s+of|carries?)\s+(\d{1,3})\s+marks?/i,
    /(\d{1,3})\s+marks?\s*(?:in\s+all|total|maximum)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (count >= 1 && count <= 500) return count;
  }
  return null;
}

/** Sum marks for questions 1..questionCount using section rules. */
export function computeTotalMarksFromSectionRules(sectionRules, questionCount) {
  const count = Number(questionCount);
  if (!Number.isFinite(count) || count < 1) return null;

  const rules = normalizeSectionRules(sectionRules);
  if (!rules.length) return null;

  let sum = 0;
  for (let qNo = 1; qNo <= count; qNo += 1) {
    const marks = inferMarksForQuestionNo(qNo, rules);
    if (marks == null) return null;
    sum += marks;
  }
  return sum;
}

/** e.g. "This question paper contains 33 questions" */
export function parseTotalQuestionsFromInstructions(text) {
  if (!text?.trim()) return null;
  const patterns = [
    /(?:question\s+paper\s+)?contains?\s+(\d{1,3})\s+questions?/i,
    /(?:there\s+are|consists?\s+of)\s+(\d{1,3})\s+questions?/i,
    /(?:total\s+of\s+)?(\d{1,3})\s+questions?\s+(?:in\s+all|altogether)/i,
    /(\d{1,3})\s+questions?\s+in\s+all/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const count = Number(match[1]);
    if (count >= 1 && count <= 500) return count;
  }
  return null;
}

export function maxQuestionNoFromSectionRules(sectionRules) {
  const rules = normalizeSectionRules(sectionRules);
  if (!rules.length) return null;
  return Math.max(...rules.map((r) => r.questionTo));
}

export function inferMarksForQuestionNo(questionNo, sectionRules) {
  const no = Number(questionNo);
  if (!Number.isFinite(no)) return null;
  for (const rule of sectionRules) {
    if (no >= rule.questionFrom && no <= rule.questionTo) {
      return rule.marks;
    }
  }
  return null;
}

/**
 * Fill missing marks using section rules (AI-provided, parsed instructions, or CBSE default).
 */
export function applyCbseSectionMarks(questions, { sectionRules = [], instructionsText = "" } = {}) {
  if (!questions?.length) return questions;

  let rules = normalizeSectionRules(sectionRules);
  if (!rules.length && instructionsText) {
    rules = parseSectionMarksFromInstructions(instructionsText);
  }
  if (!rules.length) {
    rules = CBSE_PHYSICS_DEFAULT_SECTION_MARKS;
  }

  return questions.map((q) => {
    if (q.marks != null && Number(q.marks) > 0) return q;
    const inferred = inferMarksForQuestionNo(q.questionNo, rules);
    if (inferred == null) return q;
    return {
      ...q,
      marks: inferred,
      metadata: {
        ...(q.metadata || {}),
        marksInferred: true,
        marksSource: "section_rules",
      },
    };
  });
}
