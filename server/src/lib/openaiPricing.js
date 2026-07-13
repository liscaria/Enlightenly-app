/** OpenAI model pricing (USD per 1M tokens). Update when OpenAI changes rates. */
export const PRICING_VERSION = "2025-07";

const DEFAULT_RATES = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "text-embedding-3-small": { inputPerMillion: 0.02, outputPerMillion: 0 },
};

function loadRateOverrides() {
  const raw = (process.env.OPENAI_PRICE_OVERRIDES_JSON || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    console.warn("[openaiPricing] Invalid OPENAI_PRICE_OVERRIDES_JSON — using defaults.");
    return {};
  }
}

const RATE_OVERRIDES = loadRateOverrides();

function ratesForModel(model) {
  const key = (model || "").trim();
  if (RATE_OVERRIDES[key]) return RATE_OVERRIDES[key];
  if (DEFAULT_RATES[key]) return DEFAULT_RATES[key];
  if (key.startsWith("gpt-4o-mini")) return DEFAULT_RATES["gpt-4o-mini"];
  if (key.startsWith("gpt-4o")) return DEFAULT_RATES["gpt-4o"];
  if (key.includes("embedding")) return DEFAULT_RATES["text-embedding-3-small"];
  return { inputPerMillion: 0, outputPerMillion: 0 };
}

/**
 * @param {string} model
 * @param {{ prompt_tokens?: number, completion_tokens?: number }} usage
 * @returns {number} estimated USD cost
 */
export function estimateCostUsd(model, usage = {}) {
  const prompt = Number(usage.prompt_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  const rates = ratesForModel(model);
  const inputCost = (prompt / 1_000_000) * (rates.inputPerMillion || 0);
  const outputCost = (completion / 1_000_000) * (rates.outputPerMillion || 0);
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
