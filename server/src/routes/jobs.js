import { Router } from "express";
import { createSupabaseForUser } from "../lib/supabase.js";

export const jobsRouter = Router();

jobsRouter.get("/:jobId", async (req, res) => {
  const jobId = req.params.jobId;
  const ownerId = req.userId;

  try {
    const supabase = createSupabaseForUser(req.accessToken);
    const { data, error } = await supabase
      .from("extraction_jobs")
      .select(
        "id, question_paper_id, status, phase, extracted_by, classified_by, question_count, quality_report, error, prompt_version, request_id, started_at, finished_at, created_at"
      )
      .eq("id", jobId)
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Job not found." });

    return res.json({
      jobId: data.id,
      paperId: data.question_paper_id,
      status: data.status,
      phase: data.phase,
      extractedBy: data.extracted_by,
      classifiedBy: data.classified_by,
      questionCount: data.question_count,
      qualityReport: data.quality_report,
      error: data.error,
      promptVersion: data.prompt_version,
      requestId: data.request_id,
      startedAt: data.started_at,
      finishedAt: data.finished_at,
      createdAt: data.created_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Could not load job." });
  }
});
