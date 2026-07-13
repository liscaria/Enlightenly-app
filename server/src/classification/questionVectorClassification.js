import { fetchEmbeddings } from "./embeddings.js";
import {
  CLASSIFICATION_SOURCE,
  confidenceToDisplayPercent,
  reviewStatusFromConfidence,
} from "../constants/classificationReview.js";
import { OPENAI_ACTIONS } from "../lib/openaiUsageAccumulator.js";

const WEIGHT_TITLE = 0.15;
const WEIGHT_SUMMARY = 0.35;
const WEIGHT_CONCEPT = 0.5;
const TOP_K = 3;
const EMBED_BATCH = 20;
const SOFTMAX_TEMPERATURE = 0.06;

function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function softmaxWithTemperature(values, temperature = SOFTMAX_TEMPERATURE) {
  if (!values.length) return [];
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp((v - max) / temperature));
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return sum ? exps.map((v) => v / sum) : values.map(() => 1 / values.length);
}

function chapterRawScore(questionEmbedding, profile) {
  const titleSim = profile.titleEmbedding
    ? cosineSimilarity(questionEmbedding, profile.titleEmbedding)
    : 0;
  const summarySim = profile.summaryEmbedding
    ? cosineSimilarity(questionEmbedding, profile.summaryEmbedding)
    : 0;
  let conceptMax = 0;
  for (const concept of profile.concepts || []) {
    if (concept.embedding) {
      conceptMax = Math.max(conceptMax, cosineSimilarity(questionEmbedding, concept.embedding));
    }
  }

  const hasSummary = Boolean(profile.summaryEmbedding);
  const hasConcepts = (profile.concepts || []).length > 0;

  if (!hasSummary && !hasConcepts) return titleSim;
  if (!hasConcepts) {
    return WEIGHT_TITLE * titleSim + (1 - WEIGHT_TITLE) * summarySim;
  }
  if (!hasSummary) {
    return WEIGHT_TITLE * titleSim + (1 - WEIGHT_TITLE) * conceptMax;
  }
  const blended =
    WEIGHT_TITLE * titleSim + WEIGHT_SUMMARY * summarySim + WEIGHT_CONCEPT * conceptMax;
  return Math.max(blended, conceptMax * 0.85 + titleSim * 0.15);
}

function rankChaptersForQuestion(questionEmbedding, kbProfiles, chapterIndex) {
  const profileById = new Map(kbProfiles.map((p) => [p.chapterId, p]));
  const scored = chapterIndex
    .map((ch) => {
      const profile = profileById.get(ch.id);
      if (!profile) return null;
      return {
        chapterId: ch.id,
        chapterName: ch.name,
        unitId: ch.unitId,
        rawScore: chapterRawScore(questionEmbedding, profile),
      };
    })
    .filter(Boolean);

  if (!scored.length) return null;

  const rankedByRaw = [...scored].sort((a, b) => b.rawScore - a.rawScore);
  const top = rankedByRaw.slice(0, TOP_K);
  const probs = softmaxWithTemperature(top.map((s) => s.rawScore));
  const withScores = top.map((s, i) => ({ ...s, score: probs[i] }));

  const best = withScores[0];
  const alternatives = withScores.slice(1).map((r) => ({
    chapter_id: r.chapterId,
    chapter_name: r.chapterName,
    score: Math.round(r.score * 1000) / 1000,
  }));

  return {
    chapterId: best.chapterId,
    chapterName: best.chapterName,
    unitId: best.unitId,
    confidence: best.score,
    alternatives,
    reviewStatus: reviewStatusFromConfidence(best.score),
    classificationSource: CLASSIFICATION_SOURCE.VECTOR,
  };
}

export async function classifyQuestionsWithVectorKb(
  questions,
  kbProfiles,
  chapterIndex,
  { usageContext = null, accumulator = null } = {}
) {
  if (!questions.length || !kbProfiles.length || !chapterIndex.length) {
    return { questions, classifiedBy: "none" };
  }

  const texts = questions.map((q) => (q.questionText || "").trim().slice(0, 8000));
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const { embeddings, error } = await fetchEmbeddings(batch, {
      action: OPENAI_ACTIONS.CLASSIFY_VECTOR,
      usageContext,
      accumulator,
      metadata: { batchStart: i },
    });
    if (error) {
      return { questions, classifiedBy: "none", error };
    }
    allEmbeddings.push(...embeddings);
  }

  const classified = questions.map((q, index) => {
    const qEmb = allEmbeddings[index];
    if (!qEmb) {
      return {
        ...q,
        chapterId: null,
        chapterName: null,
        unitId: null,
        chapterConfidence: null,
        classification: null,
      };
    }

    const result = rankChaptersForQuestion(qEmb, kbProfiles, chapterIndex);
    if (!result) {
      return { ...q, chapterId: null, chapterName: null, unitId: null, chapterConfidence: null };
    }

    return {
      ...q,
      chapterId: result.chapterId,
      chapterName: result.chapterName,
      unitId: result.unitId,
      chapterConfidence: confidenceToDisplayPercent(result.confidence),
      classification: {
        chapterId: result.chapterId,
        confidence: result.confidence,
        alternatives: result.alternatives,
        reviewStatus: result.reviewStatus,
        classificationSource: result.classificationSource,
      },
    };
  });

  const assigned = classified.filter((q) => q.chapterId).length;
  return {
    questions: classified,
    classifiedBy: assigned ? "vector" : "none",
  };
}
