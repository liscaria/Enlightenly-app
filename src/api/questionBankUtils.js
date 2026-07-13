/** Helpers for question_bank rows and catalog chapter index. */

import { englishOnlyQuestionText } from "./questionExtraction.js";
import { dedupeRepeatedContentInText } from "./questionMerge.js";
import {
  inferExpectedQuestionCount,
  CBSE_PHYSICS_DEFAULT_QUESTION_COUNT,
} from "./cbseQuestionValidation.js";
import { normalizeDifficultyLevel } from "../constants/difficultyLevels.js";

export function questionBankRowToEntry(row) {
  return {
    id: row.id,
    questionNo: row.question_no,
    questionText: dedupeRepeatedContentInText(
      englishOnlyQuestionText(row.question_text || "")
    ),
    marks: row.marks != null ? Number(row.marks) : null,
    solution: row.solution ? englishOnlyQuestionText(row.solution) : null,
    difficultyLevel: normalizeDifficultyLevel(row.difficulty_level),
    source: row.source,
    year: row.year != null ? Number(row.year) : null,
    topic: row.topic,
    chapterId: row.chapter_id,
    chapterName: row.chapter_name,
    chapterConfidence:
      row.chapter_confidence != null ? Number(row.chapter_confidence) : null,
    unitId: row.unit_id,
    classId: row.class_id,
    questionPaperId: row.question_paper_id,
    materialId: row.material_id,
    originType: row.origin_type,
    extractedBy: row.extracted_by,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}

/** Display label for question bank Source column (exam type, year, CBSE set). */
export function formatQuestionBankSourceLabel(entry, paper) {
  const parts = [];
  if (entry.source) parts.push(entry.source);
  const year = entry.year ?? paper?.year;
  if (year) parts.push(String(year));
  const meta = entry.metadata || {};
  if (meta.series) parts.push(meta.series);
  if (meta.set) parts.push(meta.set);
  if (meta.codeNo) parts.push(`Code ${meta.codeNo}`);
  return parts.length ? parts.join(" · ") : "—";
}

export function entryToQuestionShape(entry) {
  return {
    id: entry.id,
    questionNo: entry.questionNo,
    questionText: entry.questionText,
    marks: entry.marks,
    solution: entry.solution,
    difficultyLevel: entry.difficultyLevel,
    topic: entry.topic,
    chapterId: entry.chapterId,
    chapterName: entry.chapterName,
    chapterConfidence: entry.chapterConfidence ?? null,
    unitId: entry.unitId,
    extractedBy: entry.extractedBy,
    metadata: entry.metadata || {},
  };
}

export function buildChapterIndexForClass(catalog, classId) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) return [];
  const index = [];
  for (const unit of classItem.units || []) {
    for (const unitChapter of unit.chapters || []) {
      index.push({
        id: unitChapter.id,
        unitId: unit.id,
        name: unitChapter.name,
        unitName: [unit.name, unit.title].filter(Boolean).join(" — "),
      });
    }
  }
  return index;
}

export function formatBankQuestionLabel(entry, papersById = {}) {
  const parts = [];
  if (entry.questionNo != null) parts.push(`Q${entry.questionNo}`);
  if (entry.year) parts.push(String(entry.year));
  if (entry.source) parts.push(entry.source);
  const paper = papersById[entry.questionPaperId];
  if (paper?.name) parts.push(paper.name);
  const head = parts.length ? parts.join(" · ") : "Exam question";
  const preview = (entry.questionText || "").replace(/\s+/g, " ").trim();
  const snippet =
    preview.length > 72 ? `${preview.slice(0, 72)}…` : preview;
  return { head, snippet };
}

export function questionsByChapter(entries, chapterId, { originType } = {}) {
  return entries.filter((e) => {
    if (e.chapterId !== chapterId) return false;
    if (originType && e.originType !== originType) return false;
    return true;
  });
}

export function questionsByQuestionPaper(entries, paperId) {
  return entries.filter((e) => e.questionPaperId === paperId);
}

/** Questions linked to a question-bank paper id or a chapter material file id. */
export function questionsForPaperOrMaterial(entries, id) {
  if (!id) return [];
  return entries.filter(
    (e) => e.questionPaperId === id || e.materialId === id
  );
}

export function sortPaperBankQuestions(entries) {
  return [...entries].sort((a, b) => {
    const noA = a.questionNo ?? 99999;
    const noB = b.questionNo ?? 99999;
    return noA - noB;
  });
}

