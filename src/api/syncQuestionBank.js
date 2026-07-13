// After a question-paper upload, extract questions and write to question_bank.

import { libraryGet } from "../materialBlobStore.js";
import { remoteSyncCatalogForClass } from "./materialsRemote.js";
import {
  remoteReplaceQuestionBankForMaterial,
  remoteReplaceQuestionBankForQuestionPaper,
  remoteDeleteQuestionBankByQuestionPaper,
  remoteQueryQuestionBank,
  remoteUpsertQuestionBank,
  questionBankRowsFromQuestionPaper,
} from "./questionBankRemote.js";
import { remoteEnsureQuestionPaperRecord } from "./questionPapersRemote.js";
import {
  buildChapterIndexForClass,
  entryToQuestionShape,
  questionBankRowToEntry,
  stampPaperExpectedTotal,
} from "./questionBankUtils.js";
import {
  assignQuestionIds,
  extractQuestionsFromDocument,
  extractionQualityStats,
  formatExtractionQualityMessage,
  formatExtractionValidationMessage,
} from "./questionExtraction.js";
import {
  buildExtractionQualityReportFromQuestions,
  formatExtractionQualitySummary,
} from "./extractionQualityReport.js";
import {
  classifyQuestionsToChapters,
  collectSyllabusTextForClass,
} from "./questionChapterClassification.js";
import { remoteQueryKnowledgeEmbeddingsForClass } from "./syllabusKnowledgeRemote.js";
import { classifyQuestionsWithVectorKb } from "./questionVectorClassification.js";
import { remoteUpsertQuestionClassifications, remoteQueryManualOverrideQuestionIds } from "./questionClassificationRemote.js";
import {
  CLASSIFICATION_SOURCE,
  reviewStatusFromConfidence,
} from "../constants/classificationReview.js";
import { EXTRACTION_FEATURE_FLAGS } from "../constants/extractionConfig.js";
import { isExtractionApiConfigured } from "./extractionApiConfig.js";
import {
  processQuestionPaperRemote,
  reclassifyPaperRemote,
} from "./extractionApiRemote.js";

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

async function classifyForExamPaper(
  questions,
  paper,
  catalog,
  normalizeMaterialCategory,
  { ownerId = null, remoteDownloadMaterial = null } = {}
) {
  const chapterIndex = buildChapterIndexForClass(catalog, paper.classId);
  if (!chapterIndex.length) {
    console.warn(
      "[chapterClassification] No chapters in catalog for class",
      paper.classId
    );
    return { questions, classifiedBy: "none", chapterIndex };
  }

  if (ownerId && EXTRACTION_FEATURE_FLAGS.useVectorClassification !== false) {
    const kbProfiles = await remoteQueryKnowledgeEmbeddingsForClass(
      ownerId,
      paper.classId
    );
    if (kbProfiles.length) {
      const { questions: classified, classifiedBy, error } =
        await classifyQuestionsWithVectorKb(questions, kbProfiles, chapterIndex);
      if (error) {
        console.warn("[chapterClassification] Vector classify failed:", error);
      } else if (classifiedBy === "vector") {
        const assigned = classified.filter((q) => q.chapterId).length;
        console.info(
          `[chapterClassification] ${paper.name}: ${assigned}/${questions.length} assigned (vector, ${kbProfiles.length} KB chapters)`
        );
        return { questions: classified, classifiedBy, chapterIndex };
      }
    }
  }

  const syllabusText = await collectSyllabusTextForClass(
    catalog,
    paper.classId,
    libraryGet,
    normalizeMaterialCategory,
    { ownerId, remoteDownloadMaterial }
  );
  if (!syllabusText.trim()) {
    console.warn(
      "[chapterClassification] No syllabus text loaded for class",
      paper.classId,
      "— classifying from chapter names only."
    );
  }
  const { questions: classified, classifiedBy } = await classifyQuestionsToChapters(
    questions,
    chapterIndex,
    {
      syllabusText,
      paperName: paper.name,
    }
  );
  const withMeta = attachLegacyClassification(classified, classifiedBy);
  const assigned = withMeta.filter((q) => q.chapterId).length;
  console.info(
    `[chapterClassification] ${paper.name}: ${assigned}/${questions.length} assigned (${classifiedBy}, ${chapterIndex.length} chapters, syllabus ${syllabusText.length} chars)`
  );
  return { questions: withMeta, classifiedBy, chapterIndex };
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
      };
    }
    return q;
  });
}

