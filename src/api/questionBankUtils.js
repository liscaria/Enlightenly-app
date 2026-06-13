/** Helpers for question_bank rows and catalog chapter index. */

import { englishOnlyQuestionText } from "./questionExtraction.js";

export function questionBankRowToEntry(row) {
  return {
    id: row.id,
    questionNo: row.question_no,
    questionText: englishOnlyQuestionText(row.question_text || ""),
    marks: row.marks != null ? Number(row.marks) : null,
    solution: row.solution ? englishOnlyQuestionText(row.solution) : null,
    source: row.source,
    year: row.year != null ? Number(row.year) : null,
    topic: row.topic,
    chapterId: row.chapter_id,
    chapterName: row.chapter_name,
    unitId: row.unit_id,
    classId: row.class_id,
    questionPaperId: row.question_paper_id,
    materialId: row.material_id,
    originType: row.origin_type,
    extractedBy: row.extracted_by,
  };
}

export function entryToQuestionShape(entry) {
  return {
    id: entry.id,
    questionNo: entry.questionNo,
    questionText: entry.questionText,
    marks: entry.marks,
    solution: entry.solution,
    topic: entry.topic,
    chapterId: entry.chapterId,
    chapterName: entry.chapterName,
    unitId: entry.unitId,
    extractedBy: entry.extractedBy,
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
