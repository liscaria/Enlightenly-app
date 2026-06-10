// Extract individual questions from uploaded question-paper documents.
// Uses OpenAI when VITE_OPENAI_API_KEY is set; otherwise PDF/text heuristics.

import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
const PAGE_BREAK = "\n\n---PAGE---\n\n";
const MAX_QUESTIONS = 300;
const AI_CHUNK_SIZE = 28000;

function normalizeQuestion(item, index) {
  const text = (item.questionText ?? item.question_text ?? item.text ?? "").trim();
  if (!text) return null;
  const marksRaw = item.marks ?? item.mark ?? null;
  const marks =
    marksRaw === null || marksRaw === undefined || marksRaw === ""
      ? null
      : Number(marksRaw);
  const solutionRaw = item.solution ?? item.answer ?? null;
  return {
    questionNo: Number(item.questionNo ?? item.question_no ?? index + 1),
    questionText: text,
    marks: Number.isFinite(marks) ? marks : null,
    solution:
      solutionRaw && `${solutionRaw}`.trim() ? `${solutionRaw}`.trim() : null,
    topic: item.topic ?? null,
  };
}

function dedupeQuestions(questions) {
  const seen = new Set();
  const out = [];
  for (const q of questions) {
    const key = `${q.questionNo ?? ""}::${q.questionText.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out.map((q, index) => ({
    ...q,
    questionNo: q.questionNo ?? index + 1,
  }));
}

const LINE_Y_TOLERANCE = 4;
const MARGIN_X_RATIO = 0.68;

function groupItemsIntoLines(items) {
  const positioned = (items || [])
    .filter((item) => item.str?.trim())
    .map((item) => ({
      str: item.str,
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }));

  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > LINE_Y_TOLERANCE) return b.y - a.y;
    return a.x - b.x;
  });

  const lines = [];
  for (const item of positioned) {
    const last = lines[lines.length - 1];
    if (!last || Math.abs(item.y - last.y) > LINE_Y_TOLERANCE) {
      lines.push({ y: item.y, items: [item] });
    } else {
      last.items.push(item);
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
  }
  return lines;
}

/** Split a PDF text line into body (left/center) and margin mark (far right). */
function splitLineBodyAndMargin(line, pageWidth) {
  if (!line?.items?.length) return { body: "", marginMark: null };

  const marginThreshold = pageWidth * MARGIN_X_RATIO;
  const bodyItems = [];
  const marginItems = [];

  for (const item of line.items) {
    const trimmed = item.str.trim();
    if (!trimmed) continue;
    const isFarRight = item.x >= marginThreshold;
    const isMarkLike = /^\d{1,2}(?:\.\d+)?$/.test(trimmed);
    if (isFarRight && isMarkLike) {
      marginItems.push(item);
    } else {
      bodyItems.push(item);
    }
  }

  const body = bodyItems
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const marginRaw = marginItems.length
    ? marginItems[marginItems.length - 1].str.trim()
    : null;
  const marginMark =
    marginRaw != null && /^\d{1,2}(?:\.\d+)?$/.test(marginRaw)
      ? Number(marginRaw)
      : null;

  return { body, marginMark };
}

function structuredLinesToText(lines) {
  return lines
    .filter((line) => line.body)
    .map((line) => {
      if (line.marginMark != null && Number.isFinite(line.marginMark)) {
        return `${line.body} [${line.marginMark} marks]`;
      }
      return line.body;
    })
    .join("\n");
}

function isSectionOrHeaderLine(body) {
  return (
    !body ||
    /^SECTION\s*[-–—]/i.test(body) ||
    /^Page\s+\d+/i.test(body) ||
    /^P\.T\.O\./i.test(body)
  );
}

function extractMarksFromChunk(body, marginCandidates = []) {
  if (marginCandidates.length) {
    const mark = marginCandidates.find((m) => Number.isFinite(m) && m > 0);
    if (mark != null) return mark;
  }
  const marksMatch =
    body.match(/\[(\d+(?:\.\d+)?)\s*marks?\]/i) ||
    body.match(/\((\d+(?:\.\d+)?)\s*marks?\)/i) ||
    body.match(/(\d+)\s*marks?\s*$/im) ||
    body.match(/\[(\d+(?:\.\d+)?)\]/);
  return marksMatch ? Number(marksMatch[1]) : null;
}

function finalizeStructuredQuestion(current) {
  const body = current.lines.join("\n").trim();
  if (body.length < 15) return null;

  const solutionMatch = body.match(
    /(?:^|\n)(?:Solution|Answer)\s*[:.\-]\s*([\s\S]+)$/i
  );
  let questionText = body;
  let solution = null;
  if (solutionMatch) {
    solution = solutionMatch[1].trim();
    questionText = body.slice(0, solutionMatch.index).trim();
  }

  return normalizeQuestion(
    {
      questionNo: current.questionNo,
      questionText,
      marks: extractMarksFromChunk(body, current.marginCandidates),
      solution,
    },
    current.questionNo - 1
  );
}

/** Extract questions using PDF x/y layout (CBSE margin marks on the right). */
function extractQuestionsFromStructuredPages(pages) {
  const questions = [];
  let current = null;

  for (const pageLines of pages) {
    for (const line of pageLines) {
      const body = line.body?.trim() || "";
      if (!body || isSectionOrHeaderLine(body)) continue;

      const questionStart = body.match(/^(\d{1,2})\.\s*(.*)$/s);
      if (questionStart) {
        if (current) {
          const finalized = finalizeStructuredQuestion(current);
          if (finalized) questions.push(finalized);
        }
        const rest = questionStart[2]?.trim() || "";
        current = {
          questionNo: Number(questionStart[1]),
          lines: rest ? [rest] : [],
          marginCandidates: line.marginMark != null ? [line.marginMark] : [],
        };
        continue;
      }

      if (!current) continue;

      if (line.marginMark != null) current.marginCandidates.push(line.marginMark);
      current.lines.push(body);
    }
  }

  if (current) {
    const finalized = finalizeStructuredQuestion(current);
    if (finalized) questions.push(finalized);
  }

  return dedupeQuestions(questions).slice(0, MAX_QUESTIONS);
}

async function pdfBlobToStructuredPages(blob) {
  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const rawLines = groupItemsIntoLines(content.items);
    const structured = rawLines
      .map((line) => splitLineBodyAndMargin(line, viewport.width))
      .filter((line) => line.body || line.marginMark != null);
    if (structured.length) pages.push(structured);
  }

  return pages;
}

async function pdfBlobToText(blob) {
  const pages = await pdfBlobToStructuredPages(blob);
  return pages.map((page) => structuredLinesToText(page)).join(PAGE_BREAK);
}

function chunkText(text, size = AI_CHUNK_SIZE) {
  if (text.length <= size) return [text];
  const chunks = [];
  const pages = text.split(PAGE_BREAK);
  let current = "";
  for (const page of pages) {
    const piece = page.trim();
    if (!piece) continue;
    const candidate = current ? `${current}${PAGE_BREAK}${piece}` : piece;
    if (candidate.length > size && current) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  if (!chunks.length) {
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
  }
  return chunks;
}

async function documentTextFromBlob(blob, mimeType, name = "") {
  const mime = mimeType || blob.type || "";
  const lowerName = (name || "").toLowerCase();

  if (mime.startsWith("text/") || lowerName.endsWith(".txt")) {
    return blob.text();
  }

  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) {
    try {
      return await pdfBlobToText(blob);
    } catch (err) {
      console.warn("[questionExtraction] PDF parse failed:", err);
      return "";
    }
  }

  return "";
}

export { documentTextFromBlob };

const QUESTION_START =
  /(?=(?:^|\n)\s*(?:\(?\d{1,2}\)?[\).:]\s+(?=[A-Za-z("'(])|Q(?:uestion)?\.?\s*\d+|Question\s+\d+))/gi;

const INLINE_QUESTION_START =
  /(?=(?:^|[\n\r])\s*\d{1,2}\.\s+(?=[A-Za-z("'(]))/g;

function splitQuestionChunks(text) {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!cleaned) return [];

  const byMarker = cleaned.split(QUESTION_START).map((s) => s.trim()).filter(Boolean);
  if (byMarker.length > 1) return byMarker;

  const byInline = cleaned.split(INLINE_QUESTION_START).map((s) => s.trim()).filter(Boolean);
  if (byInline.length > 1) return byInline;

  const pages = cleaned.split(PAGE_BREAK).map((s) => s.trim()).filter(Boolean);
  if (pages.length > 1) {
    const fromPages = [];
    for (const page of pages) {
      const pageChunks = page
        .split(INLINE_QUESTION_START)
        .map((s) => s.trim())
        .filter((s) => s.length >= 20);
      if (pageChunks.length > 1) {
        fromPages.push(...pageChunks);
      } else if (page.length >= 30) {
        fromPages.push(page);
      }
    }
    if (fromPages.length > 1) return fromPages;
  }

  const byParagraph = cleaned.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (byParagraph.length > 1) return byParagraph;

  const byLine = cleaned
    .split(/\n/)
    .map((s) => s.trim())
    .filter((s) => /^\d{1,2}\.\s/.test(s) && s.length >= 20);
  if (byLine.length > 1) return byLine;

  return [cleaned];
}

function extractWithHeuristics(text) {
  const chunks = splitQuestionChunks(text);

  return chunks
    .map((chunk, index) => {
      const body = chunk.trim();
      if (body.length < 15) return null;
      const solutionMatch = body.match(
        /(?:^|\n)(?:Solution|Answer)\s*[:.\-]\s*([\s\S]+)$/i
      );
      const numberMatch = body.match(
        /^(?:\(?(\d{1,2})\)?[\).:]\s*|Q(?:uestion)?\.?\s*(\d+)\s*[:.\-]?\s*|Question\s+(\d+)\s*[:.\-]?\s*)/i
      );
      let questionText = body;
      let solution = null;
      if (solutionMatch) {
        solution = solutionMatch[1].trim();
        questionText = body.slice(0, solutionMatch.index).trim();
      }
      const questionNo = Number(
        numberMatch?.[1] || numberMatch?.[2] || numberMatch?.[3] || index + 1
      );
      return normalizeQuestion(
        {
          questionNo,
          questionText,
          marks: extractMarksFromChunk(body),
          solution,
        },
        index
      );
    })
    .filter(Boolean)
    .slice(0, MAX_QUESTIONS);
}

async function extractWithOpenAISingle(text, fileName) {
  if (!OPENAI_API_KEY) return [];

  const trimmed = text.slice(0, AI_CHUNK_SIZE);
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
          content:
            'You extract exam questions from teacher question papers. Return JSON: {"questions":[{"questionNo":1,"questionText":"full question text","marks":2,"solution":"answer text or null","topic":null}]}. Extract EVERY numbered question in the text chunk. In CBSE papers, marks appear as a number in the right margin of the question row (e.g. "1" means 1 mark) — they may appear in the text as "[1 marks]" tags. Include multiple-choice options (A,B,C,D) inside questionText. Use null for unknown marks or solution. Do not invent content.',
        },
        {
          role: "user",
          content: `File: ${fileName}\n\nExtract every question from this text:\n\n${trimmed}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`AI extraction failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed.questions || [];
  return list
    .map((item, index) => normalizeQuestion(item, index))
    .filter(Boolean);
}

async function extractWithOpenAI(text, fileName) {
  if (!OPENAI_API_KEY) return [];

  const chunks = text.includes(PAGE_BREAK)
    ? text.split(PAGE_BREAK).map((s) => s.trim()).filter(Boolean)
    : chunkText(text);

  const all = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const batch = await extractWithOpenAISingle(
      chunks[i],
      `${fileName} (section ${i + 1}/${chunks.length})`
    );
    all.push(...batch);
  }
  return dedupeQuestions(all).slice(0, MAX_QUESTIONS);
}

/**
 * @returns {Promise<{ questions: object[], extractedBy: 'ai'|'heuristic'|'none' }>}
 */
function isPdfBlob(blob, mimeType, name = "") {
  const mime = mimeType || blob.type || "";
  const lowerName = (name || "").toLowerCase();
  return mime === "application/pdf" || lowerName.endsWith(".pdf");
}

export async function extractQuestionsFromDocument(blob, { name, mimeType } = {}) {
  if (!blob) return { questions: [], extractedBy: "none" };

  let structuredPages = null;
  let text = "";

  if (isPdfBlob(blob, mimeType, name)) {
    try {
      structuredPages = await pdfBlobToStructuredPages(blob);
      text = structuredPages.map((page) => structuredLinesToText(page)).join(PAGE_BREAK);
    } catch (err) {
      console.warn("[questionExtraction] PDF layout parse failed:", err);
    }
  }

  if (!text.trim()) {
    text = await documentTextFromBlob(blob, mimeType, name);
  }
  if (!text.trim() && !structuredPages?.length) {
    return { questions: [], extractedBy: "none" };
  }

  if (OPENAI_API_KEY && text.trim()) {
    try {
      const questions = await extractWithOpenAI(text, name || "question-paper");
      if (questions.length) {
        return { questions, extractedBy: "ai" };
      }
    } catch (err) {
      console.warn("[questionExtraction] AI failed, using heuristics:", err);
    }
  }

  if (structuredPages?.length) {
    const layoutQuestions = extractQuestionsFromStructuredPages(structuredPages);
    if (layoutQuestions.length) {
      return { questions: layoutQuestions, extractedBy: "heuristic" };
    }
  }

  const questions = extractWithHeuristics(text);
  return {
    questions,
    extractedBy: questions.length ? "heuristic" : "none",
  };
}

export function assignQuestionIds(questions, extractedBy = "manual") {
  return questions.map((q, index) => ({
    id: q.id || crypto.randomUUID(),
    questionNo: q.questionNo ?? index + 1,
    questionText: q.questionText,
    marks: q.marks ?? null,
    solution: q.solution ?? null,
    topic: q.topic ?? null,
    chapterId: q.chapterId ?? null,
    unitId: q.unitId ?? null,
    chapterName: q.chapterName ?? null,
    extractedBy,
  }));
}
