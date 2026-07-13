import { Router } from "express";
import { createSupabaseForUser } from "../lib/supabase.js";
import { log } from "../lib/logger.js";
import { buildSyllabusKnowledgeJob } from "../jobs/buildSyllabusKnowledgeJob.js";

export const syllabusRouter = Router();

syllabusRouter.post("/chapters/:chapterId/build", async (req, res) => {
  const chapterId = req.params.chapterId;
  const ownerId = req.userId;
  const requestId = req.requestId;
  const { classId, unitId, chapterName, materialId } = req.body || {};

  if (!classId || !unitId || !chapterName || !materialId) {
    return res.status(400).json({
      error: "classId, unitId, chapterName, and materialId are required.",
    });
  }

  try {
    const supabase = createSupabaseForUser(req.accessToken);

    const result = await buildSyllabusKnowledgeJob({
      supabase,
      ownerId,
      requestId,
      classId,
      unitId,
      chapterId,
      chapterName: String(chapterName),
      materialId: String(materialId),
    });

    return res.status(200).json({
      status: result.status,
      mismatchWarning: result.mismatchWarning,
      conceptCount: result.conceptCount,
      error: result.error,
      syllabusKnowledgeId: result.syllabusKnowledgeId ?? null,
      usageSummary: result.usageSummary ?? null,
    });
  } catch (err) {
    const message = err?.message || "Syllabus knowledge build failed.";
    log("error", "syllabus.build.failed", { requestId, chapterId, error: message });
    return res.status(500).json({ error: message, requestId });
  }
});
