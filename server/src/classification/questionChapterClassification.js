import { config } from "../lib/config.js";
import { chatCompletion } from "../lib/openaiClient.js";
import { OPENAI_ACTIONS } from "../lib/openaiUsageAccumulator.js";
import { documentTextFromBlob } from "../extraction/questionExtraction.js";
import { downloadMaterialBlob } from "../data/materialsRemote.js";

const BATCH_SIZE = 15;

export function normalizeChapterConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function chapterKeyFromName(name) {
  const lower = (name || "").toLowerCase();
  const afterColon = lower.split(":").pop()?.trim() || lower;
  const afterDash = afterColon.split(" - ").pop()?.trim() || afterColon;
  return afterDash.replace(/^chapter[-\s]*\d+[:.\s]*/i, "").trim();
}

function chapterNumberFromLabel(label) {
  const match = (label || "").match(/chapter[-\s]*(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function resolveChapterFromAssignment(assignment, chapterIndex) {
  if (!assignment || !chapterIndex?.length) return null;

  const byId = new Map(chapterIndex.map((c) => [c.id, c]));
  const chapterId = assignment.chapterId ?? assignment.chapter_id ?? null;
  if (chapterId && byId.has(chapterId)) return byId.get(chapterId);

  const rawName = (assignment.chapterName ?? assignment.chapter_name ?? "").trim();
  if (rawName) {
    const lower = rawName.toLowerCase();
    const exact = chapterIndex.find((c) => c.name.toLowerCase() === lower);
    if (exact) return exact;

    const partial = chapterIndex.find(
      (c) =>
        c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
    );
    if (partial) return partial;
  }

  const num =
    chapterNumberFromLabel(rawName) ??
    chapterNumberFromLabel(String(chapterId || ""));
  if (num != null) {
    const byNum = chapterIndex.find((c) => chapterNumberFromLabel(c.name) === num);
    if (byNum) return byNum;
  }

  return null;
}

function heuristicConfidence(score) {
  if (!Number.isFinite(score) || score <= 0) return null;
  return Math.min(88, Math.round(35 + Math.min(score, 40) * 1.2));
}

function classifyQuestionsHeuristic(questions, chapterIndex) {
  if (!chapterIndex.length) return questions;

  const chapterProfiles = chapterIndex.map((ch) => {
    const key = chapterKeyFromName(ch.name);
    const words = key.split(/\W+/).filter((w) => w.length > 3);
    return { ch, key, words };
  });

  return questions.map((q) => {
    const text = (q.questionText || "").toLowerCase();
    let match = null;
    let bestScore = 0;

    for (const { ch, key, words } of chapterProfiles) {
      if (key.length >= 4 && text.includes(key)) {
        const score = key.length + 40;
        if (score > bestScore) {
          match = ch;
          bestScore = score;
        }
        continue;
      }

      let wordScore = 0;
      for (const word of words) {
        if (text.includes(word)) wordScore += word.length;
      }
      if (wordScore > bestScore && wordScore >= 10) {
        match = ch;
        bestScore = wordScore;
      }
    }

    if (!match) {
      return {
        ...q,
        chapterId: null,
        unitId: null,
        chapterName: null,
        chapterConfidence: null,
      };
    }

    return {
      ...q,
      chapterId: match.id,
      unitId: match.unitId,
      chapterName: match.name,
      chapterConfidence: heuristicConfidence(bestScore),
    };
  });
}

async function classifyBatchWithOpenAI(
  batch,
  chapterIndex,
  { syllabusText = "", paperName = "", usageContext = null, accumulator = null, batchIndex = 0 } = {}
) {
  const chaptersPayload = chapterIndex.map((c) => ({
    id: c.id,
    name: c.name,
    unit: c.unitName,
  }));
  const questionsPayload = batch.map((q) => ({
    questionNo: q.questionNo,
    questionText: (q.questionText || "").slice(0, 800),
    topic: q.topic ?? null,
  }));

  const payload = await chatCompletion({
    body: {
      model: config.openaiModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You classify exam questions into syllabus chapters for a teacher's class.
Return JSON: {"assignments":[{"questionNo":1,"chapterId":"copy-exact-id","chapterName":"Chapter-1: ...","confidence":85}]}
Rules:
- chapterId MUST be copied exactly from the "id" field in the Chapters list (e.g. chapter-1734567890). Never invent ids.
- chapterName should match the catalog chapter name when possible.
- confidence: integer 0–100 — how sure you are the question belongs in that chapter.
- Read each chapter's syllabus excerpt first: map each question to the chapter whose syllabus topics it tests.
- Use question wording (topics, formulas, terminology) when syllabus is ambiguous.
- Prefer exactly one best-matching chapter; use null chapterId only if truly unknown.
- Same questionNo as input.`,
        },
        {
          role: "user",
          content: `Exam paper: ${paperName || "question paper"}

Chapters (copy id exactly into chapterId):
${JSON.stringify(chaptersPayload, null, 2)}

${syllabusText ? `Syllabus by chapter:\n${syllabusText.slice(0, 35000)}\n\n` : "No syllabus text loaded — use chapter names and question topics.\n\n"}
Questions:
${JSON.stringify(questionsPayload, null, 2)}`,
        },
      ],
    },
    action: OPENAI_ACTIONS.CLASSIFY_LLM,
    usageContext,
    accumulator,
    metadata: { batchIndex, questionCount: batch.length },
    label: "Chapter LLM classification",
  });

  const raw = payload?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed.assignments || parsed.classifications || [];
  return list;
}

function applyAssignments(questions, assignments, chapterIndex) {
  const byNo = new Map(
    assignments.map((a) => [Number(a.questionNo ?? a.question_no), a])
  );

  return questions.map((q) => {
    const a = byNo.get(Number(q.questionNo));
    if (!a) return q;

    const ch = resolveChapterFromAssignment(a, chapterIndex);
    if (!ch) {
      return {
        ...q,
        chapterId: null,
        unitId: null,
        chapterName: null,
        chapterConfidence: null,
      };
    }

    return {
      ...q,
      chapterId: ch.id,
      unitId: ch.unitId,
      chapterName: a.chapterName ?? a.chapter_name ?? ch.name,
      chapterConfidence: normalizeChapterConfidence(
        a.confidence ?? a.chapterConfidence ?? a.chapter_confidence
      ),
    };
  });
}

export async function classifyQuestionsToChapters(
  questions,
  chapterIndex,
  { syllabusText = "", paperName = "", usageContext = null, accumulator = null } = {}
) {
  if (!questions.length || !chapterIndex.length) {
    return { questions, classifiedBy: "none" };
  }

  if (!config.openaiApiKey) {
    return {
      questions: classifyQuestionsHeuristic(questions, chapterIndex),
      classifiedBy: "heuristic",
    };
  }

  try {
    const allAssignments = [];
    for (let i = 0; i < questions.length; i += BATCH_SIZE) {
      const batch = questions.slice(i, i + BATCH_SIZE);
      const assignments = await classifyBatchWithOpenAI(batch, chapterIndex, {
        syllabusText,
        paperName,
        usageContext,
        accumulator,
        batchIndex: Math.floor(i / BATCH_SIZE),
      });
      allAssignments.push(...assignments);
    }
    const merged = applyAssignments(questions, allAssignments, chapterIndex);
    const assigned = merged.filter((q) => q.chapterId).length;
    if (assigned === 0) {
      return {
        questions: classifyQuestionsHeuristic(questions, chapterIndex),
        classifiedBy: "heuristic",
      };
    }
    return { questions: merged, classifiedBy: "ai" };
  } catch (err) {
    return {
      questions: classifyQuestionsHeuristic(questions, chapterIndex),
      classifiedBy: "heuristic",
    };
  }
}

/**
 * Load text from all Syllabus uploads in a class (for classification context).
 */
export async function collectSyllabusTextForClass(
  catalog,
  classId,
  normalizeMaterialCategory,
  { supabase, ownerId } = {}
) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) return "";

  const parts = [];
  for (const unit of classItem.units || []) {
    for (const chapter of unit.chapters || []) {
      for (const file of chapter.files || []) {
        if (normalizeMaterialCategory(file) !== "Syllabus") continue;
        try {
          const remote = await downloadMaterialBlob(supabase, ownerId, file.id);
          if (!remote?.blob) continue;
          const text = await documentTextFromBlob(
            remote.blob,
            remote.mimeType || file.mimeType,
            remote.name || file.name
          );
          if (text.trim()) {
            parts.push(
              `## ${chapter.name} (chapterId: ${chapter.id})\n${text.trim().slice(0, 6000)}`
            );
          }
        } catch {
          /* skip unreadable syllabus */
        }
      }
    }
  }
  return parts.join("\n\n").slice(0, 40000);
}
