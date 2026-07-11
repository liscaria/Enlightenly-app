/** Unified source labels for every row in public.question_bank */
export const QUESTION_BANK_SOURCES = [
  "Class work",
  "Test",
  "Final exam",
  "Model exam",
  "Others",
];

export function sourceFromQuestionPaper(paperSource) {
  if (QUESTION_BANK_SOURCES.includes(paperSource)) return paperSource;
  return "Others";
}