/** Sync catalog + upsert classified questions into question_bank. */
async function persistClassifiedPaperQuestions(
  ownerId,
  paper,
  questions,
  catalog,
  { replace = true } = {}
) {
  if (!ownerId) {
    return { error: "Sign in to save classified questions to the question bank." };
  }
  if (!questions.length) {
    return { error: null, rowCount: 0 };
  }

  if (Array.isArray(catalog) && catalog.length && paper.classId) {
    const catalogErr = await remoteSyncCatalogForClass(ownerId, catalog, paper.classId);
    if (catalogErr) {
      return { error: `Could not sync chapters to database: ${catalogErr}` };
    }
  }

  const chapterIndex = buildChapterIndexForClass(catalog, paper.classId);
  const safeQuestions = sanitizeChapterAssignments(questions, chapterIndex);

  let error;
  if (replace) {
    error = await remoteReplaceQuestionBankForQuestionPaper(
      ownerId,
      paper,
      { questions: safeQuestions },
      {
        catalog,
        ensureQuestionPaperRecord: remoteEnsureQuestionPaperRecord,
      }
    );
  } else {
    const ensureErr = await remoteEnsureQuestionPaperRecord(ownerId, paper, catalog);
    if (ensureErr) {
      return { error: ensureErr, rowCount: 0 };
    }
    const rows = questionBankRowsFromQuestionPaper(ownerId, paper, {
      questions: safeQuestions,
    });
    error = await remoteUpsertQuestionBank(ownerId, rows);
  }

  if (!error) {
    const clsRows = safeQuestions
      .filter((q) => q.classification)
      .map((q) =>
        classificationFromQuestion(q, q.classification.classificationSource)
      )
      .filter(Boolean);
    if (clsRows.length) {
      const clsErr = await remoteUpsertQuestionClassifications(ownerId, clsRows);
      if (clsErr) {
        return { error: clsErr, rowCount: safeQuestions.length };
      }
    }
  }

  return { error, rowCount: safeQuestions.length };
}

async function getQuestionPaperBlob(
  paper,
  { libraryGet: getBlob, ownerId, remoteDownloadQuestionPaper, librarySaveBlob } = {}
) {
  if (getBlob) {
    const rec = await getBlob(paper.id);
    if (rec?.blob) {
      return {
        blob: rec.blob,
        mimeType: paper.mimeType || rec.mimeType,
        name: paper.name || rec.name,
      };
    }
  }
  if (ownerId && remoteDownloadQuestionPaper) {
    const remote = await remoteDownloadQuestionPaper(ownerId, paper.id);
    if (remote?.blob) {
      if (librarySaveBlob) {
        await librarySaveBlob(paper.id, remote.blob, {
          name: remote.name || paper.name,
          mimeType: remote.mimeType || paper.mimeType,
        });
      }
      return remote;
    }
  }
  return null;
}

async function extractQuestionsFromPaperBlob(paper, blobOptions = {}) {
  const file = await getQuestionPaperBlob(paper, blobOptions);
  if (!file?.blob) return { questions: [], extractedBy: "none" };
  const { questions, extractedBy, failureReason } = await extractQuestionsFromDocument(file.blob, {
    name: file.name || paper.name,
    mimeType: file.mimeType || paper.mimeType,
  });
  if (!questions.length) return { questions: [], extractedBy, failureReason };
  return { questions: assignQuestionIds(questions, extractedBy), extractedBy };
}

export async function syncQuestionBankFromMaterial(
  ownerId,
  record,
  blob,
  { remoteOk = true } = {}
) {
  if (!blob || record.materialType !== "Question papers") {
    return { count: 0, extractedBy: "none", classifiedBy: "none", error: null, questions: [] };
  }

  const { questions, extractedBy } = await extractQuestionsFromDocument(blob, {
    name: record.name,
    mimeType: record.mimeType,
  });

  if (!questions.length) {
    return { count: 0, extractedBy, classifiedBy: "none", error: null, questions: [] };
  }

  const enriched = assignQuestionIds(questions, extractedBy);
  let error = null;
  if (ownerId && remoteOk) {
    error = await remoteReplaceQuestionBankForMaterial(ownerId, record, {
      chapterName: record.chapterName,
      questions: enriched,
    });
  }

  return {
    count: enriched.length,
    extractedBy,
    classifiedBy: "none",
    error,
    questions: enriched,
  };
}

