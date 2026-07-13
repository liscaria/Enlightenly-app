#!/usr/bin/env node
/**
 * Verify usage accumulator rollup and pricing helpers.
 */
import { createUsageAccumulator, OPENAI_ACTIONS } from "../src/lib/openaiUsageAccumulator.js";
import { estimateCostUsd, PRICING_VERSION } from "../src/lib/openaiPricing.js";

let failed = 0;
function ok(label) {
  console.log(`  OK ${label}`);
}
function fail(label, detail) {
  console.error(`  FAIL ${label}:`, detail);
  failed += 1;
}

console.log("=== openaiPricing ===");
const cost = estimateCostUsd("gpt-4o", { prompt_tokens: 1_000_000, completion_tokens: 0 });
if (cost === 2.5) ok(`gpt-4o 1M input = $${cost}`);
else fail("gpt-4o pricing", cost);

const embedCost = estimateCostUsd("text-embedding-3-small", { prompt_tokens: 100_000, completion_tokens: 0 });
if (embedCost > 0 && embedCost < 0.01) ok(`embedding 100k tokens = $${embedCost}`);
else fail("embedding pricing", embedCost);

if (PRICING_VERSION) ok(`pricingVersion ${PRICING_VERSION}`);

console.log("\n=== UsageAccumulator ===");
const acc = createUsageAccumulator({
  ownerId: "00000000-0000-0000-0000-000000000001",
  jobId: "11111111-1111-1111-1111-111111111111",
  paperId: "paper-1",
  requestId: "req-1",
});

acc.record(OPENAI_ACTIONS.EXTRACT_VISION, {
  model: "gpt-4o",
  promptTokens: 50_000,
  completionTokens: 2_000,
  estimatedCostUsd: estimateCostUsd("gpt-4o", { prompt_tokens: 50_000, completion_tokens: 2_000 }),
});
acc.record(OPENAI_ACTIONS.CLASSIFY_VECTOR, {
  model: "text-embedding-3-small",
  promptTokens: 800,
  completionTokens: 0,
  estimatedCostUsd: estimateCostUsd("text-embedding-3-small", { prompt_tokens: 800, completion_tokens: 0 }),
});

const summary = acc.toSummary({ extractPath: "vision", classifiedBy: "vector" });
if (summary.extractPath === "vision") ok("extractPath in summary");
else fail("extractPath", summary.extractPath);

if (summary.byAction[OPENAI_ACTIONS.EXTRACT_VISION]?.calls === 1) ok("vision call count");
else fail("vision calls", summary.byAction);

if (summary.byAction[OPENAI_ACTIONS.CLASSIFY_VECTOR]?.calls === 1) ok("vector call count");
else fail("vector calls", summary.byAction);

if (summary.totals.promptTokens === 50_800) ok(`total prompt tokens ${summary.totals.promptTokens}`);
else fail("prompt totals", summary.totals.promptTokens);

if (summary.totals.estimatedCostUsd > 0) ok(`total cost $${summary.totals.estimatedCostUsd}`);
else fail("total cost", summary.totals);

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll usage tracking checks passed.");
process.exit(failed ? 1 : 0);
