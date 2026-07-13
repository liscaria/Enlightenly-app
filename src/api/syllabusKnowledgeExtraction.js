// Phase 3: extract concepts + summary from syllabus text and compute embeddings.

import { sanitizeQuestionBankText } from "./postgresJsonSanitize.js";
import { isExtractionApiConfigured } from "./extractionApiConfig.js";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const MAX_CONCEPTS = 30;
const MAX_SYLLABUS_CHARS = 12000;

export function isSyllabusExtractionConfigured() {
  if (isExtractionApiConfigured()) return true;
  return Boolean(OPENAI_API_KEY);
}

/** Normalize for dedupe: lowercase, strip punctuation, collapse whitespace. */
export function normalizeConceptKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Dedupe concept names while preserving first-seen casing. */
export function normalizeConceptNames(concepts) {
  if (!Array.isArray(concepts)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of concepts) {
    const name = sanitizeQuestionBankText(String(raw || "").trim());
    if (!name) continue;
    const key = normalizeConceptKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_CONCEPTS) break;
  }
  return out;
}

function syllabusTextForExtraction(text) {
  const trimmed = (text || "").trim();
  if (trimmed.length <= MAX_SYLLABUS_CHARS) return trimmed;
  const half = Math.floor(MAX_SYLLABUS_CHARS / 2);
  return `${trimmed.slice(0, half)}\n\n[... middle omitted ...]\n\n${trimmed.slice(-half)}`;
}

/**
 * @returns {Promise<{ summary: string, concepts: string[], contentMatchesChapter: boolean, mismatchReason: string|null, error: string|null }>}
 */
export async function extractConceptsFromSyllabusText(text, chapterName) {
  if (!OPENAI_API_KEY) {
    return {
      summary: "",
      concepts: [],
      contentMatchesChapter: true,
      mismatchReason: null,
      error: "OpenAI API key is not configured (VITE_OPENAI_API_KEY).",
    };
  }

  const syllabusBody = syllabusTextForExtraction(text);
  if (!syllabusBody) {
    return {
      summary: "",
      concepts: [],
      contentMatchesChapter: true,
      mismatchReason: null,
      error: "Syllabus text is empty.",
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You extract a syllabus knowledge base for ONE known catalog chapter.
Return JSON:
{
  "summary": "2-4 sentence English summary of what this chapter covers",
  "concepts": ["Concept 1", "Concept 2", ...],
  "contentMatchesChapter": true,
  "mismatchReason": null
}

Rules:
- The chapter name is already known from the teacher's catalog — do NOT guess a different chapter.
- concepts: key topics, laws, formulas, phenomena, or skills (English only). At least 1, at most ${MAX_CONCEPTS}.
- If the document appears to be for a different subject/chapter than the catalog name, set contentMatchesChapter to false and explain briefly in mismatchReason.
- For bullet-only syllabi, still extract concepts from the list.
- No markdown in strings.`,
        },
        {
          role: "user",
          content: `Catalog chapter name: ${chapterName}

Syllabus document:
${syllabusBody}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return {
      summary: "",
      concepts: [],
      contentMatchesChapter: true,
      mismatchReason: null,
      error: `Concept extraction failed (${response.status}): ${detail.slice(0, 200)}`,
    };
  }

  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      summary: "",
      concepts: [],
      contentMatchesChapter: true,
      mismatchReason: null,
      error: "Concept extraction returned invalid JSON.",
    };
  }

  const summary = sanitizeQuestionBankText(parsed.summary ?? "");
  const concepts = normalizeConceptNames(parsed.concepts ?? []);
  const contentMatchesChapter = parsed.contentMatchesChapter !== false;
  const mismatchReason = parsed.mismatchReason
    ? sanitizeQuestionBankText(String(parsed.mismatchReason))
    : null;

  return {
    summary,
    concepts,
    contentMatchesChapter,
    mismatchReason,
    error: null,
  };
}

/**
 * Batch embed texts with text-embedding-3-small (1536 dims).
 * @param {string[]} texts
 * @returns {Promise<{ embeddings: (number[]|null)[], error: string|null }>}
 */
export async function fetchEmbeddings(texts) {
  if (!OPENAI_API_KEY) {
    return { embeddings: [], error: "OpenAI API key is not configured." };
  }
  const inputs = (texts || []).map((t) => (t || "").trim()).filter(Boolean);
  if (!inputs.length) {
    return { embeddings: [], error: null };
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
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

export { EMBEDDING_DIM };