export async function syncQuestionBankFromQuestionPaper(
  ownerId,
  paper,
  blob,
  {
    remoteOk = true,
    catalog = [],
    normalizeMaterialCategory = () => "Syllabus",
    remoteDownloadMaterial = null,
  } = {}
) {
  if (!blob) {
    return { count: 0, extractedBy: "none", classifiedBy: "none", error: null, questions: [] };
  }

  const { questions, extractedBy, failureReason, validation } = await extractQuestionsFromDocument(blob, {
    name: paper.name,
    mimeType: paper.mimeType,
  });

  if (!questions.length) {
    return {
      count: 0,
      extractedBy,
      classifiedBy: "none",
      error: failureReason || null,
      questions: [],
    };
  }

  let enriched = stampPaperExpectedTotal(
    assignQuestionIds(questions, extractedBy),
    validation?.expectedCount
  );
  let classifiedBy = "none";
  if (EXTRACTION_FEATURE_FLAGS.classifyToChapters && catalog.length) {
    const classified = await classifyForExamPaper(
      enriched,
      paper,
      catalog,
      normalizeMaterialCategory,
      { ownerId, remoteDownloadMaterial }
    );
    enriched = classified.questions;
    classifiedBy = classified.classifiedBy;
  } else {
    enriched = enriched.map((q) => ({
      ...q,
      chapterId: null,
      unitId: null,
      chapterName: null,
      solution: EXTRACTION_FEATURE_FLAGS.extractSolutions ? q.solution : null,
    }));
  }

  let error = null;
  if (ownerId && remoteOk) {
    const persisted = await persistClassifiedPaperQuestions(ownerId, paper, enriched, catalog);
    error = persisted.error;
  }

  const assignedCount = enriched.filter((q) => q.chapterId).length;
  const quality = extractionQualityStats(enriched);
  const qualityReport = buildExtractionQualityReportFromQuestions(enriched, validation);
  const validationNote =
    formatExtractionQualitySummary(qualityReport) ||
    formatExtractionValidationMessage(validation);

  return {
    count: enriched.length,
    extractedBy,
    classifiedBy,
    assignedCount,
    quality,
    qualityReport,
    validationNote,
    error,
    questions: enriched,
  };
}

const defaultBlobOptions = (opts = {}) => ({
  libraryGet: opts.libraryGet ?? null,
  librarySaveBlob: opts.librarySaveBlob ?? null,
  ownerId: opts.ownerId ?? null,
  remoteDownloadQuestionPaper: opts.remoteDownloadQuestionPaper ?? null,
});

/** Extract (if needed), classify, and upsert one exam paper into question_bank. */
export async function reclassifyQuestionPaperBank(
  ownerId,
  paper,
  catalog,
  normalizeMaterialCategory,
  {
    onlyUnassigned = false,
    remoteDownloadMaterial = null,
    libraryGet: getBlob = null,
    librarySaveBlob = null,
    remoteDownloadQuestionPaper = null,
  } = {}
) {
  if (!ownerId) {
    return { count: 0, assignedCount: 0, classifiedBy: "none", error: "Sign in to classify questions." };
  }

  if (isExtractionApiConfigured()) {
    const remote = await reclassifyPaperRemote(paper.id, { onlyUnassigned });
    return remote;
  }

  const blobOptions = defaultBlobOptions({
    libraryGet: getBlob,
    librarySaveBlob,
    ownerId,
    remoteDownloadQuestionPaper,
  });

  let rows = await remoteQueryQuestionBank(ownerId, {
    questionPaperId: paper.id,
  });

  let questions;
  let extractedBy = "existing";

  if (!rows.length) {
    const extracted = await extractQuestionsFromPaperBlob(paper, blobOptions);
    if (!extracted.questions.length) {
      return {
        count: 0,
        assignedCount: 0,
        classifiedBy: "none",
        error: `Could not extract questions from "${paper.name}". Check that the PDF has readable text and VITE_OPENAI_API_KEY is set in .env.local.`,
      };
    }
    questions = extracted.questions;
    extractedBy = extracted.extractedBy;
  } else {
    questions = rows.map((row) => entryToQuestionShape(questionBankRowToEntry(row)));
    if (onlyUnassigned && !rows.some((r) => !r.chapter_id)) {
      return { count: 0, assignedCount: 0, classifiedBy: "none", error: null };
    }
  }

  const { questions: classified, classifiedBy } = await classifyForExamPaper(
    questions,
    paper,
    catalog,
    normalizeMaterialCategory,
    { ownerId, remoteDownloadMaterial }
  );

  const overrideIds =
    rows.length > 0
      ? await remoteQueryManualOverrideQuestionIds(
          ownerId,
          questions.map((q) => q.id)
        )
      : new Set();
  const originalById = new Map(questions.map((q) => [q.id, q]));
  const merged = classified.map((q) =>
    overrideIds.has(q.id) ? originalById.get(q.id) ?? q : q
  );

  const persisted = await persistClassifiedPaperQuestions(
    ownerId,
    paper,
    merged,
    catalog,
    { replace: !rows.length }
  );

  const assignedCount = merged.filter((q) => q.chapterId).length;

  return {
    count: merged.length,
    assignedCount,
    classifiedBy,
    extractedBy,
    error: persisted.error,
    questions: merged,
  };
}

