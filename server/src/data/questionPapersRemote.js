import { ensureClassExists } from "./catalogRemote.js";

/** Verify paper metadata is ready for question_bank FK writes. */
export async function ensurePaperReadyForBank(supabase, ownerId, paper) {
  const classId = paper.classId ?? paper.class_id;
  if (!classId) return "Question paper is missing classId.";
  return ensureClassExists(supabase, ownerId, classId);
}
