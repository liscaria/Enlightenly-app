/**
 * Question extraction engine flags (GitHub issue #6).
 */
export const EXTRACTION_FEATURE_FLAGS = {
  /** Extract answer/solution text from PDFs */
  extractSolutions: false,
  /** Assign questions to syllabus chapters after extraction (Phase 2b) */
  classifyToChapters: true,
  /** Use vector KB classification when syllabus embeddings exist (Phase 2b) */
  useVectorClassification: true,
  /** Write extracted questions to question_bank after successful extraction (Phase 2) */
  persistToQuestionBank: true,
  /** Auto-extract incomplete papers on library load */
  autoExtractOnLoad: false,
  /** Only normalize symbols (vectors, subscripts); never rewrite words or guess fractions */
  strictVerbatim: true,
};
