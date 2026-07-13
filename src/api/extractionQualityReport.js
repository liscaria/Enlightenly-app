/**
 * Extraction quality validation: count match, missing sequence, duplicates.
 */

import {
  CBSE_PHYSICS_DEFAULT_SECTION_MARKS,
  computeTotalMarksFromSectionRules,
  normalizeSectionRules,
  parseSectionMarksFromInstructions,
  parseTotalMarksFromInstructions,
} from "./cbseMarksInference.js";
import {
  inferExpectedQuestionCount,
  CBSE_PHYSICS_DEFAULT_QUESTION_COUNT,
} from "./cbseQuestionValidation.js";

/** e.g. [22,23,24,25] → "22-25", [3,5,7] → "3, 5, 7" */
export function formatQuestionNumberRanges(numbers) {
  if (!numbers?.length) return "";
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(", ");
}

/** Same one-row-per-question dedupe as the marks column in the UI. */
function uniqueQuestionsForMarksSum(questions) {
  const byNo = new Map();
  for (const entry of questions || []) {
    const no = Number(entry.questionNo ?? entry.question_no);
    if (!Number.isFinite(no) || no < 1) continue;
    const existing = byNo.get(no);
    const textLen = (entry.questionText || "").trim().length;
    const existingLen = (existing?.questionText || "").trim().length;
    if (!existing || textLen > existingLen) byNo.set(no, entry);
  }
  return [...byNo.values()];
}

/** Sum marks exactly as shown in the Marks column (one row per question number). */
export function sumMarksFromQuestions(questions) {
  const rows = uniqueQuestionsForMarksSum(questions);
  let sum = 0;
  let withMarks = 0;
  for (const q of rows) {
    const marks = Number(q.marks);
    if (!Number.isFinite(marks) || marks <= 0) continue;
    sum += marks;
    withMarks += 1;
  }
  return { sum, questionCount: rows.length, withMarks };
}

function countByQuestionNumber(items) {
  const byNumber = new Map();
  for (const item of items) {
    const no = Number(item.questionNo ?? item.question_no);
    if (!Number.isFinite(no) || no < 1) continue;
    if (!byNumber.has(no)) byNumber.set(no, 0);
    byNumber.set(no, byNumber.get(no) + 1);
  }
  return byNumber;
}

/**
 * Core analysis from question numbers present in the paper.
 * @param {number[]} presentNumbers - unique question numbers found
 * @param {number|null} expectedCount - total from original paper
 * @param {Map<number, number>} countByNo - occurrences per question number
 */
export function analyzeQuestionNumberSequence(
  presentNumbers,
  expectedCount,
  countByNo = null
) {
  const unique = [...new Set(presentNumbers)].filter((n) => Number.isFinite(n) && n >= 1).sort(
    (a, b) => a - b
  );
  const extractedCount = unique.length;
  const counts = countByNo ?? new Map(unique.map((n) => [n, 1]));

  const duplicateNumbers = unique.filter((n) => (counts.get(n) || 0) > 1);

  const missing = [];
  const extra = [];
  if (expectedCount && expectedCount >= 1) {
    for (let i = 1; i <= expectedCount; i += 1) {
      if (!unique.includes(i)) missing.push(i);
    }
    for (const n of unique) {
      if (n > expectedCount) extra.push(n);
    }
  }

  const issues = [];

  if (expectedCount) {
    if (extractedCount !== expectedCount) {
      const gap = expectedCount - extractedCount;
      issues.push(
        `Count mismatch: ${extractedCount} extracted vs ${expectedCount} in original paper (${Math.abs(gap)} ${gap > 0 ? "missing" : "extra"}).`
      );
    }
  } else if (extractedCount > 0) {
    issues.push("Original paper total unknown — could not verify count against source.");
  }

  if (missing.length) {
    issues.push(
      `Missing question${missing.length > 1 ? "s" : ""} ${formatQuestionNumberRanges(missing)}`
    );
  }

  for (const no of duplicateNumbers) {
    issues.push(`Duplicated Question ${no}`);
  }

  if (extra.length) {
    issues.push(
      `Extra question number${extra.length > 1 ? "s" : ""} beyond paper total: ${formatQuestionNumberRanges(extra)}`
    );
  }

  let validationStatus = "Pending";
  if (extractedCount === 0) {
    validationStatus = "Failed";
  } else if (issues.length === 0 && expectedCount) {
    validationStatus = "Passed";
  } else if (extractedCount > 0) {
    validationStatus = "Needs Review";
  }

  return {
    status: extractedCount > 0 ? "Completed" : "Not Extracted",
    validationStatus,
    extractedCount,
    expectedCount: expectedCount ?? null,
    missing,
    duplicateNumbers,
    extraNumbers: extra,
    issues,
    manualReviewRequired: issues.length > 0,
  };
}

