/** Helpers for catalog chapter index (server). */

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

/** Convert a question_bank DB row to the in-memory question shape used by classification. */
export function bankRowToQuestion(row) {
  return {
    id: row.id,
    questionNo: row.question_no,
    questionText: row.question_text || "",
    marks: row.marks != null ? Number(row.marks) : null,
    solution: row.solution || null,
    topic: row.topic || null,
    chapterId: row.chapter_id,
    chapterName: row.chapter_name,
    chapterConfidence: row.chapter_confidence != null ? Number(row.chapter_confidence) : null,
    unitId: row.unit_id,
    extractedBy: row.extracted_by || "existing",
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
  };
}
