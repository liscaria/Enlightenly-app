// Phase 3 orchestrator: syllabus PDF → concepts + embeddings → Supabase.

import { documentTextFromBlob } from "./questionExtraction.js";
import {
  extractConceptsFromSyllabusText,
  fetchEmbeddings,
  isSyllabusExtractionConfigured,
} from "./syllabusKnowledgeExtraction.js";
import { isExtractionApiConfigured } from "./extractionApiConfig.js";
import { buildSyllabusKnowledgeRemote } from "./extractionApiRemote.js";
import {
  remoteMarkSyllabusKnowledgePending,
  remoteReplaceChapterConcepts,
  remoteUpsertSyllabusKnowledge,
} from "./syllabusKnowledgeRemote.js";

const SCANNED_PDF_ERROR =
  "Could not extract text from this PDF. Upload a text-based (not scanned) syllabus PDF.";

async function fetchMaterialBlob(materialId, { libraryGet, remoteDownloadMaterial, ownerId }) {
  let blob = null;
  let mimeType = null;
  let name = null;

  if (typeof libraryGet === "function") {
    const rec = await libraryGet(materialId);
    if (rec?.blob) {
      blob = rec.blob;
      mimeType = rec.mimeType;
      name = rec.name;
    }
  }

  if (!blob && ownerId && typeof remoteDownloadMaterial === "function") {
    const remote = await remoteDownloadMaterial(ownerId, materialId);
    if (remote?.blob) {
      blob = remote.blob;
      mimeType = remote.mimeType || mimeType;
      name = remote.name || name;
    }
  }

  return { blob, mimeType, name };
}

