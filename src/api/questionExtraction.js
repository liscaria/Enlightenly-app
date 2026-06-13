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

/** CBSE papers often print Hindi and English — keep English/Latin text only. */
export function englishOnlyQuestionText(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.replace(/[\u0900-\u097F]+/g, " ");
  // Drop common PDF custom-font mojibake symbols from Hindi layers
  s = s.replace(/[§$©±¶{}/\\|~<>^&·•]/g, " ");
  const lines = s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const englishLines = lines.filter((line) => /[A-Za-z]{3,}/.test(line));
  s = (englishLines.length ? englishLines : lines).join("\n");
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Score how readable a text fragment is as English exam prose. */
function englishReadabilityScore(text) {
  if (!text) return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;
  const words = cleaned.match(/[A-Za-z]{3,}/g) || [];
  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const nonSpace = cleaned.replace(/\s/g, "").length;
  if (!nonSpace) return 0;
  const letterRatio = letters / nonSpace;
  const weird = (cleaned.match(/[§$©±¶{}/\\|~<>^&]/g) || []).length;
  return words.length * 12 + letterRatio * 40 - weird * 8;
}

export function looksLikeEnglishQuestionText(text) {
  if (!text || text.length < 12) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const nonSpace = text.replace(/\s/g, "").length;
  if (!nonSpace || letters / nonSpace < 0.45) return false;
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  if (words.length < 2) return false;
  const weird = (text.match(/[§$©±¶{}/\\|~<>^&]/g) || []).length;
  if (weird > 1) return false;
  return englishReadabilityScore(text) >= 18;
}

function normalizeQuestion(item, index) {
  const raw = (item.questionText ?? item.question_text ?? item.text ?? "").trim();
  const text = englishOnlyQuestionText(raw);
  if (!text) return null;
  const marksRaw = item.marks ?? item.mark ?? null;
  const marks =
    marksRaw === null || marksRaw === undefined || marksRaw === ""
      ? null
      : Number(marksRaw);
  const solutionRaw = item.solution ?? item.answer ?? null;
  const solution =
    solutionRaw && `${solutionRaw}`.trim()
      ? englishOnlyQuestionText(`${solutionRaw}`.trim())
      : null;
  return {
    questionNo: Number(item.questionNo ?? item.question_no ?? index + 1),
    questionText: text,
    marks: Number.isFinite(marks) ? marks : null,
    solution: solution || null,
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
/** CBSE bilingual papers: Hindi column is usually left of this ratio. */
const ENGLISH_COLUMN_MIN_RATIO = 0.42;

function joinLineItems(items) {
  return items
    .map((item) => item.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a PDF line into English body (ignore Hindi column) and right-margin marks. */
function splitLineBodyAndMargin(line, pageWidth) {
  if (!line?.items?.length) return { body: "", marginMark: null };

  const marginThreshold = pageWidth * MARGIN_X_RATIO;
  const mid = pageWidth * 0.5;
  const marginItems = [];
  const contentItems = [];

  for (const item of line.items) {
    const trimmed = item.str.trim();
    if (!trimmed) continue;
    const isFarRight = item.x >= marginThreshold;
    const isMarkLike = /^\d{1,2}(?:\.\d+)?$/.test(trimmed);
    if (isFarRight && isMarkLike) {
      marginItems.push(item);
    } else if (item.x < marginThreshold) {
      contentItems.push(item);
    }
  }

  const leftBody = joinLineItems(contentItems.filter((item) => item.x < mid));
  const rightBody = joinLineItems(contentItems.filter((item) => item.x >= mid));
  const englishBandBody = joinLineItems(
    contentItems.filter((item) => item.x >= pageWidth * ENGLISH_COLUMN_MIN_RATIO)
  );

  let body = "";
  const leftScore = englishReadabilityScore(leftBody);
  const rightScore = englishReadabilityScore(rightBody);
  const bandScore = englishReadabilityScore(englishBandBody);

  if (rightScore >= leftScore && rightScore >= bandScore && rightScore > 0) {
    body = rightBody;
  } else if (bandScore >= leftScore && bandScore > 0) {
    body = englishBandBody;
  } else if (leftScore > 0) {
    body = leftBody;
  } else {
    body = joinLineItems(contentItems);
  }

  body = englishOnlyQuestionText(body);

  const marginRaw = marginItems.length
    ? marginItems[marginItems.length - 1].str.trim()
    : null;
  const marginMark =
    marginRaw != null && /^\d{1,2}(?:\.\d+)?$/.test(marginRaw)
      ? Number(marginRaw)
      : null;

  return { body, marginMark };
}

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
  if (!looksLikeEnglishQuestionText(body)) return null;

  const solutionMatch = body.match(
    /(?:^|\n)(?:Solution|Answer)\s*[:.\-]\s*([\s\S]+)$/i
  );
  let questionText = body;
  let solution = null;
  if (solutionMatch) {
    solution = solutionMatch[1].trim();
    questionText = body.slice(0, solutionMatch.index).trim();
  }

  const normalized = normalizeQuestion(
    {
      questionNo: current.questionNo,
      questionText,
      marks: extractMarksFromChunk(body, current.marginCandidates),
      solution,
    },
    current.questionNo - 1
  );
  if (!normalized || !looksLikeEnglishQuestionText(normalized.questionText)) {
    return null;
  }
  return normalized;
}

function isQuestionStartLine(body) {
  // ASCII period only — avoid "1·47" refractive-index values starting a fake Q1
  const match = body.match(/^(\d{1,2})\.(?!\d)\s*(.*)$/s);
  if (!match) return null;
  const rest = (match[2] || "").trim();
  if (!rest) return match;
  if (/^\d/.test(rest)) return null;
  if (englishReadabilityScore(rest) < 8 && !/^\(?[A-D]\)?[\).:\s]/i.test(rest)) {
    return null;
  }
  return match;
}

function isMcqOptionLine(body) {
  return /^\(\s*[A-D]\s*\)/i.test(body) || /^[A-D][\).:\s]/i.test(body);
}

/** Extract questions using PDF x/y layout (CBSE margin marks on the right). */
function extractQuestionsFromStructuredPages(pages) {
  const questions = [];
  let current = null;

  for (const pageLines of pages) {
    for (const line of pageLines) {
      const body = line.body?.trim() || "";
      if (!body || isSectionOrHeaderLine(body)) continue;

      const questionStart = isQuestionStartLine(body);
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

      if (!isMcqOptionLine(body) && !looksLikeEnglishQuestionText(body)) continue;

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
            'You extract exam questions from teacher question papers. Return JSON: {"questions":[{"questionNo":1,"questionText":"full question text","marks":2,"solution":"answer text or null","topic":null}]}. Extract EVERY numbered question in the text chunk. CBSE papers often print Hindi and English — put questionText and solution in English only; omit Hindi/Devanagari and any garbled symbols. Skip lines that are not valid English. In CBSE papers, marks appear as a number in the right margin of the question row (e.g. "1" means 1 mark) — they may appear in the text as "[1 marks]" tags. Include multiple-choice options (A,B,C,D) inside questionText. Use null for unknown marks or solution. Do not invent content.',
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
    .filter(Boolean)
    .filter((q) => looksLikeEnglishQuestionText(q.questionText));
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
      let questions = await extractWithOpenAI(text, name || "question-paper");
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

  const questions = extractWithHeuristics(text)
    .filter((q) => looksLikeEnglishQuestionText(q.questionText));
  return {
    questions,
    extractedBy: questions.length ? "heuristic" : "none",
  };
}

export function assignQuestionIds(questions, extractedBy = "manual") {
  return questions.map((q, index) => ({
    id: q.id || crypto.randomUUID(),
    questionNo: q.questionNo ?? index + 1,
    questionText: englishOnlyQuestionText(q.questionText || ""),
    marks: q.marks ?? null,
    solution: q.solution ? englishOnlyQuestionText(q.solution) : null,
    topic: q.topic ?? null,
    chapterId: q.chapterId ?? null,
    unitId: q.unitId ?? null,
    chapterName: q.chapterName ?? null,
    extractedBy,
  }));
}
