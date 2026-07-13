import { config } from "../lib/config.js";
import { sanitizeQuestionBankText } from "../data/postgresJsonSanitize.js";
import { chatCompletion, embeddings as openaiEmbeddings } from "../lib/openaiClient.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const MAX_CONCEPTS = 30;
const MAX_SYLLABUS_CHARS = 12000;

export function normalizeConceptKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

export async function extractConceptsFromSyllabusText(
  text,
  chapterName,
  { usageContext = null, accumulator = null } = {}
) {
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

  try {
    const payload = await chatCompletion({
      body: {
        model: config.openaiModel,
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
      },
      action: "syllabus.concepts",
      usageContext,
      accumulator,
      label: "Syllabus concept extraction",
    });

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
  } catch (err) {
    return {
      summary: "",
      concepts: [],
      contentMatchesChapter: true,
      mismatchReason: null,
      error: err?.message || String(err),
    };
  }
}

export async function fetchSyllabusEmbeddings(
  texts,
  { usageContext = null, accumulator = null } = {}
) {
  return openaiEmbeddings({
    inputs: texts,
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    action: "syllabus.embed",
    usageContext,
    accumulator,
  });
}

export { EMBEDDING_DIM };
