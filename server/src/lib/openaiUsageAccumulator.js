import { PRICING_VERSION } from "./openaiPricing.js";

export const OPENAI_ACTIONS = {
  EXTRACT_TEXT: "extract.text",
  EXTRACT_VISION: "extract.vision",
  CLASSIFY_VECTOR: "classify.vector",
  CLASSIFY_LLM: "classify.llm",
  SYLLABUS_CONCEPTS: "syllabus.concepts",
  SYLLABUS_EMBED: "syllabus.embed",
};

function emptyBucket() {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

/**
 * In-memory rollup of OpenAI usage for one extraction job.
 */
export function createUsageAccumulator({ ownerId, jobId, paperId, requestId } = {}) {
  const byAction = new Map();

  function bucket(action) {
    if (!byAction.has(action)) byAction.set(action, emptyBucket());
    return byAction.get(action);
  }

  return {
    ownerId,
    jobId,
    paperId,
    requestId,

    record(action, { model, promptTokens = 0, completionTokens = 0, totalTokens = 0, estimatedCostUsd = 0 }) {
      const b = bucket(action);
      b.calls += 1;
      b.promptTokens += promptTokens;
      b.completionTokens += completionTokens;
      b.totalTokens += totalTokens || promptTokens + completionTokens;
      b.estimatedCostUsd = Math.round((b.estimatedCostUsd + estimatedCostUsd) * 1_000_000) / 1_000_000;
      void model;
    },

    totals() {
      let promptTokens = 0;
      let completionTokens = 0;
      let estimatedCostUsd = 0;
      for (const b of byAction.values()) {
        promptTokens += b.promptTokens;
        completionTokens += b.completionTokens;
        estimatedCostUsd += b.estimatedCostUsd;
      }
      return {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: Math.round(estimatedCostUsd * 1_000_000) / 1_000_000,
      };
    },

    toSummary({ extractPath = null, classifiedBy = null } = {}) {
      const byActionObj = {};
      for (const [action, b] of byAction.entries()) {
        byActionObj[action] = { ...b };
      }
      return {
        pricingVersion: PRICING_VERSION,
        extractPath,
        classifiedBy,
        byAction: byActionObj,
        totals: this.totals(),
      };
    },
  };
}
