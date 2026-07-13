import { log } from "../lib/logger.js";
import { createUsageAccumulator } from "../lib/openaiUsageAccumulator.js";
import { documentTextFromBlob } from "../extraction/questionExtraction.js";
import { downloadMaterialBlob } from "../data/materialsRemote.js";
import {
  markSyllabusKnowledgePending,
  replaceChapterConcepts,
  upsertSyllabusKnowledge,
} from "../data/syllabusKnowledgeWrite.js";
import {
  extractConceptsFromSyllabusText,
  fetchSyllabusEmbeddings,
} from "../syllabus/syllabusKnowledgeExtraction.js";

const SCANNED_PDF_ERROR =
  "Could not extract text from this PDF. Upload a text-based (not scanned) syllabus PDF.";

async function persistKnowledgeFailure(supabase, ownerId, ctx, error, usageContext) {
  const extractedAt = new Date().toISOString();
  const { id, error: upsertError } = await upsertSyllabusKnowledge(supabase, ownerId, {
    classId: ctx.classId,
    unitId: ctx.unitId,
    chapterId: ctx.chapterId,
    materialId: ctx.materialId,
    chapterName: ctx.chapterName,
    summary: null,
    titleEmbedding: null,
    summaryEmbedding: null,
    extractStatus: "failed",
    extractError: error,
    mismatchWarning: false,
    conceptCount: 0,
    extractedAt,
  });

  if (upsertError) {
    return { status: "failed", mismatchWarning: false, conceptCount: 0, error: upsertError };
  }

  if (id) {
    await replaceChapterConcepts(supabase, ownerId, id, ctx.chapterId, []);
  }

  return {
    status: "failed",
    mismatchWarning: false,
    conceptCount: 0,
    error,
    syllabusKnowledgeId: id,
  };
}

async function persistTitleOnlyFailure(
  supabase,
  ownerId,
  ctx,
  { titleEmbedding, error },
  usageContext
) {
  const extractedAt = new Date().toISOString();
  const { id, error: upsertError } = await upsertSyllabusKnowledge(supabase, ownerId, {
    classId: ctx.classId,
    unitId: ctx.unitId,
    chapterId: ctx.chapterId,
    materialId: ctx.materialId,
    chapterName: ctx.chapterName,
    summary: null,
    titleEmbedding,
    summaryEmbedding: null,
    extractStatus: "failed",
    extractError: error,
    mismatchWarning: false,
    conceptCount: 0,
    extractedAt,
  });

  if (upsertError) {
    return { status: "failed", mismatchWarning: false, conceptCount: 0, error: upsertError };
  }

  if (id) {
    await replaceChapterConcepts(supabase, ownerId, id, ctx.chapterId, []);
  }

  return {
    status: "failed",
    mismatchWarning: false,
    conceptCount: 0,
    error,
    syllabusKnowledgeId: id,
  };
}

/**
 * Build syllabus knowledge for one catalog chapter (server-side OpenAI).
 */
