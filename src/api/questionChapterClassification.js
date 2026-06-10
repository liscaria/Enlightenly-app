// Assign exam-paper questions to syllabus chapters using AI (or name matching).

import { documentTextFromBlob } from "./questionExtraction.js";

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";

const BATCH_SIZE = 15;

function chapterKeyFromName(name) {
  const lower = (name || "").toLowerCase();
  const afterColon = lower.split(":").pop()?.trim() || lower;
  const afterDash = afterColon.split(" - ").pop()?.trim() || afterColon;
  return afterDash.replace(/^chapter[-\s]*\d+[:.\s]*/i, "").trim();
}

function classifyQuestionsHeuristic(questions, chapterIndex) {
  if (!chapterIndex.length) return questions;
  return questions.map((q) => {
    const text = (q.questionText || "").toLowerCase();
    let match = null;
    let bestLen = 0;
    for (const ch of chapterIndex) {
      const key = chapterKeyFromName(ch.name);
      if (key.length < 4) continue;
      if (text.includes(key) && key.length > bestLen) {
        match = ch;
        bestLen = key.length;
      }
    }
    if (!match) return q;
    return {
      ...q,
      chapterId: match.id,
      unitId: match.unitId,
      chapterName: match.name,
    };
  });
}

async function classifyBatchWithOpenAI(
  batch,
  chapterIndex,
  { syllabusText = "", paperName = "" } = {}
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You classify exam questions into syllabus chapters for a teacher's class.
Return JSON: {"assignments":[{"questionNo":1,"chapterId":"exact-id-or-null","chapterName":"optional"}]}
Rules:
- chapterId MUST be one of the provided chapter ids, or null if truly unknown.
- Read the syllabus excerpt first: map each question to the chapter whose syllabus topics it tests.
- Use question wording (topics, formulas, terminology) when syllabus is ambiguous.
- Prefer exactly one best-matching chapter; do not invent chapters.
- Same questionNo as input.`,
        },
        {
          role: "user",
          content: `Exam paper: ${paperName || "question paper"}

Chapters (use these ids only):
${JSON.stringify(chaptersPayload, null, 2)}

${syllabusText ? `Syllabus excerpt:\n${syllabusText.slice(0, 35000)}\n\n` : ""}
Questions:
${JSON.stringify(questionsPayload, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Chapter classification failed (${response.status}): ${detail.slice(0, 200)}`
    );
  }

  const payload = await response.json();
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
  const chapterById = new Map(chapterIndex.map((c) => [c.id, c]));

  return questions.map((q) => {
    const a = byNo.get(Number(q.questionNo));
    if (!a) return q;
    const chapterId = a.chapterId ?? a.chapter_id ?? null;
    if (!chapterId) {
      return { ...q, chapterId: null, unitId: null, chapterName: null };
    }
    const ch = chapterById.get(chapterId);
    if (!ch) return q;
    return {
      ...q,
      chapterId: ch.id,
      unitId: ch.unitId,
      chapterName: a.chapterName ?? a.chapter_name ?? ch.name,
    };
  });
}

/**
 * @param {object[]} questions - with questionNo, questionText
 * @param {object[]} chapterIndex - from buildChapterIndexForClass
 */
export async function classifyQuestionsToChapters(
  questions,
  chapterIndex,
  { syllabusText = "", paperName = "" } = {}
) {
  if (!questions.length || !chapterIndex.length) {
    return { questions, classifiedBy: "none" };
  }

  if (!OPENAI_API_KEY) {
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
    console.warn("[questionChapterClassification]", err);
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
  libraryGet,
  normalizeMaterialCategory,
  { ownerId = null, remoteDownloadMaterial = null } = {}
) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem || !libraryGet) return "";

  const parts = [];
  for (const unit of classItem.units || []) {
    for (const chapter of unit.chapters || []) {
      for (const file of chapter.files || []) {
        if (normalizeMaterialCategory(file) !== "Syllabus") continue;
        try {
          let blob = null;
          let mimeType = file.mimeType;
          let name = file.name;
          const rec = await libraryGet(file.id);
          if (rec?.blob) {
            blob = rec.blob;
          } else if (ownerId && remoteDownloadMaterial) {
            const remote = await remoteDownloadMaterial(ownerId, file.id);
            if (remote?.blob) {
              blob = remote.blob;
              mimeType = remote.mimeType || mimeType;
              name = remote.name || name;
            }
          }
          if (!blob) continue;
          const text = await documentTextFromBlob(blob, mimeType, name);
          if (text.trim()) {
            parts.push(`## ${chapter.name}\n${text.trim().slice(0, 6000)}`);
          }
        } catch {
          /* skip unreadable syllabus */
        }
      }
    }
  }
  return parts.join("\n\n").slice(0, 40000);
}
