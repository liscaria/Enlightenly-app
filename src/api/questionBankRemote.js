// Question bank: one Postgres row per question, from chapter materials or exam papers.

import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import {
  sourceFromMaterialExamSource,
  sourceFromQuestionPaper,
} from "../constants/questionSources.js";

function warn(scope, error) {
  if (!error) return;
  // eslint-disable-next-line no-console
  console.warn(`[questionBankRemote] ${scope}:`, error.message || error);
}

function notReady(ownerId) {
  return !isSupabaseConfigured || !supabase || !ownerId;
}

function formatError(error) {
  if (!error) return null;
  return error.message || String(error);
}

/**
 * Build question_bank rows from a chapter material (materials bucket, type Question papers).
 */
export function questionBankRowsFromMaterial(
  ownerId,
  material,
  { chapterName, questions = [] }
) {
  if (!questions.length) return [];
  return questions.map((q, index) => ({
    owner_id: ownerId,
    id: q.id,
    origin_type: "material",
    material_id: material.id,
    question_paper_id: null,
    class_id: material.classId ?? material.class_id,
    unit_id: material.unitId ?? material.unit_id,
    chapter_id: material.chapterId ?? material.chapter_id,
    chapter_name: chapterName ?? material.chapterName ?? null,
    question_no: q.questionNo ?? q.question_no ?? index + 1,
    question_text: q.questionText ?? q.question_text ?? "",
    marks: q.marks ?? null,
    solution: q.solution ?? null,
    source: sourceFromMaterialExamSource(
      material.examSource ?? material.exam_source
    ),
    year: null,
    topic: q.topic ?? null,
    extracted_by: q.extractedBy ?? q.extracted_by ?? "manual",
    metadata: q.metadata ?? {},
  }));
}

/**
 * Build question_bank rows from a Question Bank exam paper (question-papers bucket).
 */
export function questionBankRowsFromQuestionPaper(
  ownerId,
  paper,
  { questions = [] }
) {
  if (!questions.length) return [];
  return questions.map((q, index) => ({
    owner_id: ownerId,
    id: q.id,
    origin_type: "question_paper",
    material_id: null,
    question_paper_id: paper.id,
    class_id: paper.classId ?? paper.class_id,
    unit_id: q.unitId ?? q.unit_id ?? null,
    chapter_id: q.chapterId ?? q.chapter_id ?? null,
    chapter_name: q.chapterName ?? q.chapter_name ?? null,
    question_no: q.questionNo ?? q.question_no ?? index + 1,
    question_text: q.questionText ?? q.question_text ?? "",
    marks: q.marks ?? null,
    solution: q.solution ?? null,
    source: sourceFromQuestionPaper(paper.paperSource ?? paper.paper_source),
    year: paper.year ?? null,
    topic: q.topic ?? null,
    extracted_by: q.extractedBy ?? q.extracted_by ?? "manual",
    metadata: q.metadata ?? {},
  }));
}

const UPSERT_BATCH_SIZE = 40;

export async function remoteUpsertQuestionBank(ownerId, records) {
  if (notReady(ownerId) || !records?.length) return null;
  const rows = records.map((r) => ({
    owner_id: ownerId,
    ...(r.id ? { id: r.id } : {}),
    origin_type: r.origin_type,
    material_id: r.material_id ?? null,
    question_paper_id: r.question_paper_id ?? null,
    class_id: r.class_id,
    unit_id: r.unit_id ?? null,
    chapter_id: r.chapter_id ?? null,
    chapter_name: r.chapter_name ?? null,
    question_no: r.question_no ?? null,
    question_text: r.question_text,
    marks: r.marks ?? null,
    solution: r.solution ?? null,
    source: r.source,
    year: r.year ?? null,
    topic: r.topic ?? null,
    extracted_by: r.extracted_by || "manual",
    metadata: r.metadata || {},
  }));

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const { error } = await supabase
      .from("question_bank")
      .upsert(batch, { onConflict: "id" });
    if (error) {
      warn("upsertQuestionBank", error);
      return formatError(error);
    }
  }
  return null;
}

export async function remoteReplaceQuestionBankForMaterial(
  ownerId,
  material,
  context
) {
  if (notReady(ownerId)) return null;
  const deleteError = await remoteDeleteQuestionBankByMaterial(ownerId, material.id);
  if (deleteError) return deleteError;
  const rows = questionBankRowsFromMaterial(ownerId, material, context);
  if (!rows.length) return null;
  return remoteUpsertQuestionBank(ownerId, rows);
}

export async function remoteReplaceQuestionBankForQuestionPaper(
  ownerId,
  paper,
  context
) {
  if (notReady(ownerId)) return null;
  const deleteError = await remoteDeleteQuestionBankByQuestionPaper(ownerId, paper.id);
  if (deleteError) return deleteError;
  const rows = questionBankRowsFromQuestionPaper(ownerId, paper, context);
  if (!rows.length) return null;
  return remoteUpsertQuestionBank(ownerId, rows);
}

export async function remoteDeleteQuestionBankByMaterial(ownerId, materialId) {
  if (notReady(ownerId)) return "Not signed in.";
  const { error } = await supabase
    .from("question_bank")
    .delete()
    .eq("owner_id", ownerId)
    .eq("origin_type", "material")
    .eq("material_id", materialId);
  if (error) {
    warn("deleteByMaterial", error);
    return formatError(error);
  }
  return null;
}

export async function remoteDeleteQuestionBankByQuestionPaper(
  ownerId,
  questionPaperId
) {
  if (notReady(ownerId)) return "Not signed in.";
  const { error } = await supabase
    .from("question_bank")
    .delete()
    .eq("owner_id", ownerId)
    .eq("origin_type", "question_paper")
    .eq("question_paper_id", questionPaperId);
  if (error) {
    warn("deleteByQuestionPaper", error);
    return formatError(error);
  }
  return null;
}

export async function remoteQueryQuestionBank(ownerId, filters = {}) {
  if (notReady(ownerId)) return [];
  let query = supabase.from("question_bank").select("*").eq("owner_id", ownerId);
  if (filters.classId) query = query.eq("class_id", filters.classId);
  if (filters.unitId) query = query.eq("unit_id", filters.unitId);
  if (filters.chapterId) query = query.eq("chapter_id", filters.chapterId);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.year != null && filters.year !== "")
    query = query.eq("year", Number(filters.year));
  if (filters.originType) query = query.eq("origin_type", filters.originType);
  if (filters.materialId) query = query.eq("material_id", filters.materialId);
  if (filters.questionPaperId)
    query = query.eq("question_paper_id", filters.questionPaperId);
  if (filters.topic) query = query.eq("topic", filters.topic);
  const { data, error } = await query
    .order("year", { ascending: false, nullsFirst: false })
    .order("question_no", { ascending: true });
  if (error) {
    warn("queryQuestionBank", error);
    return [];
  }
  return data || [];
}
