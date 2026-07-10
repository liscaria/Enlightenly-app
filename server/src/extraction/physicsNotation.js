/** Normalize common OCR / plain-text physics notation for storage and display. */

/** Convert legacy/broken vector forms to \\vec{E} (rendered with arrow above in UI). */
function normalizeVectorNotation(text) {
  return text
    .replace(/\b([A-Za-z])\u20D7/g, "\\vec{$1}")
    .replace(/\b([A-Za-z])\uFE00?\u20D7/g, "\\vec{$1}")
    .replace(/\b([A-Za-z])\s*→(?=\s*=)/g, "\\vec{$1}")
    .replace(/\b([A-Za-z])→(?=\s*=)/g, "\\vec{$1}")
    .replace(/\b([A-Za-z])\s+→(?=\s)/g, "\\vec{$1} ")
    .replace(/\belectric field\s+([A-Za-z])\s*→/gi, "electric field \\vec{$1}");
}

/** î, ĵ, k̂ → \\hat{i} etc. for consistent rendering. */
function normalizeUnitVectors(text) {
  return text
    .replace(/î/g, "\\hat{i}")
    .replace(/ĵ/g, "\\hat{j}")
    .replace(/k̂/g, "\\hat{k}")
    .replace(/\b(i|j|k)\s*(?:hat|\^|\u0302)/gi, (_, axis) => `\\hat{${axis.toLowerCase()}}`);
}

/** E0 → E₀; keep μ, λ, π. */
function normalizeSubscripts(text) {
  return text.replace(/([A-Za-zμελρσπ])0(?=[\s=^²³⁰⁻⁺₀₁₂₃₄₅₆₇₈₉]|$)/g, "$1₀");
}

/** Fix common vision misreads of stacked fractions as subtraction. */
function normalizeFractionMisreads(text) {
  let s = text;
  s = s.replace(/\(A\)\s*R\s*[-–—]\s*1\/μ/gi, "(A) \\frac{R}{μ−1}");
  s = s.replace(/\(B\)\s*R\s*[-–—]\s*-?\s*1\/μ/gi, "(B) \\frac{−R}{μ−1}");
  s = s.replace(/\(C\)\s*2R\s*[-–—]\s*1\/μ/gi, "(C) \\frac{2R}{μ−1}");
  s = s.replace(/\(D\)\s*2R\s*[-–—]\s*-?\s*1\/μ/gi, "(D) \\frac{−2R}{μ−1}");
  s = s.replace(/2nπ\s*\+\s*4π/g, "2nπ + \\frac{π}{4}");
  s = s.replace(/2nπ\s*\+\s*2π(?!\s*\/)/g, "2nπ + \\frac{π}{2}");
  return s;
}

/** R/(μ-1) plain form → \\frac{R}{μ−1} when not already LaTeX. */
function normalizePlainFractions(text) {
  return text.replace(
    /(?<!\\frac\{)([−-]?[0-9]?R)\/\((μ[−-]1)\)/g,
    (_, num, den) => `\\frac{${num}}{${den.replace("-", "−")}}`
  );
}

/** Normalize notation for storage/display. Does NOT change English wording when strictVerbatim is true. */
export function normalizePhysicsNotation(text, { strictVerbatim = true } = {}) {
  if (!text || typeof text !== "string") return text;
  let s = text.replace(/\r\n/g, "\n");
  s = normalizeVectorNotation(s);
  s = normalizeSubscripts(s);
  s = normalizeUnitVectors(s);
  if (!strictVerbatim) {
    s = normalizeFractionMisreads(s);
  }
  s = normalizePlainFractions(s);
  return s;
}
