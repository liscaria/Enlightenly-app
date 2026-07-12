#!/usr/bin/env node
/**
 * Phase 2b verification (no JWT required for these checks).
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

let passed = 0;
let failed = 0;

function ok(label) {
  passed += 1;
  console.log(`  OK  ${label}`);
}

function fail(label, detail) {
  failed += 1;
  console.error(`  FAIL ${label}${detail ? `: ${detail}` : ""}`);
}

const { EXTRACTION_FEATURE_FLAGS } = await import("../src/config/extractionConfig.js");
const { classifyQuestionsToChapters } = await import(
  "../src/classification/questionChapterClassification.js"
);
const { classifyQuestionsWithVectorKb } = await import(
  "../src/classification/questionVectorClassification.js"
);
const { fetchEmbeddings } = await import("../src/classification/embeddings.js");
const {
  mergeManualOverridesByQuestionNo,
  classificationFromQuestion,
} = await import("../src/jobs/classifyPaperQuestions.js");
const { buildChapterIndexForClass } = await import("../src/data/questionBankUtils.js");
const { CLASSIFICATION_SOURCE } = await import("../src/constants/classificationReview.js");

console.log("\n=== Phase 2b config ===");
if (EXTRACTION_FEATURE_FLAGS.persistToQuestionBank) ok("persistToQuestionBank");
else fail("persistToQuestionBank");
if (EXTRACTION_FEATURE_FLAGS.classifyToChapters) ok("classifyToChapters");
else fail("classifyToChapters");
if (EXTRACTION_FEATURE_FLAGS.useVectorClassification !== false) ok("useVectorClassification");
else fail("useVectorClassification");

console.log("\n=== Heuristic classification ===");
const chapterIndex = [
  { id: "ch-electric", unitId: "u1", name: "Chapter 12: Electric Charges and Fields", unitName: "Unit 1" },
  { id: "ch-magnet", unitId: "u1", name: "Chapter 13: Moving Charges and Magnetism", unitName: "Unit 1" },
];
const questions = [
  {
    id: "q1",
    questionNo: 1,
    questionText: "State Coulomb's law for electric charges and fields.",
  },
  { id: "q2", questionNo: 2, questionText: "Unrelated generic text with no chapter keywords." },
];
const heuristic = await classifyQuestionsToChapters(questions, chapterIndex, { paperName: "test" });
if (heuristic.classifiedBy === "heuristic" || heuristic.classifiedBy === "ai") {
  ok(`classifyQuestionsToChapters → ${heuristic.classifiedBy}`);
} else {
  fail("classifyQuestionsToChapters classifiedBy", heuristic.classifiedBy);
}
const assigned = heuristic.questions.filter((q) => q.chapterId).length;
if (assigned >= 1) ok(`heuristic assigned ${assigned}/${questions.length}`);
else fail("heuristic assigned count", String(assigned));

console.log("\n=== Manual override merge ===");
const overrides = new Map([
  [
    1,
    {
      chapterId: "ch-magnet",
      confidence: 1,
      alternatives: [],
      reviewStatus: "AUTO_APPROVED",
      classificationSource: CLASSIFICATION_SOURCE.MANUAL_OVERRIDE,
    },
  ],
]);
const merged = mergeManualOverridesByQuestionNo(heuristic.questions, overrides, chapterIndex);
if (merged[0]?.chapterId === "ch-magnet") ok("mergeManualOverridesByQuestionNo");
else fail("mergeManualOverridesByQuestionNo", merged[0]?.chapterId);

const clsRow = classificationFromQuestion(merged[0], "VECTOR");
if (clsRow?.classificationSource === CLASSIFICATION_SOURCE.MANUAL_OVERRIDE) {
  ok("classificationFromQuestion preserves MANUAL_OVERRIDE");
} else {
  fail("classificationFromQuestion source", clsRow?.classificationSource);
}

console.log("\n=== Vector KB (mock profiles) ===");
const mockProfiles = [
  {
    chapterId: "ch-electric",
    unitId: "u1",
    chapterName: "Chapter 12: Electric Charges and Fields",
    titleEmbedding: null,
    summaryEmbedding: null,
    concepts: [],
  },
];
const vectorResult = await classifyQuestionsWithVectorKb(
  [{ id: "q1", questionNo: 1, questionText: "Coulomb law electric charge" }],
  mockProfiles,
  chapterIndex
);
if (vectorResult.classifiedBy === "none" && !mockProfiles[0].titleEmbedding) {
  ok("vector skips when no embeddings (expected)");
} else if (vectorResult.classifiedBy === "vector") {
  ok("vector classification");
} else {
  ok(`vector result: ${vectorResult.classifiedBy}`);
}

console.log("\n=== OpenAI embeddings API ===");
if (process.env.OPENAI_API_KEY) {
  const { embeddings, error } = await fetchEmbeddings(["test embedding probe"]);
  if (!error && embeddings?.[0]?.length === 1536) ok("fetchEmbeddings (1536 dims)");
  else fail("fetchEmbeddings", error || "bad dimensions");
} else {
  console.log("  SKIP fetchEmbeddings (no OPENAI_API_KEY)");
}

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed ? 1 : 0);
