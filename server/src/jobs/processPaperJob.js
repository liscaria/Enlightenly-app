import { config } from "../lib/config.js";
import { createSupabaseForUser } from "../lib/supabase.js";
import { log } from "../lib/logger.js";
import {
  extractQuestionsFromDocument,
  assignQuestionIds,
} from "../extraction/questionExtraction.js";
import {
  buildExtractionQualityReportFromQuestions,
} from "../extraction/extractionQualityReport.js";
import { stampPaperExpectedTotal } from "../extraction/paperUtils.js";

async function updateJob(supabase, jobId, ownerId, patch) {
  const { error } = await supabase
    .from("extraction_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("owner_id", ownerId);
  if (error) throw new Error(error.message);
}

async function downloadQuestionPaperBlob(supabase, ownerId, paperId) {
  const { data: meta, error: metaError } = await supabase
    .from("question_papers")
    .select("id, name, mime_type, storage_bucket, storage_path")
    .eq("owner_id", ownerId)
    .eq("id", paperId)
    .maybeSingle();

  if (metaError) throw new Error(metaError.message);
  if (!meta?.storage_path) {
    throw new Error(`Question paper "${paperId}" has no file in storage.`);
  }

  const bucket = meta.storage_bucket || config.questionPapersBucket;
  const { data, error } = await supabase.storage.from(bucket).download(meta.storage_path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);

  return {
    blob: data,
    name: meta.name,
    mimeType: meta.mime_type || "application/pdf",
  };
}

/**
 * Run extraction pipeline and persist job results (Phase 1: no question_bank write).
 */
export async function processPaperJob({
  supabase,
  ownerId,
  paperId,
  jobId,
  requestId,
}) {
  const startedAt = new Date().toISOString();

  try {
    await updateJob(supabase, jobId, ownerId, {
      status: "running",
      phase: "downloading",
      started_at: startedAt,
      error: null,
    });
    log("info", "job.phase", { requestId, jobId, paperId, phase: "downloading" });

    const file = await downloadQuestionPaperBlob(supabase, ownerId, paperId);

    await updateJob(supabase, jobId, ownerId, { phase: "extracting" });
    log("info", "job.phase", { requestId, jobId, paperId, phase: "extracting" });

    const result = await extractQuestionsFromDocument(file.blob, {
      name: file.name,
      mimeType: file.mimeType,
    });

    if (!result.questions?.length) {
      throw new Error(result.failureReason || "No questions could be extracted from this PDF.");
    }

    let enriched = stampPaperExpectedTotal(
      assignQuestionIds(result.questions, result.extractedBy),
      result.validation?.expectedCount
    );

    await updateJob(supabase, jobId, ownerId, { phase: "validating" });
    log("info", "job.phase", { requestId, jobId, paperId, phase: "validating" });

    const qualityReport = buildExtractionQualityReportFromQuestions(
      enriched,
      result.validation
    );

    await updateJob(supabase, jobId, ownerId, { phase: "saving" });
    log("info", "job.phase", { requestId, jobId, paperId, phase: "saving" });

    const finishedAt = new Date().toISOString();
    await updateJob(supabase, jobId, ownerId, {
      status: "completed",
      phase: "completed",
      extracted_by: result.extractedBy || "none",
      classified_by: "none",
      question_count: enriched.length,
      quality_report: qualityReport,
      error: null,
      finished_at: finishedAt,
    });

    await supabase
      .from("question_papers")
      .update({
        last_quality_report: qualityReport,
        last_extraction_job_id: jobId,
        updated_at: finishedAt,
      })
      .eq("owner_id", ownerId)
      .eq("id", paperId);

    log("info", "job.completed", {
      requestId,
      jobId,
      paperId,
      questionCount: enriched.length,
      extractedBy: result.extractedBy,
      validationStatus: qualityReport?.validationStatus,
    });

    return {
      jobId,
      status: "completed",
      questionCount: enriched.length,
      extractedBy: result.extractedBy,
      classifiedBy: "none",
      qualityReport,
      questions: enriched,
    };
  } catch (err) {
    const message = err?.message || String(err);
    log("error", "job.failed", { requestId, jobId, paperId, error: message });
    await updateJob(supabase, jobId, ownerId, {
      status: "failed",
      phase: "failed",
      error: message,
      finished_at: new Date().toISOString(),
    });
    throw err;
  }
}

export async function createExtractionJob(supabase, ownerId, paperId, requestId) {
  const { data, error } = await supabase
    .from("extraction_jobs")
    .insert({
      owner_id: ownerId,
      question_paper_id: paperId,
      status: "queued",
      phase: "queued",
      prompt_version: config.promptVersion,
      request_id: requestId,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}