function gatherPaperMetaFromEntries(entries) {
  let totalQuestions = null;
  let totalMarks = null;
  let instructionsText = "";
  let sectionRules = [];

  for (const entry of entries) {
    const meta = entry.metadata || {};
    const tq = Number(meta.totalQuestions ?? meta.total_questions);
    if (!totalQuestions && Number.isFinite(tq) && tq >= 1) totalQuestions = tq;
    const tm = Number(meta.totalMarks ?? meta.total_marks);
    if (!totalMarks && Number.isFinite(tm) && tm >= 1) totalMarks = tm;
    if (!instructionsText && meta.generalInstructions?.trim()) {
      instructionsText = meta.generalInstructions.trim();
    }
    if (!sectionRules.length && meta.sectionMarkRules?.length) {
      sectionRules = meta.sectionMarkRules;
    }
  }

  return { totalQuestions, totalMarks, instructionsText, sectionRules };
}

function inferExpectedTotalMarks({
  totalQuestions = null,
  totalMarks = null,
  sectionRules = [],
  instructionsText = "",
  expectedCount = null,
} = {}) {
  if (Number.isFinite(totalMarks) && totalMarks >= 1) return totalMarks;

  const fromInstructions = parseTotalMarksFromInstructions(instructionsText);
  if (fromInstructions) return fromInstructions;

  const questionCount = totalQuestions ?? expectedCount;
  if (!questionCount) return null;

  let rules = normalizeSectionRules(sectionRules);
  if (!rules.length && instructionsText) {
    rules = parseSectionMarksFromInstructions(instructionsText);
  }
  if (!rules.length && questionCount === CBSE_PHYSICS_DEFAULT_QUESTION_COUNT) {
    rules = CBSE_PHYSICS_DEFAULT_SECTION_MARKS;
  }

  return computeTotalMarksFromSectionRules(rules, questionCount);
}

function analyzeMarks(questions, meta, expectedCount) {
  const expectedTotalMarks = inferExpectedTotalMarks({
    totalQuestions: meta.totalQuestions,
    totalMarks: meta.totalMarks,
    sectionRules: meta.sectionRules,
    instructionsText: meta.instructionsText,
    expectedCount,
  });
  const { sum: extractedMarksSum, questionCount, withMarks } = sumMarksFromQuestions(questions);
  const missingMarksCount = questionCount - withMarks;

  const marksIssues = [];
  if (expectedTotalMarks != null && withMarks > 0 && extractedMarksSum !== expectedTotalMarks) {
    marksIssues.push(
      `Marks mismatch: ${extractedMarksSum} from extracted questions vs ${expectedTotalMarks} in original paper.`
    );
  } else if (missingMarksCount > 0) {
    marksIssues.push(
      `${missingMarksCount} extracted question${missingMarksCount === 1 ? "" : "s"} missing marks.`
    );
  }

  return {
    expectedTotalMarks,
    extractedMarksSum: withMarks > 0 ? extractedMarksSum : null,
    extractedMarksWithValues: withMarks,
    missingMarksCount,
    marksIssues,
  };
}

function mergeMarksIntoReport(report, marksAnalysis) {
  const issues = [...(report.issues || []), ...(marksAnalysis.marksIssues || [])];
  let validationStatus = report.validationStatus;
  if (marksAnalysis.marksIssues?.length && validationStatus === "Passed") {
    validationStatus = "Needs Review";
  }

  return {
    ...report,
    ...marksAnalysis,
    issues,
    manualReviewRequired: issues.length > 0,
    validationStatus,
  };
}

function expectedCountForPaperEntries(paperEntries) {
  if (!paperEntries?.length) return null;
  const meta = gatherPaperMetaFromEntries(paperEntries);
  const questions = paperEntries.map((e) => ({
    questionNo: e.questionNo,
    marks: e.marks,
    metadata: e.metadata || {},
  }));
  const expected = inferExpectedQuestionCount({
    totalQuestions: meta.totalQuestions,
    sectionRules: meta.sectionRules,
    instructionsText: meta.instructionsText,
    questions,
  });
  if (expected) return expected;
  const unique = new Set(
    paperEntries.map((e) => Number(e.questionNo)).filter((n) => Number.isFinite(n) && n >= 1)
  );
  if (unique.size >= 16) return CBSE_PHYSICS_DEFAULT_QUESTION_COUNT;
  return null;
}