/** Drop near-duplicate rows (e.g. vision re-read the same question with a different number). */
export function dedupePaperBankEntries(entries) {
  const sorted = sortPaperBankQuestions(entries);
  const out = [];
  for (const entry of sorted) {
    const duplicate = out.some((existing) => {
      const a = (existing.questionText || "").toLowerCase().replace(/[^\w\s]/g, "");
      const b = (entry.questionText || "").toLowerCase().replace(/[^\w\s]/g, "");
      if (!a || !b) return false;
      const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 3));
      const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 3));
      let inter = 0;
      for (const w of wordsA) if (wordsB.has(w)) inter += 1;
      const union = wordsA.size + wordsB.size - inter;
      return union > 0 && inter / union >= 0.72;
    });
    if (!duplicate) out.push(entry);
  }
  return out;
}

function gatherPaperMetaFromEntries(entries) {
  let totalQuestions = null;
  let instructionsText = "";
  let sectionRules = [];

  for (const entry of entries) {
    const meta = entry.metadata || {};
    const tq = Number(meta.totalQuestions ?? meta.total_questions);
    if (!totalQuestions && Number.isFinite(tq) && tq >= 1) totalQuestions = tq;
    if (!instructionsText && meta.generalInstructions?.trim()) {
      instructionsText = meta.generalInstructions.trim();
    }
    if (!sectionRules.length && meta.sectionMarkRules?.length) {
      sectionRules = meta.sectionMarkRules;
    }
  }

  return { totalQuestions, instructionsText, sectionRules };
}

/** One bank row per question number — trust saved rows; do not re-validate on display. */
export function uniquePaperQuestions(allEntries, paperId) {
  const paperEntries = allEntries.filter((e) => e.questionPaperId === paperId);
  if (!paperEntries.length) return [];

  const byNo = new Map();
  for (const entry of sortPaperBankQuestions(paperEntries)) {
    const no = Number(entry.questionNo);
    if (!Number.isFinite(no) || no < 1) continue;

    const existing = byNo.get(no);
    const textLen = (entry.questionText || "").trim().length;
    const existingLen = (existing?.questionText || "").trim().length;
    if (!existing || textLen > existingLen) {
      byNo.set(no, entry);
    }
  }
  return sortPaperBankQuestions([...byNo.values()]);
}

export function missingPaperQuestionNumbers(allEntries, paperId) {
  const expected = expectedPaperQuestionCount(allEntries, paperId);
  if (!expected) return [];
  const present = new Set(
    uniquePaperQuestions(allEntries, paperId).map((e) => e.questionNo)
  );
  const missing = [];
  for (let i = 1; i <= expected; i += 1) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/** @deprecated alias — same as uniquePaperQuestions */
export function validatedPaperQuestions(allEntries, paperId) {
  return uniquePaperQuestions(allEntries, paperId);
}

export function expectedPaperQuestionCount(allEntries, paperId) {
  const paperEntries = allEntries.filter((e) => e.questionPaperId === paperId);
  if (!paperEntries.length) return null;

  const meta = gatherPaperMetaFromEntries(paperEntries);
  const questions = paperEntries.map((e) => entryToQuestionShape(e));
  const expected = inferExpectedQuestionCount({
    totalQuestions: meta.totalQuestions,
    sectionRules: meta.sectionRules,
    instructionsText: meta.instructionsText,
    questions,
  });
  if (expected) return expected;

  const extracted = uniquePaperQuestions(allEntries, paperId).length;
  if (extracted >= 16) return CBSE_PHYSICS_DEFAULT_QUESTION_COUNT;
  return null;
}

export function countPaperBankQuestions(allEntries, paperId) {
  return uniquePaperQuestions(allEntries, paperId).length;
}

/** e.g. "31 questions" or "31 of 33 questions (missing Q16, Q17)" */
export function formatPaperQuestionCount(allEntries, paperId) {
  const extracted = countPaperBankQuestions(allEntries, paperId);
  if (!extracted) return null;
  const expected = expectedPaperQuestionCount(allEntries, paperId);
  if (!expected || extracted === expected) {
    return `${extracted} question${extracted === 1 ? "" : "s"}`;
  }
  return `${extracted} of ${expected} questions`;
}

/** Stamp paper total on every row so reload can infer expected count without instructions text. */
export function stampPaperExpectedTotal(questions, expectedCount) {
  if (!expectedCount || !questions?.length) return questions;
  return questions.map((q) => ({
    ...q,
    metadata: {
      ...(q.metadata || {}),
      totalQuestions: expectedCount,
    },
  }));
}

export function sortChapterBankQuestions(entries) {
  return [...entries].sort((a, b) => {
    const noA = a.questionNo ?? 99999;
    const noB = b.questionNo ?? 99999;
    if (noA !== noB) return noA - noB;
    const yearA = a.year ?? 0;
    const yearB = b.year ?? 0;
    if (yearA !== yearB) return yearB - yearA;
    return (a.source || "").localeCompare(b.source || "");
  });
}