/** Papers with fewer than this many bank rows are treated as incomplete and re-extracted. */
const MIN_QUESTIONS_PER_PAPER = 10;

function questionCountByPaperId(questionBankEntries) {
  const counts = {};
  for (const entry of questionBankEntries || []) {
    const paperId = entry.questionPaperId ?? entry.question_paper_id;
    if (!paperId) continue;
    counts[paperId] = (counts[paperId] || 0) + 1;
  }
  return counts;
}

/**
 * Download, extract, classify, and save papers that are missing or under-populated in question_bank.
 * @returns {{ processed: number, totalQuestions: number, assignedCount: number, error: string|null }}
 */
export async function reprocessQuestionPapersWithoutBank(
  ownerId,
  papers,
  catalog,
  questionBankEntries,
  {
    libraryGet: getBlob = null,
    librarySaveBlob = null,
    remoteDownloadQuestionPaper = null,
    normalizeMaterialCategory = () => "Syllabus",
    remoteDownloadMaterial = null,
    minQuestionsPerPaper = MIN_QUESTIONS_PER_PAPER,
    forceAll = false,
  } = {}
) {
  if (!ownerId || !papers?.length) {
    return { processed: 0, totalQuestions: 0, assignedCount: 0, error: null };
  }

  if (!EXTRACTION_FEATURE_FLAGS.autoExtractOnLoad) {
    return { processed: 0, totalQuestions: 0, assignedCount: 0, error: null };
  }

  const counts = questionCountByPaperId(questionBankEntries);

  const pending = forceAll
    ? papers
    : papers.filter((p) => (counts[p.id] || 0) < minQuestionsPerPaper);
  if (!pending.length) {
    return { processed: 0, totalQuestions: 0, assignedCount: 0, error: null };
  }

  let processed = 0;
  let totalQuestions = 0;
  let assignedCount = 0;
  let lastError = null;

  for (const paper of pending) {
    const file = await getQuestionPaperBlob(paper, defaultBlobOptions({
      libraryGet: getBlob,
      librarySaveBlob,
      ownerId,
      remoteDownloadQuestionPaper,
    }));
    if (!file?.blob) {
      lastError = `Could not download "${paper.name}" from storage.`;
      continue;
    }

    const deleteError = await remoteDeleteQuestionBankByQuestionPaper(ownerId, paper.id);
    if (deleteError) {
      lastError = `${paper.name}: could not clear existing questions — ${deleteError}`;
      continue;
    }

    const sync = await syncQuestionBankFromQuestionPaper(ownerId, paper, file.blob, {
      catalog,
      normalizeMaterialCategory,
      remoteDownloadMaterial,
    });

    if (sync.error) {
      lastError = `${paper.name}: ${sync.error}`;
      continue;
    }
    if (sync.count > 0) {
      processed += 1;
      totalQuestions += sync.count;
      assignedCount += sync.assignedCount ?? 0;
      if (sync.count < minQuestionsPerPaper) {
        lastError = `"${paper.name}" only yielded ${sync.count} question${sync.count === 1 ? "" : "s"}. Add VITE_OPENAI_API_KEY to .env.local and click Update question bank for better results.`;
      }
    } else if (!sync.error) {
      lastError = `No questions could be read from "${paper.name}". Set VITE_OPENAI_API_KEY for AI extraction.`;
    }
  }

  return { processed, totalQuestions, assignedCount, error: lastError };
}

