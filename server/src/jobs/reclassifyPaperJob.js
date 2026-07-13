import { log } from "../lib/logger.js";
import { createUsageAccumulator } from "../lib/openaiUsageAccumulator.js";
import { queryQuestionBankForPaper } from "../data/questionBankRemote.js";
import { bankRowToQuestion, buildChapterIndexForClass } from "../data/questionBankUtils.js";
import { queryManualOverridesByQuestionNo } from "../data/questionClassificationRemote.js";
import { fetchCatalogWithMaterialsForClass } from "../data/catalogRemote.js";
import {
  classifyPaperQuestions,
  mergeManualOverridesByQuestionNo,
} from "./classifyPaperQuestions.js";
import { persistPaperQuestions } from "./persistPaperQuestions.js";

/**
 * Reclassify existing question_bank rows (no re-extract).
 */
export async function reclassifyPaperJob({
  supabase,
  ownerId,
  paperId,
  requestId,
  onlyUnassigned = false,
}) {
  const accumulator = createUsageAccumulator({ ownerId, jobId: null, paperId, requestId });
  const usageContext = { supabase, ownerId, jobId: null, paperId, requestId };

  const { data: paper, error: paperError } = await supabase
    .from("question_papers")
    .select("id, name, class_id, year, paper_source")
    .eq("owner_id", ownerId)
    .eq("id", paperId)
    .maybeSingle();

  if (paperError) throw new Error(paperError.message);
  if (!paper) throw new Error(`Question paper "${paperId}" not found.`);

  const rows = await queryQuestionBankForPaper(supabase, ownerId, paperId);
  if (!rows.length) {
    throw new Error(
      `No questions in the bank for "${paper.name}". Run Update question bank first.`
    );
  }

  let questions = rows.map(bankRowToQuestion);

  if (onlyUnassigned) {
    const unassigned = questions.filter((q) => !q.chapterId);
    if (!unassigned.length) {
      return {
        status: "completed",
        questionCount: 0,
        assignedCount: 0,
        classifiedBy: "none",
        usageSummary: accumulator.toSummary({ classifiedBy: "none" }),
      };
    }
    questions = unassigned;
  }

  const classified = await classifyPaperQuestions({
    supabase,
    ownerId,
    paper,
    questions,
    requestId,
    jobId: null,
    paperId,
    usageContext,
    accumulator,
  });

  if (classified.error) {
    throw new Error(classified.error);
  }

  const overridesByQuestionNo = await queryManualOverridesByQuestionNo(
    supabase,
    ownerId,
    paperId
  );

  const classId = paper.class_id;
  const catalog = classId
    ? await fetchCatalogWithMaterialsForClass(supabase, ownerId, classId)
    : [];
  const chapterIndex = buildChapterIndexForClass(catalog, classId);

  const mergedAll = rows.map(bankRowToQuestion);
  const classifiedById = new Map(classified.questions.map((q) => [q.id, q]));
  let enriched = mergedAll.map((q) => {
    const updated = classifiedById.get(q.id);
    return updated && (onlyUnassigned ? !q.chapterId : true) ? updated : q;
  });

  enriched = mergeManualOverridesByQuestionNo(
    enriched,
    overridesByQuestionNo,
    chapterIndex
  );

  const classifiedBy = classified.classifiedBy;
  const persisted = await persistPaperQuestions({
    supabase,
    ownerId,
    paper,
    questions: enriched,
    classifiedBy,
    requestId,
    jobId: null,
    paperId,
  });

  if (persisted.error) {
    throw new Error(persisted.error);
  }

  const usageSummary = accumulator.toSummary({ classifiedBy });

  log("info", "reclassify.completed", {
    requestId,
    paperId,
    ownerId,
    questionCount: enriched.length,
    assignedCount: persisted.assignedCount ?? 0,
    classifiedBy,
    onlyUnassigned,
    usage: accumulator.totals(),
  });

  return {
    status: "completed",
    questionCount: enriched.length,
    assignedCount: persisted.assignedCount ?? 0,
    classifiedBy,
    usageSummary,
  };
}
