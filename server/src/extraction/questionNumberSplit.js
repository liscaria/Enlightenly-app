/**
 * Split merged extractions using bold margin question numbers (16., 17., …).
 */

const EMBEDDED_MARGIN_NUMBER =
  /\n(\d{1,2})\.\s+(?=Assertion\s*\(|Reason\s*\(|[A-Z"(])/;

/** Line starts a new main question (bold margin number), not a sub-part. */
export function lineStartsMainQuestionNumber(line) {
  const t = (line || "").trim();
  if (!t) return false;
  const m = t.match(/^(\d{1,2})\.\s+(.*)$/);
  if (!m) return false;
  const no = Number(m[1]);
  if (!Number.isFinite(no) || no < 1 || no > 40) return false;
  const rest = m[2] || "";
  if (/^\([a-d]\)/i.test(rest) || /^\([ivx]+\)/i.test(rest)) return false;
  return true;
}

function parseMainNumberFromLine(line) {
  const m = (line || "").trim().match(/^(\d{1,2})\.\s+/);
  return m ? Number(m[1]) : null;
}

function stripLeadingNumber(text) {
  return (text || "").trim().replace(/^\d{1,2}\.\s+/, "");
}

/**
 * One DB row may contain Q21 + Q22 + … when vision merged a page.
 * Split on embedded margin numbers like "\n22. Derive..."
 */
export function splitQuestionByEmbeddedNumbers(question) {
  const text = (question?.questionText || "").trim();
  if (!text) return [question];

  const assignedNo = Number(question.questionNo);
  const splits = [];
  let match;
  const regex = new RegExp(EMBEDDED_MARGIN_NUMBER.source, "g");
  while ((match = regex.exec(text)) !== null) {
    splits.push({ index: match.index, number: Number(match[1]) });
  }

  if (!splits.length) return [question];

  const parts = [];
  const head = text.slice(0, splits[0].index).trim();
  if (head) {
    parts.push({
      ...question,
      questionNo: assignedNo,
      questionText: stripLeadingNumber(head) || head,
    });
  }

  for (let i = 0; i < splits.length; i += 1) {
    const start = splits[i].index + 1;
    const end = i + 1 < splits.length ? splits[i + 1].index : text.length;
    const chunk = text.slice(start, end).trim();
    const no = parseMainNumberFromLine(chunk.split("\n")[0]) ?? splits[i].number;
    parts.push({
      ...question,
      id: undefined,
      questionNo: no,
      questionText: stripLeadingNumber(chunk),
    });
  }

  return parts.filter((p) => (p.questionText || "").trim().length > 8);
}

/** Section B/C rows over this length likely contain multiple merged questions. */
const BLOATED_THRESHOLD = 850;

/**
 * When a single row is very long and contains multiple (a) stems before OR,
 * try splitting on embedded margin numbers or repeated section stems.
 */
export function splitBloatedMergedQuestion(question) {
  const text = (question?.questionText || "").trim();
  const no = Number(question.questionNo);
  if (!text || text.length < BLOATED_THRESHOLD) return [question];
  if (no < 17 || no > 28) return [question];

  const embedded = splitQuestionByEmbeddedNumbers(question);
  if (embedded.length > 1) return embedded;

  const lines = text.split("\n");
  const stemIndices = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lineStartsMainQuestionNumber(lines[i])) {
      stemIndices.push(i);
    }
  }
  if (stemIndices.length > 1) {
    const parts = [];
    for (let s = 0; s < stemIndices.length; s += 1) {
      const chunkLines = lines.slice(
        stemIndices[s],
        s + 1 < stemIndices.length ? stemIndices[s + 1] : lines.length
      );
      const chunk = chunkLines.join("\n").trim();
      const chunkNo = parseMainNumberFromLine(chunkLines[0]) ?? no + s;
      parts.push({
        ...question,
        id: undefined,
        questionNo: chunkNo,
        questionText: stripLeadingNumber(chunk),
      });
    }
    if (parts.length > 1) return parts.filter((p) => p.questionText.length > 8);
  }

  return [question];
}

export function splitAllEmbeddedQuestions(questions) {
  const out = [];
  for (const q of questions || []) {
    const bloated = splitBloatedMergedQuestion(q);
    for (const part of bloated) {
      out.push(...splitQuestionByEmbeddedNumbers(part));
    }
  }
  return out;
}

/** Gaps in 1..expected (e.g. missing Q16 shifts later numbers). */
export function findQuestionNumberGaps(questions, expectedCount) {
  if (!expectedCount || !questions?.length) return [];
  const present = new Set(
    questions.map((q) => Number(q.questionNo)).filter((n) => Number.isFinite(n) && n >= 1)
  );
  const missing = [];
  for (let i = 1; i <= expectedCount; i += 1) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/** Question numbers that appear more than once (merge / re-read errors). */
export function findDuplicateQuestionNumbers(questions) {
  const counts = new Map();
  for (const q of questions || []) {
    const no = Number(q.questionNo);
    if (!Number.isFinite(no)) continue;
    counts.set(no, (counts.get(no) || 0) + 1);
  }
  return [...counts.entries()].filter(([, c]) => c > 1).map(([no]) => no);
}

/** Rows that are unusually long for their section — likely merged. */
export function findLikelyMergedQuestionNumbers(questions) {
  const merged = [];
  for (const q of questions || []) {
    const no = Number(q.questionNo);
    const len = (q.questionText || "").length;
    if (!Number.isFinite(no)) continue;
    if (no >= 17 && no <= 28 && len >= BLOATED_THRESHOLD) merged.push(no);
    if (EMBEDDED_MARGIN_NUMBER.test(q.questionText || "")) merged.push(no);
  }
  return [...new Set(merged)];
}

export function needsQuestionNumberRepair(validation, questions) {
  const missing = validation?.missing?.length
    ? validation.missing
    : findQuestionNumberGaps(questions, validation?.expectedCount);
  const dupes = findDuplicateQuestionNumbers(questions);
  const bloated = findLikelyMergedQuestionNumbers(questions);
  const retry = [...new Set([...missing, ...dupes, ...bloated])].sort((a, b) => a - b);
  return { missing, dupes, bloated, retry };
}