async function persistKnowledgeFailure(ownerId, ctx, error) {
  const extractedAt = new Date().toISOString();
  const { id, error: upsertError } = await remoteUpsertSyllabusKnowledge(ownerId, {
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
    await remoteReplaceChapterConcepts(ownerId, id, ctx.chapterId, []);
  }

  return {
    status: "failed",
    mismatchWarning: false,
    conceptCount: 0,
    error,
    syllabusKnowledgeId: id,
  };
}

async function persistTitleOnlyFailure(ownerId, ctx, { titleEmbedding, error }) {
  const extractedAt = new Date().toISOString();
  const { id, error: upsertError } = await remoteUpsertSyllabusKnowledge(ownerId, {
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
    await remoteReplaceChapterConcepts(ownerId, id, ctx.chapterId, []);
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
 * Build syllabus knowledge for one catalog chapter.
 * @returns {Promise<{ status: string, mismatchWarning: boolean, conceptCount: number, error: string|null, syllabusKnowledgeId?: string }>}
 */
export async function buildSyllabusKnowledgeForChapter(
  ownerId,
  {
    catalog,
    classId,
    unitId,
    chapterId,
    chapterName,
    materialId,
    libraryGet,
    remoteDownloadMaterial,
    remoteEnsureCatalogBranch,
  }
) {
  const ctx = { classId, unitId, chapterId, chapterName, materialId };

  if (!ownerId) {
    return {
      status: "failed",
      mismatchWarning: false,
      conceptCount: 0,
      error: "Sign in to build syllabus knowledge.",
    };
  }

  if (isExtractionApiConfigured()) {
    return buildSyllabusKnowledgeRemote({
      chapterId,
      classId,
      unitId,
      chapterName,
      materialId,
    });
  }

  if (!isSyllabusExtractionConfigured()) {
    return {
      status: "failed",
      mismatchWarning: false,
      conceptCount: 0,
      error: "OpenAI API key is not configured (VITE_OPENAI_API_KEY).",
    };
  }

  if (typeof remoteEnsureCatalogBranch === "function") {
    const branchErr = await remoteEnsureCatalogBranch(
      ownerId,
      catalog,
      classId,
      unitId,
      chapterId
    );
    if (branchErr) {
      return {
        status: "failed",
        mismatchWarning: false,
        conceptCount: 0,
        error: branchErr,
      };
    }
  }

  const pendingResult = await remoteMarkSyllabusKnowledgePending(ownerId, ctx);
  if (pendingResult?.error) {
    return {
      status: "failed",
      mismatchWarning: false,
      conceptCount: 0,
      error: `${pendingResult.error} (Run migration_syllabus_knowledge.sql in Supabase if the table is missing.)`,
    };
  }

  const { blob, mimeType, name } = await fetchMaterialBlob(materialId, {
    libraryGet,
    remoteDownloadMaterial,
    ownerId,
  });

  if (!blob) {
    return persistKnowledgeFailure(
      ownerId,
      ctx,
      "Could not load syllabus file from device or cloud storage."
    );
  }

  let text = "";
  try {
    text = await documentTextFromBlob(blob, mimeType, name);
  } catch (err) {
    const msg = err?.message || "Could not read syllabus file.";
    const { embeddings, error: embedErr } = await fetchEmbeddings([chapterName]);
    if (embedErr) {
      return persistKnowledgeFailure(ownerId, ctx, embedErr);
    }
    return persistTitleOnlyFailure(ownerId, ctx, {
      titleEmbedding: embeddings[0] ?? null,
      error: msg,
    });
  }

  const trimmed = (text || "").trim();
  if (!trimmed) {
    const { embeddings, error: embedErr } = await fetchEmbeddings([chapterName]);
    if (embedErr) {
      return persistKnowledgeFailure(ownerId, ctx, embedErr);
    }
    return persistTitleOnlyFailure(ownerId, ctx, {
      titleEmbedding: embeddings[0] ?? null,
      error: SCANNED_PDF_ERROR,
    });
  }

  const extracted = await extractConceptsFromSyllabusText(trimmed, chapterName);
  if (extracted.error) {
    return persistKnowledgeFailure(ownerId, ctx, extracted.error);
  }

  if (!extracted.concepts.length) {
    const { embeddings, error: embedErr } = await fetchEmbeddings([chapterName]);
    if (embedErr) {
      return persistKnowledgeFailure(ownerId, ctx, embedErr);
    }
    return persistTitleOnlyFailure(ownerId, ctx, {
      titleEmbedding: embeddings[0] ?? null,
      error: "No concepts could be extracted from this syllabus.",
    });
  }

  const embedInputs = [chapterName, extracted.summary, ...extracted.concepts];
  const { embeddings, error: embedErr } = await fetchEmbeddings(embedInputs);
  if (embedErr) {
    return persistKnowledgeFailure(ownerId, ctx, embedErr);
  }

  const titleEmbedding = embeddings[0] ?? null;
  const summaryEmbedding = embeddings[1] ?? null;
  const conceptEmbeddings = embeddings.slice(2);
  const mismatchWarning = !extracted.contentMatchesChapter;
  const extractedAt = new Date().toISOString();

  const { id, error: upsertError } = await remoteUpsertSyllabusKnowledge(ownerId, {
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
    return persistKnowledgeFailure(ownerId, ctx, upsertError);
  }

  const concepts = extracted.concepts.map((conceptName, index) => ({
    conceptName,
    conceptEmbedding: conceptEmbeddings[index] ?? null,
    position: index,
  }));

  const conceptsErr = await remoteReplaceChapterConcepts(
    ownerId,
    id,
    chapterId,
    concepts
  );
  if (conceptsErr) {
    return persistKnowledgeFailure(ownerId, ctx, conceptsErr);
  }

  return {
    status: "complete",
    mismatchWarning,
    conceptCount: extracted.concepts.length,
    error: null,
    syllabusKnowledgeId: id,
  };
}

/**
 * Build KB for every chapter in a class that has at least one Syllabus file.
 */
export async function buildSyllabusKnowledgeForClass(
  ownerId,
  classId,
  {
    catalog,
    normalizeMaterialCategory,
    libraryGet,
    remoteDownloadMaterial,
    remoteEnsureCatalogBranch,
  }
) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) {
    return { built: 0, failed: 0, results: [], error: "Class not found." };
  }

  const results = [];
  for (const unit of classItem.units || []) {
    for (const chapter of unit.chapters || []) {
      const syllabusFiles = (chapter.files || []).filter(
        (f) => normalizeMaterialCategory(f) === "Syllabus"
      );
      if (!syllabusFiles.length) continue;

      const latest = syllabusFiles[syllabusFiles.length - 1];
      const result = await buildSyllabusKnowledgeForChapter(ownerId, {
        catalog,
        classId,
        unitId: unit.id,
        chapterId: chapter.id,
        chapterName: chapter.name,
        materialId: latest.id,
        libraryGet,
        remoteDownloadMaterial,
        remoteEnsureCatalogBranch,
      });
      results.push({ chapterId: chapter.id, chapterName: chapter.name, ...result });
    }
  }

  const built = results.filter((r) => r.status === "complete").length;
  const failed = results.filter((r) => r.status === "failed").length;
  return { built, failed, results, error: null };
}
