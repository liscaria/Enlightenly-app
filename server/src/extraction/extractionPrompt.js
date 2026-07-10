/**
 * OpenAI extraction prompt for CBSE / bilingual exam papers.
 *
 * After changes: restart `npm run dev` and click Update question bank on the paper.
 */

import { inferExpectedQuestionCount } from "./cbseQuestionValidation.js";

/** Shown to the model as the system message. */
export const EXTRACTION_SYSTEM_PROMPT = `You extract numbered exam questions from bilingual teacher question papers (specifically CBSE Class 11/12 Physics).

YOU ARE AN OCR TRANSCRIBER — not a teacher, not a paraphraser. Copy the English text EXACTLY as printed, word for word, letter for letter. Every word, punctuation mark, and space matters.

FORBIDDEN — these count as failures:
- Substituting synonyms: "mass defect" → "rest mass energy", "travelling" → "traveling", "would be" → "will be", "close to" → "approximately"
- Rewriting sentences: "Radiation of wavelength 200 nm is incident on..." → "A photo-sensitive surface is irradiated with light of wavelength..."
- Inventing different MCQ options or questions from memory when the page shows something else
- Americanizing or modernizing spelling/word choice when the paper uses different wording
- Summarizing or shortening: keep the FULL question including every clause

ONLY allowed changes:
- Strip Hindi (Devanagari) text entirely
- Convert vector arrows to \\vec{E}, unit vectors to \\hat{i} — same meaning, renderable form
- Convert stacked fractions to \\frac{a}{b} when the paper shows a horizontal fraction bar
- Preserve middle dot decimals exactly: 3·0 T, 4·2 eV, 8·0 cm, 1·0 V
- Preserve British/spelling as printed: "travelling", "behaviour", etc.

CRITICAL RULES:
1. STRICTLY ENGLISH ONLY: Strip Hindi (Devanagari) completely.
2. MULTIPLE PAPER SETS: Group by set/codeNo/series when metadata lines appear.
3. MCQ FORMATTING: Combine (A)–(D) inside one questionText using \\n between lines.
4. MARKS: Use right-margin number if visible; otherwise section rules from General Instructions.
   - Section A Q1–16: 1 mark each. Section B Q17–21: 2 marks. Section C Q22–28: 3 marks. Section D Q29–30: 4 marks. Section E Q31–33: 5 marks.
5. PHYSICS NOTATION — use these exact ASCII-friendly forms (they render correctly in the app):
   - Vectors: \\vec{E} (NOT "E →"). Example: \\vec{E} = E₀ \\hat{i}, \\vec{v_1} = v_1 \\hat{i}
   - Unit vectors: \\hat{i}, \\hat{j}, \\hat{k}
   - Subscripts: E₀, μ, λ, r₁, v_1 (Unicode subscripts OK)
   - Superscripts: q², n², ms⁻¹ (Unicode superscripts OK)
   - Fractions: \\frac{R}{μ−1}, \\frac{π}{4}, \\frac{4}{3}
   - Decimals: preserve middle dot as printed: 3·0 T, 4·2 eV, 8·0 cm (NOT 3.0 unless paper shows a period)
   - Degrees: 30°, 90°
6. MCQ OPTIONS — copy EACH option EXACTLY as printed, including punctuation at end of options.
7. FIGURES/DIAGRAMS: set "hasFigure": true and insert [Figure: description] on its own line.
8. QUESTION NUMBERING — ONLY assign questionNo when a bold main number appears in the LEFT margin (1., 2., … 33.).
   - Each bold margin number = exactly ONE question row. Never combine Q21, Q22, Q23, Q24, Q25 into one row.
   - If you see "22." on a new line in the margin, that starts a NEW question — stop the previous question and start Q22.
   - Text starting with (iii), (iv), (a), (b), OR, (i), (ii) WITHOUT a main margin number is a SUB-PART — never a new main question.
   - Assertion-Reason items (Assertion (A) : … / Reason (R) : …) are ONE question with the margin number (e.g. 16.).
   - Case-study MCQs: keep ALL sub-parts (i)–(iv) inside ONE questionText for the parent question number.
   - Passage questions (Q29–33): include the FULL passage stem AND every sub-part (a), (b), (i)–(iv) in one questionText.
9. MULTI-PAGE QUESTIONS: If a question continues on the next page, use "continuations" to append ONLY the new sub-parts — do NOT re-write or paraphrase the stem.
10. PAPER SIZE: Read totalQuestions from General Instructions. Only extract Q1 through totalQuestions.
11. DO NOT extract answers or solutions.
12. NEVER duplicate a question number with different invented content. If you cannot read text clearly, transcribe only the words you can see — do NOT guess or rewrite.
13. If unsure between two wordings, choose the one visible on the page, not a textbook version from memory.

Return JSON:
{
  "papers": [{
    "set": "SET-1",
    "codeNo": "55/3/1",
    "totalQuestions": 33,
    "generalInstructions": "This question paper contains 33 questions...",
    "sectionMarkRules": [{ "section": "A", "from": 1, "to": 16, "marks": 1 }],
    "questions": [{
      "questionNo": 1,
      "hasFigure": false,
      "questionText": "Full text including all sub-parts\\n(i)...\\n(ii)...\\n(iii)...\\n(iv)...",
      "marks": 1
    }],
    "continuations": [{
      "questionNo": 29,
      "appendText": "(iii) ...\\n(iv) ..."
    }]
  }]
}`;