export async function buildSyllabusKnowledgeJob({
  supabase,
  ownerId,
  requestId,
  classId,
  unitId,
  chapterId,
  chapterName,
  materialId,
}) {
  const ctx = { classId, unitId, chapterId, chapterName, materialId };
  const accumulator = createUsageAccumulator({ ownerId, jobId: null, paperId: null, requestId });
  const usageContext = { supabase, ownerId, jobId: null, paperId: null, requestId };

  const { data: chapterRow, error: chapterErr } = await supabase
    .from("chapters")
    .select("id")
    .eq("owner_id", ownerId)
    .eq("id", chapterId)
    .maybeSingle();

  if (chapterErr) throw new Error(chapterErr.message);
  if (!chapterRow) {
    throw new Error("Chapter not found in catalog. Sync your class structure first.");
  }

  const pendingResult = await markSyllabusKnowledgePending(supabase, ownerId, ctx);
  if (pendingResult?.error) {
    throw new Error(
      `${pendingResult.error} (Run migration_syllabus_knowledge.sql in Supabase if the table is missing.)`
    );
  }

  const downloaded = await downloadMaterialBlob(supabase, ownerId, materialId);
  if (!downloaded?.blob) {
    return persistKnowledgeFailure(
      supabase,
      ownerId,
      ctx,
      "Could not load syllabus file from cloud storage.",
      usageContext
    );
  }

  let text = "";
  try {
    text = await documentTextFromBlob(
      downloaded.blob,
      downloaded.mimeType,
      downloaded.name
    );
  } catch (err) {
    const msg = err?.message || "Could not read syllabus file.";
    const { embeddings, error: embedErr } = await fetchSyllabusEmbeddings([chapterName], {
      usageContext,
      accumulator,
    });
    if (embedErr) {
      return persistKnowledgeFailure(supabase, ownerId, ctx, embedErr, usageContext);
    }
    return persistTitleOnlyFailure(
      supabase,
      ownerId,
      ctx,
      { titleEmbedding: embeddings[0] ?? null, error: msg },
      usageContext
    );
  }

  const trimmed = (text || "").trim();
  if (!trimmed) {
    const { embeddings, error: embedErr } = await fetchSyllabusEmbeddings([chapterName], {
      usageContext,
      accumulator,
    });
    if (embedErr) {
      return persistKnowledgeFailure(supabase, ownerId, ctx, embedErr, usageContext);
    }
    return persistTitleOnlyFailure(
      supabase,
      ownerId,
      ctx,
      { titleEmbedding: embeddings[0] ?? null, error: SCANNED_PDF_ERROR },
      usageContext
    );
  }

  const extracted = await extractConceptsFromSyllabusText(trimmed, chapterName, {
    usageContext,
    accumulator,
  });
  if (extracted.error) {
    return persistKnowledgeFailure(supabase, ownerId, ctx, extracted.error, usageContext);
  }

  if (!extracted.concepts.length) {
    const { embeddings, error: embedErr } = await fetchSyllabusEmbeddings([chapterName], {
      usageContext,
      accumulator,
    });
    if (embedErr) {
      return persistKnowledgeFailure(supabase, ownerId, ctx, embedErr, usageContext);
    }
    return persistTitleOnlyFailure(
      supabase,
      ownerId,
      ctx,
      { titleEmbedding: embeddings[0] ?? null, error: "No concepts could be extracted from this syllabus." },
      usageContext
    );
  }

  const embedInputs = [chapterName, extracted.summary, ...extracted.concepts];
  const { embeddings, error: embedErr } = await fetchSyllabusEmbeddings(embedInputs, {
    usageContext,
    accumulator,
  });
  if (embedErr) {
    return persistKnowledgeFailure(supabase, ownerId, ctx, embedErr, usageContext);
  }

  const titleEmbedding = embeddings[0] ?? null;
  const summaryEmbedding = embeddings[1] ?? null;
  const conceptEmbeddings = embeddings.slice(2);
  const mismatchWarning = !extracted.contentMatchesChapter;
  const extractedAt = new Date().toISOString();

  const { id, error: upsertError } = await upsertSyllabusKnowledge(supabase, ownerId, {
    classId,
    unitId,
    chapterId,
    materialId,
    chapterName,
    summary: extracted.summary,
    titleEmbedding,
    summaryEmbedding,
    extractStatus: "complete",
    extractError: mismatchWarning ? extracted.mismatchReason : null,
    mismatchWarning,
    conceptCount: extracted.concepts.length,
    extractedAt,
  });

  if (upsertError) {
    return persistKnowledgeFailure(supabase, ownerId, ctx, upsertError, usageContext);
  }

  const concepts = extracted.concepts.map((conceptName, index) => ({
    conceptName,
    conceptEmbedding: conceptEmbeddings[index] ?? null,
    position: index,
  }));

  const conceptsErr = await replaceChapterConcepts(supabase, ownerId, id, chapterId, concepts);
  if (conceptsErr) {
    return persistKnowledgeFailure(supabase, ownerId, ctx, conceptsErr, usageContext);
  }

  const usageSummary = accumulator.toSummary({ extractStatus: "complete" });

  log("info", "syllabus.build.completed", {
    requestId,
    ownerId,
    chapterId,
    conceptCount: extracted.concepts.length,
    mismatchWarning,
    usage: accumulator.totals(),
  });

  return {
    status: "complete",
    mismatchWarning,
    conceptCount: extracted.concepts.length,
    error: null,
    syllabusKnowledgeId: id,
    usageSummary,
  };
}
