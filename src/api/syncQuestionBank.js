// After a question-paper upload, extract questions and write to question_bank.

import { libraryGet } from "../materialBlobStore.js";
import { remoteSyncCatalogForClass } from "./materialsRemote.js";
import {
  remoteReplaceQuestionBankForMaterial,
  remoteReplaceQuestionBankForQuestionPaper,
  remoteQueryQuestionBank,
  remoteUpsertQuestionBank,
  questionBankRowsFromQuestionPaper,
} from "./questionBankRemote.js";
import {
  buildChapterIndexForClass,
  entryToQuestionShape,
  questionBankRowToEntry,
} from "./questionBankUtils.js";
import {
  assignQuestionIds,
  extractQuestionsFromDocument,
} from "./questionExtraction.js";
import {
  classifyQuestionsToChapters,
  collectSyllabusTextForClass,
} from "./questionChapterClassification.js";

async function classifyForExamPaper(
  questions,
  paper,
  catalog,
  normalizeMaterialCategory,
  { ownerId = null, remoteDownloadMaterial = null } = {}
) {
  const chapterIndex = buildChapterIndexForClass(catalog, paper.classId);
  if (!chapterIndex.length) {
    return { questions, classifiedBy: "none", chapterIndex };
  }
  const syllabusText = await collectSyllabusTextForClass(
    catalog,
    paper.classId,
    libraryGet,
    normalizeMaterialCategory,
    { ownerId, remoteDownloadMaterial }
  );
  const { questions: classified, classifiedBy } = await classifyQuestionsToChapters(
    questions,
    chapterIndex,
    {
      syllabusText,
      paperName: paper.name,
    }
  );
  return { questions: classified, classifiedBy, chapterIndex };
}

function sanitizeChapterAssignments(questions, chapterIndex) {
  if (!chapterIndex?.length) return questions;
  const validIds = new Set(chapterIndex.map((c) => c.id));
  return questions.map((q) => {
    if (q.chapterId && !validIds.has(q.chapterId)) {
      return { ...q, chapterId: null, unitId: null, chapterName: null };
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
    error = await remoteReplaceQuestionBankForQuestionPaper(ownerId, paper, {
      questions: safeQuestions,
    });
  } else {
    const rows = questionBankRowsFromQuestionPaper(ownerId, paper, {
      questions: safeQuestions,
    });
    error = await remoteUpsertQuestionBank(ownerId, rows);
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
  const { questions, extractedBy } = await extractQuestionsFromDocument(file.blob, {
    name: file.name || paper.name,
    mimeType: file.mimeType || paper.mimeType,
  });
  if (!questions.length) return { questions: [], extractedBy };
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

  const { questions, extractedBy } = await extractQuestionsFromDocument(blob, {
    name: paper.name,
    mimeType: paper.mimeType,
  });

  if (!questions.length) {
    return { count: 0, extractedBy, classifiedBy: "none", error: null, questions: [] };
  }

  let enriched = assignQuestionIds(questions, extractedBy);
  let classifiedBy = "none";
  if (catalog.length) {
    const classified = await classifyForExamPaper(
      enriched,
      paper,
      catalog,
      normalizeMaterialCategory,
      { ownerId, remoteDownloadMaterial }
    );
    enriched = classified.questions;
    classifiedBy = classified.classifiedBy;
  }

  let error = null;
  if (ownerId && remoteOk) {
    const persisted = await persistClassifiedPaperQuestions(ownerId, paper, enriched, catalog);
    error = persisted.error;
  }

  const assignedCount = enriched.filter((q) => q.chapterId).length;

  return {
    count: enriched.length,
    extractedBy,
    classifiedBy,
    assignedCount,
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

  const persisted = await persistClassifiedPaperQuestions(
    ownerId,
    paper,
    classified,
    catalog,
    { replace: true }
  );

  const assignedCount = classified.filter((q) => q.chapterId).length;

  return {
    count: classified.length,
    assignedCount,
    classifiedBy,
    extractedBy,
    error: persisted.error,
    questions: classified,
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
        lastError = `"${paper.name}" only yielded ${sync.count} question${sync.count === 1 ? "" : "s"}. Add VITE_OPENAI_API_KEY to .env.local and click Re-extract for better results.`;
      }
    } else if (!sync.error) {
      lastError = `No questions could be read from "${paper.name}". Set VITE_OPENAI_API_KEY for AI extraction.`;
    }
  }

  return { processed, totalQuestions, assignedCount, error: lastError };
}

/** Force re-extract one paper (deletes existing bank rows first). */
export async function reprocessQuestionPaper(
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
