import { log } from "../lib/logger.js";

function parseEmbedding(raw) {
  if (raw == null) return null;
  if (Array.isArray(raw)) return raw.length ? raw : null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Chapter KB profiles with embeddings for vector classification.
 */
export async function queryKnowledgeEmbeddingsForClass(supabase, ownerId, classId) {
  if (!ownerId || !classId) return [];

  const { data: knowledgeRows, error: kErr } = await supabase
    .from("syllabus_knowledge")
    .select(
      "chapter_id, unit_id, chapter_name, title_embedding, summary_embedding, extract_status"
    )
    .eq("owner_id", ownerId)
    .eq("class_id", classId);

  if (kErr) {
    log("warn", "syllabusKnowledge.queryEmbeddings", { error: kErr.message });
    return [];
  }

  const chapterIds = (knowledgeRows || []).map((r) => r.chapter_id).filter(Boolean);
  if (!chapterIds.length) return [];

  const { data: conceptRows, error: cErr } = await supabase
    .from("chapter_concepts")
    .select("chapter_id, concept_name, concept_embedding, position")
    .eq("owner_id", ownerId)
    .in("chapter_id", chapterIds)
    .order("position");

  if (cErr) {
    log("warn", "syllabusKnowledge.queryConcepts", { error: cErr.message });
  }

  const conceptsByChapter = {};
  for (const row of conceptRows || []) {
    const emb = parseEmbedding(row.concept_embedding);
    if (!emb) continue;
    if (!conceptsByChapter[row.chapter_id]) conceptsByChapter[row.chapter_id] = [];
    conceptsByChapter[row.chapter_id].push({
      conceptName: row.concept_name,
      embedding: emb,
    });
  }

  return (knowledgeRows || [])
    .map((row) => {
      const titleEmbedding = parseEmbedding(row.title_embedding);
      const summaryEmbedding = parseEmbedding(row.summary_embedding);
      const concepts = conceptsByChapter[row.chapter_id] || [];
      if (!titleEmbedding && !summaryEmbedding && !concepts.length) return null;
      return {
        chapterId: row.chapter_id,
        unitId: row.unit_id,
        chapterName: row.chapter_name,
        titleEmbedding,
        summaryEmbedding,
        concepts,
        extractStatus: row.extract_status,
      };
    })
    .filter(Boolean);
}
