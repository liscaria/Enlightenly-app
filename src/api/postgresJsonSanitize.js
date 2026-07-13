/**
 * PostgreSQL json/jsonb rejects `\u` not followed by exactly 4 hex digits.
 * LaTeX commands like \upsilon, \underline, \unit break jsonb if not escaped.
 */

/** Fix `\u` that is not a valid JSON \\uXXXX escape (e.g. LaTeX \\upsilon). */
export function sanitizeJsonStringForPostgres(text) {
  if (text == null || typeof text !== "string") return text;
  return text
    .replace(/\0/g, "")
    .replace(/\\u(?![0-9a-fA-F]{4})/gi, "\\\\u");
}

export function sanitizeForJsonbValue(value) {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeJsonStringForPostgres(value);
  if (Array.isArray(value)) return value.map(sanitizeForJsonbValue);
  if (typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      out[key] = sanitizeForJsonbValue(val);
    }
    return out;
  }
  return value;
}

function normalizeSectionRules(rules) {
  if (!Array.isArray(rules)) return null;
  const normalized = rules
    .map((r) => ({
      section: r.section ?? r.sectionId ?? null,
      from: Number(r.from ?? r.questionFrom ?? r.question_from ?? r.start),
      to: Number(r.to ?? r.questionTo ?? r.question_to ?? r.end),
      marks: Number(r.marks ?? r.mark),
    }))
    .filter(
      (r) =>
        Number.isFinite(r.from) &&
        Number.isFinite(r.to) &&
        Number.isFinite(r.marks) &&
        r.from <= r.to
    );
  return normalized.length ? normalized : null;
}

/** Compact metadata for question_bank — only keep Postgres-safe, small fields. */
export function metadataForQuestionBank(meta = {}) {
  const safe = sanitizeForJsonbValue(meta);
  if (!safe || typeof safe !== "object" || Array.isArray(safe)) {
    return { totalQuestions: null };
  }

  const out = { totalQuestions: null };
  const tq = Number(safe.totalQuestions ?? safe.total_questions);
  if (Number.isFinite(tq) && tq >= 1) out.totalQuestions = tq;

  const sectionRules = normalizeSectionRules(
    safe.sectionMarkRules ?? safe.section_mark_rules
  );
  if (sectionRules) out.sectionMarkRules = sectionRules;

  for (const key of ["set", "series", "marksInferred", "marksSource", "hasFigure"]) {
    const val = safe[key];
    if (val != null && val !== "") out[key] = val;
  }

  const codeNo = safe.codeNo ?? safe.code_no;
  if (codeNo != null && codeNo !== "") out.codeNo = String(codeNo);

  try {
    JSON.parse(JSON.stringify(out));
    return out;
  } catch {
    return { totalQuestions: out.totalQuestions };
  }
}

export function sanitizeQuestionBankText(text) {
  return sanitizeJsonStringForPostgres(text ?? "");
}
