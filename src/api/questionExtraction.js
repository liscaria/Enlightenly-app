// Extract individual questions from uploaded question-paper documents.
// Uses OpenAI when VITE_OPENAI_API_KEY is set; otherwise PDF/text heuristics.

import * as pdfjs from "pdfjs-dist";
import { buildExtractionMessages, EXTRACTION_SYSTEM_PROMPT, buildVisionExtractionUserText, buildMissingQuestionsRetryPrompt } from "../constants/extractionPrompt.js";
import { EXTRACTION_FEATURE_FLAGS } from "../constants/extractionConfig.js";
import { applyCbseSectionMarks } from "./cbseMarksInference.js";
import {
  validateCbseQuestionSet,
  inferExpectedQuestionCount,
  extractionCountWarning,
} from "./cbseQuestionValidation.js";
import {
  mergeQuestionContinuations,
  buildContinuationHint,
  applyContinuationsToQuestions,
  collectContinuationsFromParsed,
  dedupeRepeatedContentInText,
  mergeDuplicateQuestionEntries,
} from "./questionMerge.js";
import {
  splitAllEmbeddedQuestions,
  needsQuestionNumberRepair,
} from "./questionNumberSplit.js";
import { normalizePhysicsNotation } from "./physicsNotation.js";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const OPENAI_API_KEY = (import.meta.env.VITE_OPENAI_API_KEY || "").trim();
const OPENAI_MODEL = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o-mini";
export const isOpenAIConfigured = Boolean(OPENAI_API_KEY);

async function openaiChatCompletion(body, { label = "AI extraction" } = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    const detail = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const retryAfterSec = Number(response.headers.get("retry-after")) || attempt * 15;
    console.warn(
      `[questionExtraction] ${label} rate limited (${response.status}); retry ${attempt}/${maxAttempts - 1} in ${retryAfterSec}s`
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
  }

  throw new Error(`${label} failed after retries.`);
}

const PAGE_BREAK = "\n\n---PAGE---\n\n";
const MAX_QUESTIONS = 300;
const AI_CHUNK_SIZE = 28000;
/** Minimum Latin letters before we treat PDF text as usable for AI/heuristics. */
const MIN_ENGLISH_LETTERS = 80;
/** Lower bar to attempt text-based OpenAI extraction. */
const MIN_ENGLISH_LETTERS_FOR_AI = 25;
const MIN_NON_WHITESPACE_FOR_AI = 120;
const VISION_PAGE_BATCH = 1;
const VISION_RENDER_SCALE = 1.5;
const VISION_MAX_PAGES = 28;
const VISION_MAX_IMAGE_WIDTH = 1400;

function stripPageBreakNoise(text) {
  return (text || "").replace(/---PAGE---/g, " ").replace(/\s+/g, " ").trim();
}

function countEnglishLetters(text) {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function countNonWhitespace(text) {
  return (text || "").replace(/\s/g, "").length;
}

function textUsableForAI(text) {
  const cleaned = stripPageBreakNoise(text);
  if (!cleaned) return false;
  return (
    countEnglishLetters(cleaned) >= MIN_ENGLISH_LETTERS_FOR_AI ||
    countNonWhitespace(cleaned) >= MIN_NON_WHITESPACE_FOR_AI
  );
}

/** Scanned PDFs often have huge OCR noise in raw text — skip text-AI and use vision. */
function shouldUseTextAiForPdf(structuredText, usedRawPdfFallback) {
  if (usedRawPdfFallback) return false;
  const structuredLetters = countEnglishLetters(stripPageBreakNoise(structuredText));
  return structuredLetters >= MIN_ENGLISH_LETTERS;
}

function pickBestPdfText(...candidates) {
  const usable = candidates.filter((t) => t?.trim());
  if (!usable.length) return "";
  return usable.reduce((best, cur) =>
    countEnglishLetters(cur) > countEnglishLetters(best) ? cur : best
  );
}

/** Hindi (Devanagari) blocks — strip these only; keep all physics/math Unicode. */
const HINDI_BLOCK = /[\u0900-\u097F]+/g;
const HAS_HINDI = /[\u0900-\u097F]/;
/** PDF custom-font garbage from Hindi layers — not legitimate math symbols. */
const MOJIBAKE_CHARS = /[§$©¶|~<>^&•`]/g;

function hasPhysicsOrMathNotation(text) {
  return (text.match(/[^\x20-\x7E\n\r\t]/g) || []).some(
    (ch) => !isDisallowedNonAsciiChar(ch)
  );
}

/** True only for Hindi and PDF mojibake — ε₀, μ₀, superscripts, ×, ±, · are kept. */
function isDisallowedNonAsciiChar(ch) {
  const code = ch.codePointAt(0);
  if (code >= 0x0900 && code <= 0x097f) return true;
  if ("§$©¶".includes(ch)) return true;
  return false;
}

function countDisallowedNonAscii(text) {
  return (text.match(/[^\x20-\x7E\n\r\t]/g) || []).filter(isDisallowedNonAsciiChar)
    .length;
}

/**
 * Strip Hindi and PDF mojibake; preserve ε₀, μ₀, superscripts, subscripts, and math symbols.
 */
export function englishOnlyQuestionText(text) {
  if (!text || typeof text !== "string") return "";
  let s = text.replace(HINDI_BLOCK, " ");
  s = s.replace(MOJIBAKE_CHARS, " ");
  const lines = s
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .join("\n")
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
  const weird = (cleaned.match(/[§$©¶|~<>^&•`]/g) || []).length;
  return words.length * 12 + letterRatio * 40 - weird * 8;
}

