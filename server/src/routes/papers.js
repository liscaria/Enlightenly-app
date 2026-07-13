import { Router } from "express";
import { createSupabaseForUser } from "../lib/supabase.js";
import { log } from "../lib/logger.js";
import { createExtractionJob, processPaperJob } from "../jobs/processPaperJob.js";
import { reclassifyPaperJob } from "../jobs/reclassifyPaperJob.js";

export const papersRouter = Router();

papersRouter.post("/:paperId/process", async (req, res) => {
  const paperId = req.params.paperId;
  const ownerId = req.userId;
  const requestId = req.requestId;

  try {
    const supabase = createSupabaseForUser(req.accessToken);

    const { data: paper, error: paperError } = await supabase
      .from("question_papers")
      .select("id, name")
      .eq("owner_id", ownerId)
      .eq("id", paperId)
      .maybeSingle();

    if (paperError) {
      return res.status(500).json({ error: paperError.message });
    }
    if (!paper) {
      return res.status(404).json({ error: `Question paper "${paperId}" not found.` });
    }

    const jobId = await createExtractionJob(supabase, ownerId, paperId, requestId);
    log("info", "job.queued", { requestId, jobId, paperId, userId: ownerId });

    const result = await processPaperJob({
      supabase,
      ownerId,
      paperId,
      jobId,
      requestId,
    });

    return res.status(200).json({
      jobId,
      status: result.status,
      questionCount: result.questionCount,
      bankRowCount: result.bankRowCount ?? 0,
      assignedCount: result.assignedCount ?? 0,
      extractedBy: result.extractedBy,
      extractionPath: result.extractionPath,
      classifiedBy: result.classifiedBy,
      qualityReport: result.qualityReport,
      usageSummary: result.usageSummary,
    });
  } catch (err) {
    const message = err?.message || "Extraction job failed.";
    log("error", "papers.process.failed", { requestId, paperId, error: message });
    return res.status(500).json({ error: message, requestId });
  }
});

papersRouter.post("/:paperId/reclassify", async (req, res) => {
  const paperId = req.params.paperId;
  const ownerId = req.userId;
  const requestId = req.requestId;
  const onlyUnassigned = Boolean(req.body?.onlyUnassigned);

  try {
    const supabase = createSupabaseForUser(req.accessToken);

    const result = await reclassifyPaperJob({
      supabase,
      ownerId,
      paperId,
      requestId,
      onlyUnassigned,
    });

    return res.status(200).json({
      status: result.status,
      questionCount: result.questionCount,
      assignedCount: result.assignedCount,
      classifiedBy: result.classifiedBy,
      usageSummary: result.usageSummary,
    });
  } catch (err) {
    const message = err?.message || "Reclassify failed.";
    log("error", "papers.reclassify.failed", { requestId, paperId, error: message });
    return res.status(500).json({ error: message, requestId });
  }
});