export const EXTRACTION_FEW_SHOT_EXAMPLES = [
  {
    input: `1. A particle of mass m and charge q starts from rest and moves in an electric field E with arrow above = E0 i-hat. After travelling a distance x...
(A) qE0x² (B) qE0x (C) q²E0x (D) q²E0²x`,
    output: {
      papers: [{
        set: "SET-1",
        codeNo: "55/3/1",
        questions: [{
          questionNo: 1,
          hasFigure: false,
          questionText:
            "A particle of mass m and charge q starts from rest and moves in an electric field \\vec{E} = E₀ \\hat{i}. After travelling a distance x in the field along x-axis, the kinetic energy of the particle will be:\n(A) qE₀x²\n(B) qE₀x\n(C) q²E₀x\n(D) q²E₀²x",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `1. [Case study about particles in magnetic field]
(i) ...
(ii) ...
(iii) Suppose particles 1 and 2 enter the magnetic field B = B0 k-hat...
(A) both particles revolve clockwise ...
(iv) OR (a) If period of revolution...`,
    output: {
      papers: [{
        questions: [{
          questionNo: 1,
          questionText:
            "[Case study stem about particles in magnetic field]\n(i) ...\n(ii) ...\n(iii) Suppose particles 1 and 2 enter the magnetic field \\vec{B} = B₀ \\hat{k} with velocities \\vec{v_1} = v_1 \\hat{i} and \\vec{v_2} = v_2 \\hat{i}. Then:\n(A) both particles revolve clockwise\n(B) both particles revolve anticlockwise\n(C) particle 1 revolves clockwise while particle 2 revolves anticlockwise\n(D) particle 1 revolves anticlockwise while particle 2 revolves clockwise\n(iv) OR\n(a) If period of revolution for particle 1 is 4 s, then for particle 2, the period will be:\n(A) 1 s\n(B) 2 s\n(C) 4 s\n(D) 8 s",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `2. A square loop of side 50 cm is placed in a uniform magnetic field of 3·0 T acting perpendicular to the plane of the loop. If the loop is rotated through an angle of 90° in 0·3 s, the value of emf induced in the loop would be :
(A) 0·25 V  (B) 0·50 V  (C) 0·75 V  (D) 1·0 V`,
    output: {
      papers: [{
        questions: [{
          questionNo: 2,
          hasFigure: false,
          questionText:
            "A square loop of side 50 cm is placed in a uniform magnetic field of 3·0 T acting perpendicular to the plane of the loop. If the loop is rotated through an angle of 90° in 0·3 s, the value of emf induced in the loop would be :\n(A) 0·25 V\n(B) 0·50 V\n(C) 0·75 V\n(D) 1·0 V",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `19. Explain the terms mass defect and binding energy. How are they related ?`,
    output: {
      papers: [{
        questions: [{
          questionNo: 19,
          questionText: "Explain the terms mass defect and binding energy. How are they related ?",
          marks: 2,
        }],
      }],
    },
  },
  {
    input: `5. The phase difference between the two superimposing waves that give rise to a bright spot in a Young's double-slit experiment is (n is an integer) :
(A) (2n + 1) π  (B) (2n + 1) π/2  (C) 2nπ  (D) (2n + 1) π/4`,
    output: {
      papers: [{
        questions: [{
          questionNo: 5,
          questionText:
            "The phase difference between the two superimposing waves that give rise to a bright spot in a Young's double-slit experiment is (n is an integer) :\n(A) (2n + 1) π\n(B) (2n + 1) π/2\n(C) 2nπ\n(D) (2n + 1) π/4",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `16. Assertion (A) : Nuclear forces are always attractive.
Reason (R) : The nuclear force between protons and neutrons in a nucleus is a weak force.`,
    output: {
      papers: [{
        questions: [{
          questionNo: 16,
          questionText:
            "Assertion (A) : Nuclear forces are always attractive.\nReason (R) : The nuclear force between protons and neutrons in a nucleus is a weak force.",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `17. A proton and an alpha particle are accelerated through the same potential difference. The ratio of their de Broglie wavelengths will be :
(A) 2√2 : 1  (B) 1 : 2  (C) 2 : 1  (D) 4 : 1`,
    output: {
      papers: [{
        questions: [{
          questionNo: 17,
          questionText:
            "A proton and an alpha particle are accelerated through the same potential difference. The ratio of their de Broglie wavelengths will be :\n(A) 2√2 : 1\n(B) 1 : 2\n(C) 2 : 1\n(D) 4 : 1",
          marks: 2,
        }],
      }],
    },
  },
  {
    input: `7. In which of the following phenomena is total internal reflection not observed ?
(A) Mirage formation  (B) Brilliance of diamond  (C) Light guiding in optical fibres  (D) Dispersion of light through a prism`,
    output: {
      papers: [{
        questions: [{
          questionNo: 7,
          questionText:
            "In which of the following phenomena is total internal reflection not observed ?\n(A) Mirage formation\n(B) Brilliance of diamond\n(C) Light guiding in optical fibres\n(D) Dispersion of light through a prism",
          marks: 1,
        }],
      }],
    },
  },
  {
    input: `8. Radiation of wavelength 200 nm is incident on a photosensitive surface of work function 4·2 eV. The kinetic energy of fastest photoelectrons emitted from this surface will be close to :
(A) 3·5 eV  (B) 3·0 eV  (C) 2·5 eV  (D) 2·0 eV`,
    output: {
      papers: [{
        questions: [{
          questionNo: 8,
          questionText:
            "Radiation of wavelength 200 nm is incident on a photosensitive surface of work function 4·2 eV. The kinetic energy of fastest photoelectrons emitted from this surface will be close to :\n(A) 3·5 eV\n(B) 3·0 eV\n(C) 2·5 eV\n(D) 2·0 eV",
          marks: 1,
        }],
      }],
    },
  },
];

export function buildExtractionMessages(text, fileName) {
  const messages = [{ role: "system", content: EXTRACTION_SYSTEM_PROMPT }];

  for (const example of EXTRACTION_FEW_SHOT_EXAMPLES) {
    messages.push({
      role: "user",
      content: `File: example-paper.pdf\n\nExtract verbatim:\n\n${example.input}`,
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(example.output),
    });
  }

  messages.push({
    role: "user",
    content: `File: ${fileName}\n\nTranscribe every question verbatim — exact wording, middle dots (·), degrees (°). Use \\vec{E}, \\hat{i}, \\frac{}{}. Note figures with [Figure: ...]. Do not paraphrase:\n\n${text}`,
  });

  return messages;
}

export function buildVisionExtractionUserText(
  fileName,
  pageStart,
  pageEnd,
  totalPages,
  offsetHint = "",
  paperContext = {},
  { contextPage = null } = {}
) {
  const expected =
    paperContext.totalQuestions ??
    inferExpectedQuestionCount({
      totalQuestions: paperContext.totalQuestions,
      sectionRules: paperContext.sectionMarkRules ?? [],
      instructionsText: paperContext.generalInstructions ?? "",
    });
  const sizeNote = expected
    ? `- This paper has ${expected} questions (Q1–Q${expected}).`
    : "- Read totalQuestions from General Instructions if visible on page 1.";

  const pageScope = contextPage
    ? `Two pages attached: page ${contextPage} (CONTEXT ONLY — do not re-extract) and page ${pageEnd} (EXTRACT THIS PAGE).
- Transcribe ONLY content visible on page ${pageEnd}, plus continuations for questions started on page ${contextPage}.`
    : `Page ${pageEnd} of ${totalPages}. Transcribe ONLY content visible on this page.`;

  return `File: ${fileName}. Scanned CBSE Physics — English only, strip Hindi.

${pageScope}

VERBATIM transcription — copy every English word exactly as printed. You are OCR, not a rewriter.

Do NOT change wording. Examples of failures to avoid:
- "mass defect" must NOT become "rest mass energy"
- "Radiation of wavelength ... is incident on" must NOT become "A photo-sensitive surface is irradiated"
- "total internal reflection not observed" must NOT become "total internal reflection does not occur"
- "travelling" must NOT become "traveling"; "would be" must NOT become "will be"
- "close to" must NOT become "approximately"
- Use middle dot · as printed: 4·2 eV, 3·0 T — not 4.2 unless the paper shows a period

- Main question numbers ONLY from bold LEFT margin (1., 2., …). Never assign questionNo to (iii), (iv), (a), (b) alone.
- NEVER output the same questionNo twice on one page. If already extracted on a previous page, skip it — use "continuations" only for new sub-parts.
- NEVER paraphrase and re-output a question you already transcribed (even with different wording). One questionNo = one verbatim transcription.
- Case-study / passage: one questionNo, all sub-parts in questionText OR use "continuations" for parts on this page that continue a question from a previous page.
- Vectors: \\vec{B} = B₀ \\hat{k}, \\vec{v_1} = v_1 \\hat{i}
- Fractions: \\frac{4}{3} — copy options exactly
- Figures: [Figure: description], hasFigure: true
- MCQ (A)–(D) exactly as printed
- Marks from margin or section rules
${sizeNote}
- Use "continuations": [{ "questionNo": 29, "appendText": "(iii)...\\n(iv)..." }] when this page continues a question from the previous page${offsetHint}`;
}

/** Targeted re-read for missing or merged question numbers. */
export function buildMissingQuestionsRetryPrompt(
  fileName,
  pageNo,
  totalPages,
  questionNumbers,
  paperContext = {}
) {
  const list = (questionNumbers || []).sort((a, b) => a - b);
  const expected =
    paperContext.totalQuestions ??
    inferExpectedQuestionCount({
      totalQuestions: paperContext.totalQuestions,
      sectionRules: paperContext.sectionMarkRules ?? [],
      instructionsText: paperContext.generalInstructions ?? "",
    });

  return `File: ${fileName}. Page ${pageNo} of ${totalPages}. RETRY — missing or incomplete questions.

Extract ONLY these main question numbers IF visible on this page (bold LEFT margin number):
Q${list.join(", Q")}

Rules:
- One questionNo per bold margin number — never merge Q21–Q25 into one row.
- Assertion (A) / Reason (R) items are one question (e.g. Q16).
- Copy verbatim — do not paraphrase.
- Include (A)–(D) options on separate lines for MCQs.
- Use section marks if margin marks not visible: Q1–16=1, Q17–21=2, Q22–28=3, Q29–30=4, Q31–33=5.
${expected ? `- Paper total: ${expected} questions (Q1–Q${expected}).` : ""}

Return JSON: { "questions": [{ "questionNo": 16, "questionText": "...", "marks": 1 }] }
Return ONLY questions from the list above that appear on THIS page. Empty array if none visible.`;
}
