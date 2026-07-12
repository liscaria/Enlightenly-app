import { EXTRACTION_FEATURE_FLAGS } from "../config/extractionConfig.js";
import { log } from "../lib/logger.js";
import { normalizeMaterialCategory } from "../lib/materialCategory.js";
import { fetchCatalogWithMaterialsForClass } from "../data/catalogRemote.js";
import { buildChapterIndexForClass } from "../data/questionBankUtils.js";
import { queryKnowledgeEmbeddingsForClass } from "../data/syllabusKnowledgeRemote.js";
import {
  CLASSIFICATION_SOURCE,
  confidenceToDisplayPercent,
  reviewStatusFromConfidence,
} from "../constants/classificationReview.js";
import {
  classifyQuestionsToChapters,
  collectSyllabusTextForClass,
} from "../classification/questionChapterClassification.js";
import { classifyQuestionsWithVectorKb } from "../classification/questionVectorClassification.js";

function classificationFromQuestion(q, source) {
  if (!q?.id || !q?.chapterId) return null;
  const confidence =
    q.classification?.confidence ??
    (q.chapterConfidence != null ? Number(q.chapterConfidence) / 100 : 0.5);
  return {
    questionId: q.id,
    chapterId: q.chapterId,
    confidence: Math.max(0, Math.min(1, confidence)),
    alternatives: q.classification?.alternatives ?? [],
    reviewStatus:
      q.classification?.reviewStatus ?? reviewStatusFromConfidence(confidence),
    classificationSource: q.classification?.classificationSource ?? source,
  };
}

function attachLegacyClassification(questions, classifiedBy) {
  const source =
    classifiedBy === "heuristic"
      ? CLASSIFICATION_SOURCE.HEURISTIC_FALLBACK
      : CLASSIFICATION_SOURCE.AI_RERANK;
  return questions.map((q) => {
    if (!q.chapterId || q.classification) return q;
    const confidence = q.chapterConfidence != null ? Number(q.chapterConfidence) / 100 : 0.5;
    return {
      ...q,
      classification: {
        chapterId: q.chapterId,
        confidence,
        alternatives: [],
        reviewStatus: reviewStatusFromConfidence(confidence),
        classificationSource: source,
      },
    };
  });
}

function sanitizeChapterAssignments(questions, chapterIndex) {
  if (!chapterIndex?.length) return questions;
  const validIds = new Set(chapterIndex.map((c) => c.id));
  return questions.map((q) => {
    if (q.chapterId && !validIds.has(q.chapterId)) {
      return {
        ...q,
        chapterId: null,
        unitId: null,
        chapterName: null,
        chapterConfidence: null,
        classification: null,
      };
    }
    return q;
  });
}

/** Apply MANUAL_OVERRIDE by question_no (survives re-extract with new UUIDs). */
export function mergeManualOverridesByQuestionNo(questions, overridesByQuestionNo, chapterIndex) {
  if (!overridesByQuestionNo?.size || !chapterIndex?.length) return questions;
  const byId = new Map(chapterIndex.map((c) => [c.id, c]));

  return questions.map((q) => {
    const override = overridesByQuestionNo.get(Number(q.questionNo));
    if (!override) return q;

    const ch = byId.get(override.chapterId);
    if (!ch) return q;

    return {
      ...q,
      chapterId: ch.id,
      unitId: ch.unitId,
      chapterName: ch.name,
      chapterConfidence: confidenceToDisplayPercent(override.confidence),
      classification: {
        chapterId: ch.id,
        confidence: override.confidence,
        alternatives: override.alternatives ?? [],
        reviewStatus: override.reviewStatus ?? reviewStatusFromConfidence(override.confidence),
        classificationSource: CLASSIFICATION_SOURCE.MANUAL_OVERRIDE,
      },
    };
  });
}

export { classificationFromQuestion, sanitizeChapterAssignments };

/**
 * Classify extracted questions to syllabus chapters (Phase 2b).
 */
export async function classifyPaperQuestions({
  supabase,
  ownerId,
  paper,
  questions,
  requestId,
  jobId,
  paperId,
}) {
  if (!EXTRACTION_FEATURE_FLAGS.classifyToChapters) {
    return {
      questions,
      classifiedBy: "none",
      assignedCount: 0,
      error: null,
    };
  }

  const classId = paper.classId ?? paper.class_id;
  if (!classId) {
    return { questions, classifiedBy: "none", assignedCount: 0, error: null };
  }

  const catalog = await fetchCatalogWithMaterialsForClass(supabase, ownerId, classId);
  const chapterIndex = buildChapterIndexForClass(catalog, classId);
  if (!chapterIndex.length) {
    log("warn", "classify.noChapters", { requestId, jobId, paperId, classId });
    return { questions, classifiedBy: "none", assignedCount: 0, error: null };
  }

  let classified = questions;
  let classifiedBy = "none";

  if (EXTRACTION_FEATURE_FLAGS.useVectorClassification !== false) {
    const kbProfiles = await queryKnowledgeEmbeddingsForClass(supabase, ownerId, classId);
    if (kbProfiles.length) {
      const vectorResult = await classifyQuestionsWithVectorKb(
        questions,
        kbProfiles,
        chapterIndex
      );
      if (vectorResult.error) {
        log("warn", "classify.vectorFailed", {
          requestId,
          jobId,
          paperId,
          error: vectorResult.error,
        });
      } else if (vectorResult.classifiedBy === "vector") {
        classified = vectorResult.questions;
        classifiedBy = "vector";
        const assigned = classified.filter((q) => q.chapterId).length;
        log("info", "classify.vector", {
          requestId,
          jobId,
          paperId,
          assigned,
          total: questions.length,
          kbChapters: kbProfiles.length,
        });
      }
    }
  }

  if (classifiedBy === "none") {
    const syllabusText = await collectSyllabusTextForClass(
      catalog,
      classId,
      normalizeMaterialCategory,
      { supabase, ownerId }
    );
    log("info", "classify.syllabusText", {
      requestId,
      jobId,
      paperId,
      chars: syllabusText.length,
    });

    const llmResult = await classifyQuestionsToChapters(questions, chapterIndex, {
      syllabusText,
      paperName: paper.name,
    });
    classified = attachLegacyClassification(llmResult.questions, llmResult.classifiedBy);
    classifiedBy = llmResult.classifiedBy;

    const assigned = classified.filter((q) => q.chapterId).length;
    log("info", "classify.llm", {
      requestId,
      jobId,
      paperId,
      assigned,
      total: questions.length,
      classifiedBy,
    });
  }

  classified = sanitizeChapterAssignments(classified, chapterIndex);
  const assignedCount = classified.filter((q) => q.chapterId).length;

  return { questions: classified, classifiedBy, assignedCount, error: null };
}