/** Build report from question_bank rows for one paper. */
export function buildPaperExtractionQualityReport(allEntries, paperId) {
  const paperEntries = (allEntries || []).filter((e) => e.questionPaperId === paperId);

  if (!paperEntries.length) {
    return {
      status: "Not Extracted",
      validationStatus: "Pending",
      extractedCount: 0,
      expectedCount: null,
      rawRowCount: 0,
      missing: [],
      duplicateNumbers: [],
      extraNumbers: [],
      issues: ["No questions extracted yet."],
      manualReviewRequired: true,
    };
  }

  const expected = expectedCountForPaperEntries(paperEntries);
  const byNumber = countByQuestionNumber(paperEntries);
  const presentNumbers = [...byNumber.keys()];

  const meta = gatherPaperMetaFromEntries(paperEntries);
  const report = analyzeQuestionNumberSequence(presentNumbers, expected, byNumber);
  const displayedQuestions = uniqueQuestionsForMarksSum(paperEntries);
  const marksAnalysis = analyzeMarks(displayedQuestions, meta, expected);
  return mergeMarksIntoReport(
    {
      ...report,
      rawRowCount: paperEntries.length,
    },
    marksAnalysis
  );
}

/** Build report immediately after extraction (before / after save). */
export function buildExtractionQualityReportFromQuestions(questions, validation = null) {
  const expected = validation?.expectedCount ?? null;
  const byNumber = countByQuestionNumber(questions || []);
  const presentNumbers = [...byNumber.keys()];

  let report = analyzeQuestionNumberSequence(presentNumbers, expected, byNumber);

  if (validation?.missing?.length) {
    const fromValidation = validation.missing.filter((n) => !report.missing.includes(n));
    if (fromValidation.length) {
      report.missing = [...new Set([...report.missing, ...validation.missing])].sort(
        (a, b) => a - b
      );
    }
  }

  const meta = gatherPaperMetaFromEntries(questions || []);
  const marksAnalysis = analyzeMarks(questions, meta, expected);
  report = mergeMarksIntoReport(report, marksAnalysis);

  return report;
}

/** One-line summary for toast notifications. */
export function formatExtractionQualitySummary(report) {
  if (!report) return "";
  if (report.status === "Not Extracted") return "";

  const parts = [];
  if (report.expectedCount) {
    parts.push(`${report.extractedCount}/${report.expectedCount} questions`);
  } else {
    parts.push(`${report.extractedCount} question${report.extractedCount === 1 ? "" : "s"}`);
  }

  if (report.validationStatus === "Passed") {
    parts.push("Validation passed.");
  } else if (report.issues?.length) {
    parts.push(`Validation: ${report.validationStatus}. ${report.issues[0]}`);
  }

  if (report.manualReviewRequired) {
    parts.push("Manual review required.");
  }

  return parts.length ? ` ${parts.join(" ")}` : "";
}

/** Lines shown in the hover details panel and modal. */
export function getExtractionQualityDetailLines(report) {
  if (!report || report.status === "Not Extracted") return [];

  const lines = [];
  if (report.expectedCount != null) {
    lines.push(
      `Questions found: ${report.extractedCount} / ${report.expectedCount}`
    );
  } else {
    lines.push(`Questions found: ${report.extractedCount}`);
  }

  if (report.expectedCount) {
    lines.push(
      report.missing?.length
        ? `Missing questions: ${formatQuestionNumberRanges(report.missing)}`
        : "Missing questions: None"
    );
  }

  const dupes = report.duplicateNumbers || [];
  lines.push(
    dupes.length
      ? `Duplicated question${dupes.length > 1 ? "s" : ""}: ${formatQuestionNumberRanges(dupes)}`
      : "Duplicated question: None"
  );

  const extractedMarks =
    report.extractedMarksSum != null ? String(report.extractedMarksSum) : "Unknown";
  const actualTotal =
    report.expectedTotalMarks != null ? String(report.expectedTotalMarks) : "Unknown";
  lines.push(
    `Total marks of extracted Questions: ${extractedMarks} (Extracted questions) / ${actualTotal} (Actual total)`
  );

  return lines;
}
