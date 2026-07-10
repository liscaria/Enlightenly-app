/**
 * Merge question fragments split across pages or mis-numbered sub-parts.
 */

const ROMAN_SUBPART_START =
  /^\s*\((?:i{1,3}|iv|v|vi{0,3}|ix|x|xi{0,3})\)\s/i;
const LETTER_SUBPART_START = /^\s*\([a-d]\)\s/i;

/** Text that is a sub-part continuation, not a new main question. */
export function isContinuationFragment(questionText) {
  const t = (questionText || "").trim();
  if (!t) return false;
  if (ROMAN_SUBPART_START.test(t)) return true;
  if (LETTER_SUBPART_START.test(t) && !/^\d{1,2}[\).:\s]/.test(t)) return true;
  if (/^\s*\([a-d]\)\s/i.test(t) && t.length < 80 && !t.includes("?")) return false;
  return false;
}

/** Main question body — not a lone (iii) or (b) fragment. */
export function looksLikeMainQuestionText(questionText) {
  return !isContinuationFragment(questionText);
}

function normalizeForSimilarity(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "")
    .trim();
}

function jaccardWordSimilarity(a, b) {
  const wordsA = new Set(
    normalizeForSimilarity(a)
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  const wordsB = new Set(
    normalizeForSimilarity(b)
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
  if (!wordsA.size || !wordsB.size) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection += 1;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union ? intersection / union : 0;
}

function questionTextQuality(text, marks = null) {
  const len = (text || "").length;
  const marksBonus = marks != null && marks > 0 ? 50 : 0;
  const mcqBonus = /^\([A]\)/m.test(text || "") && /^\([D]\)/m.test(text || "") ? 30 : 0;
  const fragmentPenalty = (text || "").trim().startsWith("...") ? 40 : 0;
  return len + marksBonus + mcqBonus - fragmentPenalty;
}

function normalizeForOverlap(text) {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function textsOverlap(a, b) {
  const na = normalizeForOverlap(a);
  const nb = normalizeForOverlap(b);
  if (!na || !nb) return false;
  return na.includes(nb.slice(0, 40)) || nb.includes(na.slice(0, 40));
}

function pickBetterText(a, b, marksA = null, marksB = null) {
  if (!a?.trim()) return b?.trim() || "";
  if (!b?.trim()) return a.trim();
  if (jaccardWordSimilarity(a, b) >= 0.35 || textsOverlap(a, b)) {
    return questionTextQuality(a, marksA) >= questionTextQuality(b, marksB) ? a.trim() : b.trim();
  }
  return null;
}

export function appendQuestionText(existing, addition) {
  const base = (existing || "").trimEnd();
  const extra = (addition || "").trim();
  if (!extra) return base;
  if (!base) return extra;

  const picked = pickBetterText(base, extra);
  if (picked) return picked;

  return `${base}\n${extra}`;
}

function lineLooksLikeNewStem(line) {
  const t = line.trim();
  if (!t || /^\([A-D]\)/.test(t) || /^\([ivx]+\)/i.test(t)) return false;
  if (t.startsWith("...")) return false;
  return /^[A-Z"'(]/.test(t) && (/\?\s*$/.test(t) || /:\s*$/.test(t) || t.length > 40);
}

function blockHasCompleteMcq(lines) {
  const joined = lines.join("\n");
  return /^\([A]\)/m.test(joined) && /^\([D]\)/m.test(joined);
}

function splitQuestionTextBlocksLines(trimmed) {
  const lines = trimmed.split("\n");
  const blocks = [];
  let buf = [];

  const flush = () => {
    if (buf.length) {
      blocks.push(buf.join("\n"));
      buf = [];
    }
  };

  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const lineIsOptionA = /^\([A]\)\s/i.test(line.trim());
    const blockIsCaseStudy = /\([ivx]+\)/i.test(buf.join("\n"));
    if (
      buf.length &&
      blockHasCompleteMcq(buf) &&
      !blockIsCaseStudy &&
      (lineLooksLikeNewStem(line) || lineIsOptionA)
    ) {
      flush();
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  return blocks.length ? blocks : [trimmed];
}

function splitQuestionTextBlocks(text) {
  if (!text?.trim()) return [];

  const trimmed = text.trim();
  const ellipsisParts = trimmed.split(/\n(?=\.\.\.)/g).map((p) => p.trim()).filter(Boolean);

  if (ellipsisParts.length > 1) {
    return ellipsisParts.flatMap((part) => splitQuestionTextBlocksLines(part));
  }

  return splitQuestionTextBlocksLines(trimmed);
}

function isCompleteMcqBlock(block) {
  const t = (block || "").trim();
  if (!t || t.startsWith("...")) return false;
  if (!/^\([A]\)/m.test(t) || !/^\([D]\)/m.test(t)) return false;
  const firstLine = t.split("\n").find((l) => l.trim()) || "";
  return firstLine.length > 25;
}

function hasCaseStudySubParts(block) {
  const matches = (block || "").match(/\([ivx]+\)/gi);
  return matches && matches.length >= 2;
}

/**
 * Remove repeated stems / option sets when vision re-transcribed the same MCQ.
 * Keeps multi-part case-study questions intact.
 */
export function dedupeRepeatedContentInText(text) {
  if (!text?.trim()) return text || "";

  const blocks = splitQuestionTextBlocks(text);
  if (blocks.length <= 1) return text.trim();

  const kept = [];
  for (const block of blocks) {
    let merged = false;
    for (let i = 0; i < kept.length; i++) {
      if (jaccardWordSimilarity(kept[i], block) >= 0.42) {
        if (questionTextQuality(block) > questionTextQuality(kept[i])) {
          kept[i] = block;
        }
        merged = true;
        break;
      }
    }
    if (!merged) kept.push(block);
  }

  if (kept.length === 1) return kept[0].trim();

  const caseStudy = kept.find(hasCaseStudySubParts);
  if (caseStudy) return caseStudy.trim();

  const completeMcqs = kept.filter(isCompleteMcqBlock);
  if (completeMcqs.length > 1) {
    return completeMcqs
      .sort((a, b) => text.indexOf(a) - text.indexOf(b))[0]
      .trim();
  }

  return kept.sort((a, b) => questionTextQuality(b) - questionTextQuality(a))[0].trim();
}

/**
 * When two rows share questionNo, keep the best version — only append true sub-parts.
 */
export function mergeDuplicateQuestionEntries(a, b) {
  if (!a) return b;
  if (!b) return a;

  const sim = jaccardWordSimilarity(a.questionText, b.questionText);
  const aMain = looksLikeMainQuestionText(a.questionText);
  const bMain = looksLikeMainQuestionText(b.questionText);

  if (sim >= 0.38) {
    const winner = questionTextQuality(a.questionText, a.marks) >= questionTextQuality(b.questionText, b.marks) ? a : b;
    return {
      ...winner,
      marks: a.marks ?? b.marks,
      hasFigure: a.hasFigure || b.hasFigure,
    };
  }

  if (aMain && bMain && sim < 0.38) {
    const winner =
      questionTextQuality(a.questionText, a.marks) >= questionTextQuality(b.questionText, b.marks)
        ? a
        : b;
    return {
      ...winner,
      marks: a.marks ?? b.marks,
      hasFigure: a.hasFigure || b.hasFigure,
    };
  }

  if (aMain && !bMain) {
    return {
      ...a,
      questionText: appendQuestionText(a.questionText, b.questionText),
      marks: a.marks ?? b.marks,
      hasFigure: a.hasFigure || b.hasFigure,
    };
  }
  if (bMain && !aMain) {
    return {
      ...b,
      questionText: appendQuestionText(b.questionText, a.questionText),
      marks: b.marks ?? a.marks,
      hasFigure: a.hasFigure || b.hasFigure,
    };
  }

  const orderA = a._extractOrder ?? 0;
  const orderB = b._extractOrder ?? 0;
  const primary = orderA <= orderB ? a : b;
  const secondary = orderA <= orderB ? b : a;

  const mergedText = appendQuestionText(primary.questionText, secondary.questionText);
  return {
    ...primary,
    questionText: dedupeRepeatedContentInText(mergedText),
    marks: primary.marks ?? secondary.marks,
    hasFigure: primary.hasFigure || secondary.hasFigure,
  };
}

/**
 * Attach (iii), (b), etc. fragments to the preceding question; merge duplicate numbers.
 */
export function mergeQuestionContinuations(questions) {
  if (!questions?.length) return [];

  const sorted = [...questions].sort((a, b) => {
    const orderA = a._extractOrder ?? a.questionNo ?? 0;
    const orderB = b._extractOrder ?? b.questionNo ?? 0;
    return orderA - orderB;
  });

  const merged = [];

  for (const q of sorted) {
    if (!q?.questionText?.trim()) continue;

    if (merged.length && isContinuationFragment(q.questionText)) {
      const prev = merged[merged.length - 1];
      const qOrder = q._extractOrder ?? 0;
      const prevOrder = prev._extractOrder ?? -1;
      if (qOrder > prevOrder || q.questionNo <= prev.questionNo + 1) {
        merged[merged.length - 1] = mergeDuplicateQuestionEntries(prev, q);
        continue;
      }
    }

    const dupIdx = merged.findIndex((m) => m.questionNo === q.questionNo);
    if (dupIdx >= 0) {
      merged[dupIdx] = mergeDuplicateQuestionEntries(merged[dupIdx], q);
      continue;
    }

    merged.push({ ...q });
  }

  return merged.map((q) => ({
    ...q,
    questionText: dedupeRepeatedContentInText(q.questionText),
  }));
}

/** Questions on the last page(s) that likely continue on the next page. */
export function findLikelyIncompleteQuestions(questions) {
  if (!questions?.length) return [];

  const candidates = questions.slice(-4);
  return candidates.filter((q) => {
    const t = q.questionText || "";
    const hasEarlyParts = /\([ia]\)\s/i.test(t) || /\(i\)\s/i.test(t);
    const hasLaterParts = /\((?:iii|iv|v|vi|vii|viii|ix|x)\)\s/i.test(t);
    const hasPartA = /\(a\)\s/i.test(t);
    const hasPartB = /\(b\)\s/i.test(t);
    const endsMidPassage = t.length > 200 && !/[.?:]\s*$/.test(t.trim());

    if (hasEarlyParts && !hasLaterParts) return true;
    if (hasPartA && !hasPartB) return true;
    if (endsMidPassage && q.questionNo >= 29) return true;
    return false;
  });
}

export function applyContinuationsToQuestions(questions, continuations) {
  if (!continuations?.length) return questions || [];

  const list = [...(questions || [])];
  const byNo = new Map(list.map((q) => [q.questionNo, q]));
  for (const entry of continuations) {
    const no = Number(entry.questionNo ?? entry.question_no);
    const appendText = entry.appendText ?? entry.append_text ?? entry.questionText ?? "";
    if (!Number.isFinite(no) || !appendText?.trim()) continue;

    const existing = byNo.get(no);
    if (existing) {
      existing.questionText = dedupeRepeatedContentInText(
        appendQuestionText(existing.questionText, appendText)
      );
    } else {
      const stub = {
        questionNo: no,
        questionText: appendText.trim(),
        marks: entry.marks ?? null,
        hasFigure: Boolean(entry.hasFigure),
      };
      list.push(stub);
      byNo.set(no, stub);
    }
  }
  return list;
}

export function collectContinuationsFromParsed(parsed) {
  const out = [];
  const papers = parsed?.papers?.length ? parsed.papers : parsed ? [parsed] : [];
  for (const paper of papers) {
    for (const c of paper.continuations || []) out.push(c);
  }
  for (const c of parsed?.continuations || []) out.push(c);
  return out;
}

export function buildContinuationHint(existingQuestions) {
  const incomplete = findLikelyIncompleteQuestions(existingQuestions);
  if (!incomplete.length) return "";

  const lines = incomplete.map((q) => {
    const snippet = (q.questionText || "").trim().slice(0, 80).replace(/\n/g, " ");
    return `Q${q.questionNo} (ends: "${snippet}…")`;
  });

  return `\n\nCONTINUATION REQUIRED — these questions continue on this page. Return them in "continuations" (append only new sub-parts), do NOT re-create or paraphrase the stem:\n${lines.join("\n")}`;
}