/** Force update question bank for one paper (deletes existing bank rows first). */
async function updateQuestionBankForPaperImpl(
  ownerId,
  paper,
  catalog,
  {
    libraryGet: getBlob = null,
    librarySaveBlob = null,
    remoteDownloadQuestionPaper = null,
    normalizeMaterialCategory = () => "Syllabus",
    remoteDownloadMaterial = null,
  } = {}
) {
  if (isExtractionApiConfigured()) {
    if (Array.isArray(catalog) && catalog.length && paper.classId) {
      const catalogErr = await remoteSyncCatalogForClass(ownerId, catalog, paper.classId);
      if (catalogErr) {
        return {
          count: 0,
          assignedCount: 0,
          error: `Could not sync chapters to database: ${catalogErr}`,
        };
      }
    }

    const ensureErr = await remoteEnsureQuestionPaperRecord(ownerId, paper, catalog);
    if (ensureErr) {
      return {
        count: 0,
        assignedCount: 0,
        error: ensureErr,
      };
    }

    return processQuestionPaperRemote(paper.id);
  }

  const deleteError = await remoteDeleteQuestionBankByQuestionPaper(ownerId, paper.id);
  if (deleteError) {
    return {
      count: 0,
      assignedCount: 0,
      error: `Could not clear existing questions for "${paper.name}": ${deleteError}`,
    };
  }

  const file = await getQuestionPaperBlob(paper, defaultBlobOptions({
    libraryGet: getBlob,
    librarySaveBlob,
    ownerId,
    remoteDownloadQuestionPaper,
  }));
  if (!file?.blob) {
    return {
      count: 0,
      assignedCount: 0,
      error: `Could not download "${paper.name}" from storage.`,
    };
  }
  return syncQuestionBankFromQuestionPaper(ownerId, paper, file.blob, {
    catalog,
    normalizeMaterialCategory,
    remoteDownloadMaterial,
  });
}

export async function updateQuestionBankForPaper(ownerId, paper, catalog, options = {}) {
  return updateQuestionBankForPaperImpl(ownerId, paper, catalog, options);
}

/** @deprecated Use updateQuestionBankForPaper */
export async function reprocessQuestionPaper(ownerId, paper, catalog, options = {}) {
  return updateQuestionBankForPaperImpl(ownerId, paper, catalog, options);
}

/** Reclassify all exam papers for one class (e.g. after syllabus upload). */
export async function reclassifyExamPapersForClass(
  ownerId,
  papers,
  catalog,
  classId,
  normalizeMaterialCategory,
  {
    remoteDownloadMaterial = null,
    libraryGet: getBlob = null,
    librarySaveBlob = null,
    remoteDownloadQuestionPaper = null,
  } = {}
) {
  const classPapers = (papers || []).filter((p) => p.classId === classId);
  if (!classPapers.length) {
    return {
      count: 0,
      assignedCount: 0,
      persistedCount: 0,
      classifiedBy: "none",
      error: null,
    };
  }

  let totalQuestions = 0;
  let totalAssigned = 0;
  let totalPersisted = 0;
  let lastClassifiedBy = "none";
  let lastError = null;

  for (const paper of classPapers) {
    const result = await reclassifyQuestionPaperBank(
      ownerId,
      paper,
      catalog,
      normalizeMaterialCategory,
      {
        remoteDownloadMaterial,
        libraryGet: getBlob,
        librarySaveBlob,
        remoteDownloadQuestionPaper,
      }
    );
    totalQuestions += result.count;
    totalAssigned += result.assignedCount;
    totalPersisted += result.count;
    if (result.classifiedBy !== "none") lastClassifiedBy = result.classifiedBy;
    if (result.error) lastError = result.error;
  }

  return {
    count: totalQuestions,
    assignedCount: totalAssigned,
    persistedCount: totalPersisted,
    classifiedBy: lastClassifiedBy,
    error: lastError,
  };
}

/** Classify exam-paper questions and save chapter assignments to question_bank. */
export async function reclassifyUnassignedExamQuestions(
  ownerId,
  papers,
  catalog,
  normalizeMaterialCategory,
  {
    remoteDownloadMaterial = null,
    libraryGet: getBlob = null,
    librarySaveBlob = null,
    remoteDownloadQuestionPaper = null,
  } = {}
) {
  let totalAssigned = 0;
  let totalQuestions = 0;
  let totalPersisted = 0;
  let lastClassifiedBy = "none";
  let lastError = null;

  for (const paper of papers) {
    const rows = await remoteQueryQuestionBank(ownerId, {
      questionPaperId: paper.id,
    });
    const hasUnassigned = rows.some((r) => !r.chapter_id);
    const needsExtract = !rows.length;

    if (!hasUnassigned && !needsExtract) continue;

    const result = await reclassifyQuestionPaperBank(
      ownerId,
      paper,
      catalog,
      normalizeMaterialCategory,
      {
        onlyUnassigned: hasUnassigned && rows.length > 0,
        remoteDownloadMaterial,
        libraryGet: getBlob,
        librarySaveBlob,
        remoteDownloadQuestionPaper,
      }
    );
    totalQuestions += result.count;
    totalAssigned += result.assignedCount;
    totalPersisted += result.count;
    if (result.classifiedBy !== "none") lastClassifiedBy = result.classifiedBy;
    if (result.error) lastError = result.error;
  }

  return {
    count: totalQuestions,
    assignedCount: totalAssigned,
    persistedCount: totalPersisted,
    classifiedBy: lastClassifiedBy,
    error: lastError,
  };
}
