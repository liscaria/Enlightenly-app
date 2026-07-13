#!/usr/bin/env node
/**
 * Phase 1 smoke test: config, extraction imports, optional /health.
 * Usage: npm run smoke [-- --health]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const runHealth = process.argv.includes("--health");
const port = process.env.PORT || 3000;

const { isOpenAIConfigured } = await import("../src/extraction/questionExtraction.js");
const { questionBankRowsFromQuestionPaper } = await import("../src/data/questionBankRemote.js");
const { persistPaperQuestions } = await import("../src/jobs/persistPaperQuestions.js");
const { classifyPaperQuestions, mergeManualOverridesByQuestionNo } = await import("../src/jobs/classifyPaperQuestions.js");
const { buildChapterIndexForClass } = await import("../src/data/questionBankUtils.js");
const { EXTRACTION_FEATURE_FLAGS } = await import("../src/config/extractionConfig.js");
const { estimateCostUsd, PRICING_VERSION } = await import("../src/lib/openaiPricing.js");
const { createUsageAccumulator } = await import("../src/lib/openaiUsageAccumulator.js");

console.log("extraction module: ok");
console.log("persist module: ok");
console.log("classify module: ok");
console.log("openai configured:", isOpenAIConfigured);
console.log("persistToQuestionBank:", EXTRACTION_FEATURE_FLAGS.persistToQuestionBank);
console.log("classifyToChapters:", EXTRACTION_FEATURE_FLAGS.classifyToChapters);
console.log("useVectorClassification:", EXTRACTION_FEATURE_FLAGS.useVectorClassification);
console.log("openai pricing version:", PRICING_VERSION);
if (estimateCostUsd("gpt-4o-mini", { prompt_tokens: 1000, completion_tokens: 100 }) <= 0) {
  console.error("estimateCostUsd smoke failed");
  process.exit(1);
}
void createUsageAccumulator;

const sampleRows = questionBankRowsFromQuestionPaper(
  "00000000-0000-0000-0000-000000000001",
  { id: "paper-1", class_id: "class-xii", paper_source: "Final exam", year: 2026 },
  {
    questions: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        questionNo: 1,
        questionText: "Sample question",
        marks: 1,
        extractedBy: "ai",
      },
    ],
  }
);
if (sampleRows.length !== 1 || sampleRows[0].origin_type !== "question_paper") {
  console.error("questionBankRowsFromQuestionPaper smoke failed:", sampleRows);
  process.exit(1);
}
console.log("questionBankRowsFromQuestionPaper: ok");
void persistPaperQuestions;
void classifyPaperQuestions;
void mergeManualOverridesByQuestionNo;

const chapterIndex = buildChapterIndexForClass(
  [{ id: "class-1", units: [{ id: "u1", name: "Unit 1", chapters: [{ id: "ch1", name: "Chapter 1" }] }] }],
  "class-1"
);
if (chapterIndex.length !== 1 || chapterIndex[0].id !== "ch1") {
  console.error("buildChapterIndexForClass smoke failed:", chapterIndex);
  process.exit(1);
}
console.log("buildChapterIndexForClass: ok");

if (runHealth) {
  const res = await fetch(`http://localhost:${port}/health`);
  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error("health check failed:", res.status, body);
    process.exit(1);
  }
  console.log("health:", body);
}
