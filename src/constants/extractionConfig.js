/**
 * Question extraction engine flags (GitHub issue #6).
 */
export const EXTRACTION_FEATURE_FLAGS = {
  /** Extract answer/solution text from PDFs */
  extractSolutions: false,
  /** Assign questions to syllabus chapters after extraction */
  classifyToChapters: true,
  /** Use Phase 4 vector KB classification when syllabus embeddings exist */
  useVectorClassification: true,
  /** Auto-extract incomplete papers on library load */
  autoExtractOnLoad: false,
  /** Only normalize symbols (vectors, subscripts); never rewrite words or guess fractions */
  strictVerbatim: true,
};
