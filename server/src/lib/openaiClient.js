import { config } from "./config.js";
import { log } from "./logger.js";
import { estimateCostUsd } from "./openaiPricing.js";
import { insertOpenAIUsageEvent } from "../data/openaiUsageRemote.js";

function openaiUserField(ownerId, action) {
  if (!ownerId) return `enlightenly:unknown:${action}`;
  return `enlightenly:${ownerId}:${action}`;
}

function parseUsage(payload) {
  const u = payload?.usage || {};
  const promptTokens = Number(u.prompt_tokens) || 0;
  const completionTokens = Number(u.completion_tokens) || 0;
  const totalTokens = Number(u.total_tokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function recordUsage({
  payload,
  model,
  action,
  usageContext,
  accumulator,
  metadata = {},
}) {
  const { promptTokens, completionTokens, totalTokens } = parseUsage(payload);
  const estimatedCostUsd = estimateCostUsd(model, {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
  });

  if (accumulator) {
    accumulator.record(action, {
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCostUsd,
    });
  }

  const ownerId = usageContext?.ownerId;
  const jobId = usageContext?.jobId ?? null;
  const paperId = usageContext?.paperId ?? null;
  const requestId = usageContext?.requestId ?? null;

  log("info", "openai.usage", {
    ownerId,
    action,
    model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimatedCostUsd,
    jobId,
    paperId,
    requestId,
    ...metadata,
  });

  if (usageContext?.supabase && ownerId) {
    insertOpenAIUsageEvent(usageContext.supabase, {
      owner_id: ownerId,
      action,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimatedCostUsd,
      job_id: jobId,
      question_paper_id: paperId,
      request_id: requestId,
      metadata,
    });
  }

  return { promptTokens, completionTokens, totalTokens, estimatedCostUsd };
}

async function fetchWithRetry(url, init, { label = "OpenAI" } = {}) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, init);

    if (response.ok) return response;

    const detail = await response.text();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === maxAttempts) {
      throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 200)}`);
    }

    const retryAfterSec = Number(response.headers.get("retry-after")) || attempt * 15;
    console.warn(
      `[openaiClient] ${label} rate limited (${response.status}); retry ${attempt}/${maxAttempts - 1} in ${retryAfterSec}s`
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfterSec * 1000));
  }

  throw new Error(`${label} failed after retries.`);
}

/**
 * @returns {Promise<object>} Parsed OpenAI chat completion JSON payload
 */
export async function chatCompletion({
  body,
  action,
  usageContext = null,
  accumulator = null,
  metadata = {},
  label = "OpenAI chat",
}) {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the extraction server.");
  }

  const requestBody = {
    ...body,
    user: openaiUserField(usageContext?.ownerId, action),
  };

  const response = await fetchWithRetry(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    { label }
  );

  const payload = await response.json();
  recordUsage({
    payload,
    model: body.model,
    action,
    usageContext,
    accumulator,
    metadata,
  });
  return payload;
}

/**
 * @returns {Promise<{ embeddings: (number[]|null)[], error: string|null }>}
 */
export async function embeddings({
  inputs,
  model = "text-embedding-3-small",
  dimensions = 1536,
  action,
  usageContext = null,
  accumulator = null,
  metadata = {},
}) {
  if (!config.openaiApiKey) {
    return { embeddings: [], error: "OpenAI API key is not configured." };
  }

  const texts = (inputs || []).map((t) => (t || "").trim()).filter(Boolean);
  if (!texts.length) {
    return { embeddings: [], error: null };
  }

  try {
    const response = await fetchWithRetry(
      "https://api.openai.com/v1/embeddings",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: texts,
          dimensions,
          user: openaiUserField(usageContext?.ownerId, action),
        }),
      },
      { label: "OpenAI embeddings" }
    );

    const payload = await response.json();
    recordUsage({
      payload,
      model,
      action,
      usageContext,
      accumulator,
      metadata: { ...metadata, inputCount: texts.length },
    });

    const sorted = (payload?.data || []).sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0)
    );
    const result = sorted.map((item) => {
      const vec = item?.embedding;
      if (!Array.isArray(vec) || vec.length !== dimensions) return null;
      return vec;
    });

    if (result.length !== texts.length) {
      return { embeddings: [], error: "Embedding count mismatch." };
    }

    return { embeddings: result, error: null };
  } catch (err) {
    return { embeddings: [], error: err?.message || String(err) };
  }
}
