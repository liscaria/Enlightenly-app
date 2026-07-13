import { embeddings as openaiEmbeddings } from "../lib/openaiClient.js";
import { OPENAI_ACTIONS } from "../lib/openaiUsageAccumulator.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

/**
 * Batch embed texts with text-embedding-3-small (1536 dims).
 * @param {string[]} texts
 * @param {{ action?: string, usageContext?: object, accumulator?: object, metadata?: object }} [opts]
 * @returns {Promise<{ embeddings: (number[]|null)[], error: string|null }>}
 */
export async function fetchEmbeddings(texts, opts = {}) {
  const {
    action = OPENAI_ACTIONS.CLASSIFY_VECTOR,
    usageContext = null,
    accumulator = null,
    metadata = {},
  } = opts;

  return openaiEmbeddings({
    inputs: texts,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    action,
    usageContext,
    accumulator,
    metadata,
  });
}

export { EMBEDDING_MODEL, EMBEDDING_DIM };