function minLetterRatio(text) {
  return hasPhysicsOrMathNotation(text) ? 0.3 : 0.45;
}

/** Accept extracted question text (English prose with optional physics notation). */
export function looksLikeAIQuestionText(text) {
  if (!text || text.length < 10) return false;
  if (HAS_HINDI.test(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const nonSpace = text.replace(/\s/g, "").length;
  if (!nonSpace || letters / nonSpace < minLetterRatio(text)) return false;
  if (countDisallowedNonAscii(text) > 0) return false;
  return (text.match(/[A-Za-z]{2,}/g) || []).length >= 2;
}

export function looksLikeEnglishQuestionText(text) {
  if (!text || text.length < 12) return false;
  if (HAS_HINDI.test(text)) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const nonSpace = text.replace(/\s/g, "").length;
  const ratioFloor = hasPhysicsOrMathNotation(text) ? 0.35 : 0.55;
  if (!nonSpace || letters / nonSpace < ratioFloor) return false;
  if (countDisallowedNonAscii(text) > 0) return false;
  const words = text.match(/[A-Za-z]{3,}/g) || [];
  if (words.length < 2 && !hasPhysicsOrMathNotation(text)) return false;
  const weird = (text.match(/[§$©¶|~<>^&•`]/g) || []).length;
  if (weird > 0) return false;
  return englishReadabilityScore(text) >= 18 || hasPhysicsOrMathNotation(text);
}

function normalizeQuestion(item, index) {
  const raw = (item.questionText ?? item.question_text ?? item.text ?? "").trim();
  const text = normalizePhysicsNotation(englishOnlyQuestionText(raw), {
    strictVerbatim: EXTRACTION_FEATURE_FLAGS.strictVerbatim,
  });
  if (!text) return null;
  const marksRaw = item.marks ?? item.mark ?? null;
  const marks =
    marksRaw === null || marksRaw === undefined || marksRaw === ""
      ? null
      : Number(marksRaw);
  const solutionRaw =
    EXTRACTION_FEATURE_FLAGS.extractSolutions
      ? item.solution ?? item.answer ?? null
      : null;
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
    hasFigure: Boolean(item.hasFigure ?? item.has_figure),
  };
}

function normalizeForDedupe(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function jaccardWordSimilarity(a, b) {
  const wordsA = new Set(normalizeForDedupe(a).split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(normalizeForDedupe(b).split(/\s+/).filter((w) => w.length > 3));
  if (!wordsA.size || !wordsB.size) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection += 1;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union ? intersection / union : 0;
}

function questionQualityScore(q) {
  const textLen = q.questionText?.length ?? 0;
  const marksBonus = q.marks != null && q.marks > 0 ? 50 : 0;
  const physicsBonus = hasPhysicsOrMathNotation(q.questionText || "") ? 10 : 0;
  return textLen + marksBonus + physicsBonus;
}

function pickBetterQuestion(a, b) {
  if (!a) return b;
  if (!b) return a;
  return questionQualityScore(a) >= questionQualityScore(b) ? a : b;
}

function dedupeQuestions(questions) {
  const setKeyFor = (q) =>
    `${q.metadata?.series ?? ""}:${q.metadata?.set ?? ""}:${q.metadata?.codeNo ?? ""}`;

  const byQuestionNo = new Map();
  for (const q of questions) {
    const key = `${setKeyFor(q)}::${q.questionNo ?? ""}`;
    byQuestionNo.set(key, pickBetterQuestion(byQuestionNo.get(key), q));
  }

  const sorted = [...byQuestionNo.values()].sort((a, b) => {
    const setA = setKeyFor(a);
    const setB = setKeyFor(b);
    if (setA !== setB) return setA.localeCompare(setB);
    return (a.questionNo ?? 99999) - (b.questionNo ?? 99999);
  });

  const out = [];
  for (const q of sorted) {
    const duplicate = out.some(
      (existing) => jaccardWordSimilarity(existing.questionText, q.questionText) >= 0.72
    );
    if (!duplicate) out.push(q);
  }

  return out.map((q) => ({
    ...q,
    questionNo: q.questionNo,
  }));
}

function gatherPaperContextFromQuestions(questions) {
  let totalQuestions = null;
  let sectionRules = [];
  let instructionsText = "";

  for (const q of questions) {
    const meta = q.metadata || {};
    const tq = Number(meta.totalQuestions ?? meta.total_questions);
    if (!totalQuestions && Number.isFinite(tq) && tq >= 1) totalQuestions = tq;
    if (!sectionRules.length && meta.sectionMarkRules?.length) {
      sectionRules = meta.sectionMarkRules;
    }
    if (!instructionsText && meta.generalInstructions?.trim()) {
      instructionsText = meta.generalInstructions.trim();
    }
  }

  return { totalQuestions, sectionRules, instructionsText };
}

function finalizeExtractedQuestions(questions) {
  const merged = mergeQuestionContinuations(questions);
  const dedupedText = merged.map((q) => ({
    ...q,
    questionText: dedupeRepeatedContentInText(q.questionText),
  }));
  const split = splitAllEmbeddedQuestions(dedupedText);

  const byNo = new Map();
  for (const q of split) {
    const no = q.questionNo;
    if (!Number.isFinite(no)) continue;
    const existing = byNo.get(no);
    byNo.set(no, existing ? mergeDuplicateQuestionEntries(existing, q) : q);
  }
  const cleaned = [...byNo.values()].sort((a, b) => (a.questionNo ?? 0) - (b.questionNo ?? 0));

  const context = gatherPaperContextFromQuestions(cleaned);
  const withMarks = applyCbseSectionMarks(cleaned, {
    sectionRules: context.sectionRules,
    instructionsText: context.instructionsText,
  });
  const expectedCount = inferExpectedQuestionCount({
    totalQuestions: context.totalQuestions,
    sectionRules: context.sectionRules,
    instructionsText: context.instructionsText,
    questions: cleaned,
  });
  return validateCbseQuestionSet(withMarks, {
    expectedQuestionCount: expectedCount,
    totalQuestions: context.totalQuestions,
    sectionRules: context.sectionRules,
    instructionsText: context.instructionsText,
  });
}

function stampExtractOrder(questions, startOrder) {
  let order = startOrder;
  return questions.map((q) => {
    const stamped = { ...q, _extractOrder: order };
    order += 1;
    return stamped;
  });
}

function buildAlreadyExtractedHint(existingQuestions, paperContext = {}) {
  if (!existingQuestions?.length) return "";
  const nums = [
    ...new Set(
      existingQuestions
        .map((q) => q.questionNo)
        .filter((n) => Number.isFinite(n) && n >= 1)
    ),
  ].sort((a, b) => a - b);
  if (!nums.length) return "";

  const expected =
    paperContext.totalQuestions ??
    inferExpectedQuestionCount({
      totalQuestions: paperContext.totalQuestions,
      sectionRules: paperContext.sectionMarkRules ?? [],
      instructionsText: paperContext.generalInstructions ?? "",
    });

  const totalNote = expected
    ? ` This paper has ${expected} questions (Q1–Q${expected}); never invent Q${expected + 1}+.`
    : " Preserve printed question numbers; do not invent or duplicate.";

  const continuationHint = buildContinuationHint(existingQuestions);
  if (continuationHint) return continuationHint;

  return `\nAlready extracted from earlier pages: Q${nums.join(", Q")}. Extract ONLY new MAIN question numbers (bold left margin) visible on THIS page — do not duplicate.${totalNote}`;
}

function mergePaperContextFromParsed(target, parsed) {
  const papers = parsed?.papers?.length ? parsed.papers : parsed ? [parsed] : [];
  for (const paper of papers) {
    const tq = Number(paper.totalQuestions ?? paper.total_questions);
    if (Number.isFinite(tq) && tq >= 1) target.totalQuestions = tq;
    const rules = paper.sectionMarkRules ?? paper.section_mark_rules;
    if (rules?.length) target.sectionMarkRules = rules;
    const instr = paper.generalInstructions ?? paper.general_instructions;
    if (instr?.trim()) target.generalInstructions = instr.trim();
  }
  const rootTq = Number(parsed?.totalQuestions ?? parsed?.total_questions);
  if (Number.isFinite(rootTq) && rootTq >= 1) target.totalQuestions = rootTq;
  const rootInstr = parsed?.generalInstructions ?? parsed?.general_instructions;
  if (rootInstr?.trim()) target.generalInstructions = rootInstr.trim();
}

function mergePaperContextFromQuestions(target, questions) {
  const ctx = gatherPaperContextFromQuestions(questions);
  if (ctx.totalQuestions) target.totalQuestions = ctx.totalQuestions;
  if (ctx.sectionRules.length) target.sectionMarkRules = ctx.sectionRules;
  if (ctx.instructionsText) target.generalInstructions = ctx.instructionsText;
}

function flattenParsedAIResponse(parsed) {
  const accept = (q) => q && looksLikeAIQuestionText(q.questionText);

  const finishPaperQuestions = (questions, paper) => {
    const sectionRules =
      paper?.sectionMarkRules ?? paper?.section_mark_rules ?? parsed.sectionMarkRules ?? [];
    const instructions =
      paper?.generalInstructions ??
      paper?.general_instructions ??
      parsed.generalInstructions ??
      "";
    const totalQuestionsRaw =
      paper?.totalQuestions ??
      paper?.total_questions ??
      parsed.totalQuestions ??
      parsed.total_questions;
    const totalQuestions = Number(totalQuestionsRaw);
    const paperMeta = {
      set: paper?.set ?? null,
      codeNo: paper?.codeNo ?? paper?.code_no ?? null,
      series: paper?.series ?? null,
      totalQuestions: Number.isFinite(totalQuestions) && totalQuestions >= 1 ? totalQuestions : null,
      sectionMarkRules: sectionRules,
      generalInstructions: instructions,
    };
    const withMarks = applyCbseSectionMarks(questions, {
      sectionRules,
      instructionsText: instructions,
    });
    return withMarks.map((q) => ({
      ...q,
      metadata: {
        ...paperMeta,
        ...(q.metadata || {}),
        hasFigure: q.hasFigure ?? q.metadata?.hasFigure,
      },
    }));
  };

  if (Array.isArray(parsed)) {
    const questions = parsed
      .map((item, index) => normalizeQuestion(item, index))
      .filter(Boolean)
      .filter(accept);
    return finishPaperQuestions(questions, null);
  }

  if (parsed.papers?.length) {
    const out = [];
    for (const paper of parsed.papers) {
      const paperQuestions = [];
      for (const q of paper.questions || []) {
        const normalized = normalizeQuestion(q, paperQuestions.length);
        if (!accept(normalized)) continue;
        paperQuestions.push(normalized);
      }
      const finished = finishPaperQuestions(paperQuestions, paper);
      applyContinuationsToQuestions(finished, paper.continuations || []);
      out.push(...finished);
    }
    applyContinuationsToQuestions(out, collectContinuationsFromParsed(parsed));
    return out;
  }

  const list = parsed.questions || [];
  const questions = list
    .map((item, index) => normalizeQuestion(item, index))
    .filter(Boolean)
    .filter(accept);
  const finished = finishPaperQuestions(questions, null);
  applyContinuationsToQuestions(finished, collectContinuationsFromParsed(parsed));
  return finished;
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
  if (EXTRACTION_FEATURE_FLAGS.extractSolutions && solutionMatch) {
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

/** Plain text from PDF items — no cleanup (OpenAI handles Hindi/garbage). */
async function pdfBlobToRawTextUnfiltered(blob) {
  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const parts = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (pageText) parts.push(pageText);
  }

  return parts.join(PAGE_BREAK);
}

/** Plain text from PDF items (fallback when column layout yields no English). */
async function pdfBlobToRawText(blob) {
  return englishOnlyQuestionText(await pdfBlobToRawTextUnfiltered(blob));
}

async function pdfBlobToPageImages(blob) {
  const buffer = await blob.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const dataUrls = [];
  const limit = Math.min(pdf.numPages, VISION_MAX_PAGES);

  for (let pageNum = 1; pageNum <= limit; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: VISION_RENDER_SCALE });
    let outWidth = Math.floor(viewport.width);
    let outHeight = Math.floor(viewport.height);
    if (outWidth > VISION_MAX_IMAGE_WIDTH) {
      const ratio = VISION_MAX_IMAGE_WIDTH / outWidth;
      outWidth = VISION_MAX_IMAGE_WIDTH;
      outHeight = Math.floor(outHeight * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const renderViewport =
      outWidth === Math.floor(viewport.width)
        ? viewport
        : page.getViewport({ scale: VISION_RENDER_SCALE * (outWidth / viewport.width) });
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    dataUrls.push(canvas.toDataURL("image/jpeg", 0.82));
  }

  return { dataUrls, pageCount: pdf.numPages };
}

async function pdfBlobToText(blob) {
  const pages = await pdfBlobToStructuredPages(blob);
  const structuredText = pages.map((page) => structuredLinesToText(page)).join(PAGE_BREAK);
  if (countEnglishLetters(structuredText) >= MIN_ENGLISH_LETTERS) {
    return structuredText;
  }
  const rawText = await pdfBlobToRawText(blob);
  if (countEnglishLetters(rawText) > countEnglishLetters(structuredText)) {
    return rawText;
  }
  return structuredText || rawText;
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
      if (EXTRACTION_FEATURE_FLAGS.extractSolutions && solutionMatch) {
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

async function extractWithOpenAISingle(text, fileName, { existingQuestions = [], paperContext = {} } = {}) {
  if (!isOpenAIConfigured) return [];

  const trimmed = text.slice(0, AI_CHUNK_SIZE);
  const offsetHint = buildAlreadyExtractedHint(existingQuestions, paperContext);
  const response = await openaiChatCompletion({
    model: OPENAI_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: buildExtractionMessages(trimmed + offsetHint, fileName),
  });

  const payload = await response.json();
  const raw = payload?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  mergePaperContextFromParsed(paperContext, parsed);
  const list = flattenParsedAIResponse(parsed);
  return list;
}

async function extractWithOpenAI(text, fileName) {
  if (!isOpenAIConfigured) return { questions: [], validation: null };

  const chunks = text.includes(PAGE_BREAK)
    ? text.split(PAGE_BREAK).map((s) => s.trim()).filter(Boolean)
    : chunkText(text);

  const all = [];
  const paperContext = {
    totalQuestions: null,
    sectionMarkRules: [],
    generalInstructions: "",
  };
  for (let i = 0; i < chunks.length; i += 1) {
    const batch = await extractWithOpenAISingle(
      chunks[i],
      `${fileName} (pages ${i + 1}/${chunks.length})`,
      { existingQuestions: all, paperContext }
    );
    mergePaperContextFromQuestions(paperContext, batch);
    all.push(...batch);
  }
  return finalizeExtractedQuestions(all);
}

function visionModelForExtraction() {
  if (OPENAI_MODEL.startsWith("gpt-4")) return OPENAI_MODEL;
  return "gpt-4o";
}

/** Read scanned or image-only PDF pages via OpenAI vision. */
async function extractWithOpenAIVision(blob, fileName) {
  if (!isOpenAIConfigured) return { questions: [], pagesRendered: 0, batches: 0 };

  const { dataUrls: images, pageCount } = await pdfBlobToPageImages(blob);
  if (!images.length) {
    console.warn("[questionExtraction] Vision: PDF rendered 0 page images.", { pageCount });
    return { questions: [], pagesRendered: 0, batches: 0 };
  }

  console.info(
    `[questionExtraction] Vision: rendering ${images.length}/${pageCount} pages for "${fileName}".`
  );

  const model = visionModelForExtraction();
  const all = [];
  const paperContext = {
    totalQuestions: null,
    sectionMarkRules: [],
    generalInstructions: "",
  };
  let batches = 0;
  let extractOrder = 0;

  for (let i = 0; i < images.length; i += VISION_PAGE_BATCH) {
    batches += 1;
    const contextPage = i > 0 ? i : null;
    const pageImages = contextPage != null ? [images[i - 1], images[i]] : [images[i]];
    const pageStart = i + 1;
    const pageEnd = i + 1;
    const offsetHint = buildAlreadyExtractedHint(all, paperContext);

    const response = await openaiChatCompletion(
      {
        model,
        temperature: 0,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildVisionExtractionUserText(
                  fileName,
                  pageStart,
                  pageEnd,
                  images.length,
                  offsetHint,
                  paperContext,
                  { contextPage }
                ),
              },
              ...pageImages.map((url) => ({
                type: "image_url",
                image_url: { url, detail: "high" },
              })),
            ],
          },
        ],
      },
      { label: "AI vision extraction" }
    );

    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content || "{}";
    try {
      const parsed = JSON.parse(raw);
      mergePaperContextFromParsed(paperContext, parsed);
      const batchQuestions = stampExtractOrder(
        flattenParsedAIResponse(parsed),
        extractOrder
      );
      extractOrder += batchQuestions.length;
      mergePaperContextFromQuestions(paperContext, batchQuestions);
      console.info(
        `[questionExtraction] Vision batch pages ${pageStart}-${pageEnd}: ${batchQuestions.length} question(s).`
      );
      all.push(...batchQuestions);
    } catch {
      console.warn(
        "[questionExtraction] Vision batch JSON parse failed",
        pageStart,
        pageEnd,
        raw.slice(0, 200)
      );
    }
  }

  const finalized = finalizeExtractedQuestions(all);
  const repair = needsQuestionNumberRepair(finalized, finalized.questions);

  if (repair.retry.length > 0) {
    console.info("[questionExtraction] Retrying missing or merged questions:", repair.retry);
    const retryBatch = await retryMissingQuestionsVision(
      images,
      fileName,
      paperContext,
      repair.retry,
      extractOrder
    );
    if (retryBatch.length) {
      const retryNos = new Set(retryBatch.map((q) => q.questionNo));
      const filtered = all.filter((q) => !retryNos.has(q.questionNo));
      filtered.push(...retryBatch);
      const repaired = finalizeExtractedQuestions(filtered);
      return {
        questions: repaired.questions,
        validation: repaired,
        pagesRendered: images.length,
        batches,
      };
    }
  }

  return {
    questions: finalized.questions,
    validation: finalized,
    pagesRendered: images.length,
    batches,
  };
}

/** Second pass: re-read pages for missing or merged question numbers only. */
async function retryMissingQuestionsVision(
  images,
  fileName,
  paperContext,
  retryNumbers,
  startExtractOrder
) {
  if (!retryNumbers?.length || !images.length || !isOpenAIConfigured) return [];

  const model = visionModelForExtraction();
  const found = [];
  let extractOrder = startExtractOrder;
  const pending = new Set(retryNumbers);

  for (let i = 0; i < images.length && pending.size > 0; i += 1) {
    const batch = [...pending].sort((a, b) => a - b).slice(0, 8);
    let response;
    try {
      response = await openaiChatCompletion(
        {
          model,
          temperature: 0,
          max_tokens: 4096,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: buildMissingQuestionsRetryPrompt(
                    fileName,
                    i + 1,
                    images.length,
                    batch,
                    paperContext
                  ),
                },
                {
                  type: "image_url",
                  image_url: { url: images[i], detail: "high" },
                },
              ],
            },
          ],
        },
        { label: "AI vision retry" }
      );
    } catch {
      continue;
    }

    try {
      const payload = await response.json();
      const raw = payload?.choices?.[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw);
      mergePaperContextFromParsed(paperContext, parsed);
      const batchQuestions = stampExtractOrder(
        flattenParsedAIResponse(parsed),
        extractOrder
      );
      extractOrder += batchQuestions.length;
      for (const q of batchQuestions) {
        if (pending.has(q.questionNo)) {
          found.push(q);
          pending.delete(q.questionNo);
          console.info(`[questionExtraction] Retry found Q${q.questionNo} on page ${i + 1}.`);
        }
      }
    } catch {
      // skip failed page
    }
  }

  return found;
}

function formatExtractionFailureReason({
  englishLetters,
  aiError,
  aiConfigured,
  visionAttempted,
  visionPagesRendered,
  visionBatches,
}) {
  if (!aiConfigured) {
    return "Set VITE_OPENAI_API_KEY in .env.local and restart npm run dev.";
  }
  if (aiError) {
    return aiError;
  }
  if (visionAttempted && visionPagesRendered === 0) {
    return "Could not render this PDF to images for vision extraction. Re-upload the file or try a standard PDF export.";
  }
  if (visionAttempted) {
    return `Vision read ${visionPagesRendered} page(s) in ${visionBatches} batch(es) but found no valid questions. Open the browser console (F12) for details, or re-upload a clearer scan.`;
  }
  if (englishLetters < MIN_ENGLISH_LETTERS_FOR_AI) {
    return "This PDF has no selectable text (scanned image). Vision extraction did not run — refresh the page and try again.";
  }
  return "OpenAI ran but returned no valid English questions. Check the browser console (F12).";
}

async function blobLooksLikePdf(blob, mimeType, name = "") {
  const mime = mimeType || blob?.type || "";
  const lowerName = (name || "").toLowerCase();
  if (mime === "application/pdf" || lowerName.endsWith(".pdf")) return true;
  if (!blob?.slice) return false;
  try {
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    return (
      head[0] === 0x25 &&
      head[1] === 0x50 &&
      head[2] === 0x44 &&
      head[3] === 0x46
    );
  } catch {
    return false;
  }
}

function isPdfBlob(blob, mimeType, name = "") {
  const mime = mimeType || blob?.type || "";
  const lowerName = (name || "").toLowerCase();
  return mime === "application/pdf" || lowerName.endsWith(".pdf");
}

export async function extractQuestionsFromDocument(blob, { name, mimeType } = {}) {
  if (!blob) return { questions: [], extractedBy: "none" };

  const isPdf = await blobLooksLikePdf(blob, mimeType, name);
  let structuredPages = null;
  let structuredText = "";
  let text = "";
  let textForAi = "";
  let usedRawPdfFallback = false;
  let visionAttempted = false;
  let visionPagesRendered = 0;
  let visionBatches = 0;

  if (isPdf) {
    try {
      structuredPages = await pdfBlobToStructuredPages(blob);
      structuredText = structuredPages
        .map((page) => structuredLinesToText(page))
        .join(PAGE_BREAK);
      const rawUnfiltered = await pdfBlobToRawTextUnfiltered(blob);
      textForAi = pickBestPdfText(structuredText, rawUnfiltered);
      if (textForAi === rawUnfiltered && countEnglishLetters(structuredText) < MIN_ENGLISH_LETTERS) {
        usedRawPdfFallback = true;
        console.info(
          "[questionExtraction] Using unfiltered PDF text for AI.",
          {
            structuredLetters: countEnglishLetters(structuredText),
            rawLetters: countEnglishLetters(rawUnfiltered),
          }
        );
      }
      text = englishOnlyQuestionText(textForAi || structuredText);
      if (!text.trim()) text = textForAi;
    } catch (err) {
      console.warn("[questionExtraction] PDF layout parse failed:", err);
    }
  }

  if (!textForAi.trim() && !isPdf) {
    textForAi = await documentTextFromBlob(blob, mimeType, name);
    text = englishOnlyQuestionText(textForAi) || textForAi;
  }

  const englishLetters = countEnglishLetters(stripPageBreakNoise(textForAi));

  if (!isPdf && !textForAi.trim()) {
    return {
      questions: [],
      extractedBy: "none",
      englishLetters: 0,
      failureReason: formatExtractionFailureReason({
        englishLetters: 0,
        aiConfigured: isOpenAIConfigured,
      }),
    };
  }

  let aiError = null;

  const useTextAi =
    isOpenAIConfigured &&
    textUsableForAI(textForAi) &&
    (!isPdf || shouldUseTextAiForPdf(structuredText, usedRawPdfFallback));

  if (useTextAi) {
    try {
      const textResult = await extractWithOpenAI(textForAi, name || "question-paper");
      if (textResult.questions.length) {
        return {
          questions: textResult.questions,
          extractedBy: "ai",
          englishLetters,
          validation: textResult,
        };
      }
      console.warn(
        "[questionExtraction] OpenAI text extraction returned no questions.",
        { englishLetters, usedRawPdfFallback }
      );
    } catch (err) {
      aiError = err?.message || String(err);
      console.warn("[questionExtraction] AI text extraction failed:", err);
    }
  } else if (isOpenAIConfigured && isPdf) {
    console.info(
      "[questionExtraction] Skipping text AI for scanned PDF — using vision.",
      {
        englishLetters,
        usedRawPdfFallback,
        structuredLetters: countEnglishLetters(stripPageBreakNoise(structuredText)),
      }
    );
  }

  if (isOpenAIConfigured && isPdf) {
    try {
      visionAttempted = true;
      const visionResult = await extractWithOpenAIVision(blob, name || "question-paper");
      visionPagesRendered = visionResult.pagesRendered;
      visionBatches = visionResult.batches;
      if (visionResult.questions.length) {
        return {
          questions: visionResult.questions,
          extractedBy: "ai",
          englishLetters,
          validation: visionResult.validation,
        };
      }
      console.warn("[questionExtraction] Vision extraction returned no questions.", {
        visionPagesRendered,
        visionBatches,
      });
    } catch (err) {
      aiError = aiError || err?.message || String(err);
      console.warn("[questionExtraction] AI vision extraction failed:", err);
    }
  }

  if (structuredPages?.length && !usedRawPdfFallback) {
    const layoutQuestions = extractQuestionsFromStructuredPages(structuredPages);
    if (layoutQuestions.length) {
      const layoutResult = finalizeExtractedQuestions(layoutQuestions);
      return {
        questions: layoutResult.questions,
        extractedBy: "heuristic",
        englishLetters,
        validation: layoutResult,
      };
    }
  }

  const heuristicSource = text || textForAi;
  const heuristicResult = finalizeExtractedQuestions(
    extractWithHeuristics(heuristicSource).filter((q) =>
      looksLikeEnglishQuestionText(q.questionText)
    )
  );
  if (heuristicResult.questions.length) {
    return {
      questions: heuristicResult.questions,
      extractedBy: "heuristic",
      englishLetters,
      validation: heuristicResult,
    };
  }

  return {
    questions: [],
    extractedBy: "none",
    englishLetters,
    failureReason: formatExtractionFailureReason({
      englishLetters,
      aiError,
      aiConfigured: isOpenAIConfigured,
      visionAttempted,
      visionPagesRendered,
      visionBatches,
    }),
  };
}

export function extractionQualityStats(questions) {
  if (!questions?.length) {
    return { total: 0, withMarks: 0, marksRate: 0, englishRate: 0 };
  }
  const withMarks = questions.filter(
    (q) => q.marks != null && Number(q.marks) > 0
  ).length;
  const englishOk = questions.filter((q) =>
    looksLikeAIQuestionText(q.questionText)
  ).length;
  return {
    total: questions.length,
    withMarks,
    marksRate: withMarks / questions.length,
    englishRate: englishOk / questions.length,
  };
}

export function formatExtractionQualityMessage(stats) {
  if (!stats?.total) return "";
  const marksPct = Math.round(stats.marksRate * 100);
  const englishPct = Math.round(stats.englishRate * 100);
  return ` Marks on ${marksPct}% of rows; English-readable ${englishPct}%.`;
}

export function formatExtractionValidationMessage(validation) {
  if (!validation) return "";
  const warn = extractionCountWarning(validation);
  return warn ? ` ${warn}` : "";
}

export function assignQuestionIds(questions, extractedBy = "manual") {
  return questions.map((q, index) => ({
    id: q.id || crypto.randomUUID(),
    questionNo: q.questionNo ?? index + 1,
    questionText: dedupeRepeatedContentInText(
      normalizePhysicsNotation(englishOnlyQuestionText(q.questionText || ""), {
        strictVerbatim: EXTRACTION_FEATURE_FLAGS.strictVerbatim,
      })
    ),
    marks: q.marks ?? null,
    solution: q.solution ? englishOnlyQuestionText(q.solution) : null,
    difficultyLevel: q.difficultyLevel ?? q.difficulty_level ?? "not Rated",
    topic: q.topic ?? null,
    chapterId: q.chapterId ?? null,
    unitId: q.unitId ?? null,
    chapterName: q.chapterName ?? null,
    chapterConfidence: q.chapterConfidence ?? null,
    metadata: q.metadata ?? {},
    extractedBy,
  }));
}
