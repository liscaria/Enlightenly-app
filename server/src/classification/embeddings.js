import { config } from "../lib/config.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

/**
 * Batch embed texts with text-embedding-3-small (1536 dims).
 * @param {string[]} texts
 * @returns {Promise<{ embeddings: (number[]|null)[], error: string|null }>}
 */
export async function fetchEmbeddings(texts) {
  if (!config.openaiApiKey) {
    return { embeddings: [], error: "OpenAI API key is not configured." };
  }
  const inputs = (texts || []).map((t) => (t || "").trim()).filter(Boolean);
  if (!inputs.length) {
    return { embeddings: [], error: null };
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: inputs,
      dimensions: EMBEDDING_DIM,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      embeddings: [],
      error: `Embedding failed (${response.status}): ${detail.slice(0, 200)}`,
    };
  }

  const payload = await response.json();
  const sorted = (payload?.data || []).sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );
  const embeddings = sorted.map((item) => {
    const vec = item?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) return null;
    return vec;
  });

  if (embeddings.length !== inputs.length) {
    return {
      embeddings: [],
      error: "Embedding response count mismatch.",
    };
  }

  return { embeddings, error: null };
}
