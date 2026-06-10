/** Unified source labels for every row in public.question_bank */
export const QUESTION_BANK_SOURCES = [
  "Class work",
  "Test",
  "Final exam",
  "Model exam",
  "Others",
];

export const MATERIAL_QUESTION_SOURCES = ["Class work", "Test"];
export const EXAM_QUESTION_PAPER_SOURCES = ["Final exam", "Model exam", "Others"];

export function sourceFromMaterialExamSource(examSource) {
  if (examSource === "Class work" || examSource === "Test") return examSource;
  if (examSource === "Class test") return "Class work";
  if (examSource === "Public exam") return "Others";
  return "Class work";
}

export function sourceFromQuestionPaper(paperSource) {
  if (QUESTION_BANK_SOURCES.includes(paperSource)) return paperSource;
  return "Others";
}
