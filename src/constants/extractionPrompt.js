/**
 * OpenAI extraction prompt for CBSE / bilingual exam papers.
 *
 * Optimized for handling multiple sets, filtering out intermingled Hindi text,
 * and maintaining mathematical structure.
 *
 * After changes: restart `npm run dev` and click Re-extract on the paper.
 */

/** Shown to the model as the system message. */
export const EXTRACTION_SYSTEM_PROMPT = `You extract numbered exam questions from bilingual teacher question papers (specifically CBSE Class 11/12 Physics).

Your job is to cleanly isolate English content from Hindi context, structuralize multiple paper sets, and return clean JSON.

CRITICAL RULES:
1. STRICTLY ENGLISH ONLY: CBSE papers print complete Hindi (Devanagari) paragraphs right next to or above/below the English text. Strip out the Hindi blocks completely. Never output Hindi characters, Hindi phonetics, or gibberish placeholder characters resulting from font decoding errors.
2. HANDLING MULTIPLE PAPER SETS: The text stream contains multiple independent papers appended together. You must watch out for paper metadata lines (e.g., "Series HMJ/1", "SET-2", "Code No. 55/1/2"). Whenever a new metadata line is encountered, you must group the subsequent questions under a clean "set", "codeNo", and "series" entry inside the JSON wrapper.
3. LINE CONTINUATION & MCQ FORMATTING: Do not create separate JSON objects for broken line fragments. Sub-parts of questions (e.g., "(a)", "(b)") or multiple choice parameters ("(A)", "(B)", "(C)", "(D)") must be combined inside the single parent question text wrapper using explicit clean newline characters (\\n).
4. MARKS ISOLATION: Isolate the points/marks numerical value typically printed on the rightmost margin of the paper or listed directly inside brackets like "[1 marks]" or "1". Always store this as a strict number type.
5. PHYSICS NOTATION: Preserve all math and variables exactly as intended (subscripts, superscripts, equations, symbols like ε₀, μ₀, σ) by keeping them in clear inline text formatting.

Return JSON matching this schema exactly:
{
  "papers": [
    {
      "set": "SET-1",
      "codeNo": "55/4/1",
      "series": "HMJ/1",
      "questions": [
        {
          "questionNo": 1,
          "questionText": "Question statement text here...",
          "marks": 1
        }
      ]
    }
  ]
}`;

/**
 * Few-shot examples demonstrating bilingual extraction, math cleanup,
 * and multi-set processing.
 */
export const EXTRACTION_FEW_SHOT_EXAMPLES = [
  {
    input: `Series HMJ/1
SET-1
कोड नं. 55/1/1
1. यदि किसी बन्द पृष्ठ से गुज़रने वाला नेट विद्युत् फ्लक्स शून्य है...
1. If the net electric flux through a closed surface is zero, then we can infer
(A) no net charge is enclosed by the surface.
(B) uniform electric field exists within the surface. [1 marks]
2. An electric dipole consisting of charges +q and -q separated by a distance L... 1`,
    output: {
      papers: [
        {
          set: "SET-1",
          codeNo: "55/1/1",
          series: "HMJ/1",
          questions: [
            {
              questionNo: 1,
              questionText:
                "If the net electric flux through a closed surface is zero, then we can infer\n(A) no net charge is enclosed by the surface.\n(B) uniform electric field exists within the surface.",
              marks: 1,
            },
            {
              questionNo: 2,
              questionText:
                "An electric dipole consisting of charges +q and -q separated by a distance L...",
              marks: 1,
            },
          ],
        },
      ],
    },
  },
  {
    input: `Series HMJ/1
SET-2
कोड नं. 55/1/2
7. किसी धातु के तार के प्रतिरोध में ताप में वृद्धि होने...
7. The resistance of a metal wire increases with increasing temperature on account of
(A) decrease in free electron density. [1 marks]`,
    output: {
      papers: [
        {
          set: "SET-2",
          codeNo: "55/1/2",
          series: "HMJ/1",
          questions: [
            {
              questionNo: 7,
              questionText:
                "The resistance of a metal wire increases with increasing temperature on account of\n(A) decrease in free electron density.",
              marks: 1,
            },
          ],
        },
      ],
    },
  },
];

/** Build OpenAI messages array (system + few-shot + user chunk). */
export function buildExtractionMessages(text, fileName) {
  const messages = [{ role: "system", content: EXTRACTION_SYSTEM_PROMPT }];

  for (const example of EXTRACTION_FEW_SHOT_EXAMPLES) {
    messages.push({
      role: "user",
      content: `File: example-paper.pdf\n\nExtract every question grouping by set, filtering text accurately:\n\n${example.input}`,
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(example.output),
    });
  }

  messages.push({
    role: "user",
    content: `File: ${fileName}\n\nExtract every question from this text. Strip out all Hindi text paragraphs cleanly, track meta markers, and populate the structured JSON system map:\n\n${text}`,
  });

  return messages;
}
