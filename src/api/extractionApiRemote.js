import { supabase, isSupabaseConfigured } from "../supabaseClient.js";
import { extractionApiBaseUrl } from "./extractionApiConfig.js";
import { formatExtractionQualitySummary } from "./extractionQualityReport.js";

const API_TIMEOUT_MS = 900_000;
const TOKEN_REFRESH_BUFFER_SEC = 120;

async function getAccessToken() {
  if (!isSupabaseConfigured || !supabase) {
    return { token: null, error: "Sign in to use the extraction API." };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    return { token: null, error: sessionError.message || "Could not read session." };
  }

  let session = sessionData?.session;
  if (!session?.access_token) {
    return { token: null, error: "Sign in again to use the extraction API." };
  }

  const expiresAt = session.expires_at;
  if (
    expiresAt &&
    expiresAt - Math.floor(Date.now() / 1000) < TOKEN_REFRESH_BUFFER_SEC
  ) {
    const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError) {
      return { token: null, error: refreshError.message || "Session expired. Sign in again." };
    }
    session = refreshed?.session ?? session;
  }

  if (!session?.access_token) {
    return { token: null, error: "Sign in again to use the extraction API." };
  }

  return { token: session.access_token, error: null };
}

function mapHttpError(status, body, contextLabel) {
  const serverMessage =
    typeof body?.error === "string" ? body.error : body?.message || null;

  if (status === 401) {
    return serverMessage || "Sign in again to use the extraction API.";
  }
  if (status === 404) {
    return serverMessage || `${contextLabel} was not found.`;
  }
  if (status === 403) {
    return (
      serverMessage ||
      "Extraction API blocked this request (CORS). Ensure Railway CORS_ORIGIN includes this app URL."
    );
  }
  if (status >= 500) {
    return serverMessage || "Extraction server error. Try again in a few minutes.";
  }
  return serverMessage || `API request failed (${status}).`;
}

async function apiPost(path, { body = null, contextLabel = "Request", timeoutMs = API_TIMEOUT_MS } = {}) {
  const baseUrl = extractionApiBaseUrl();
  if (!baseUrl) {
    return { ok: false, error: "VITE_EXTRACTION_API_URL is not set.", body: null };
  }

  const { token, error: authError } = await getAccessToken();
  if (authError) {
    return { ok: false, error: authError, body: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      return {
        ok: false,
        error: `${contextLabel} timed out after ${Math.round(timeoutMs / 60000)} minutes. Try again in a moment.`,
        body: null,
      };
    }
    const message = err?.message || String(err);
    const corsHint = message.includes("Failed to fetch")
      ? " Check that the extraction API is reachable and CORS_ORIGIN includes this app URL."
      : "";
    return {
      ok: false,
      error: `Could not reach extraction API.${corsHint}`,
      body: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  let responseBody = null;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: mapHttpError(response.status, responseBody, contextLabel),
      body: responseBody,
    };
  }

  return { ok: true, error: null, body: responseBody };
}

export function mapProcessResponseToSyncResult(apiJson) {
  const qualityReport = apiJson?.qualityReport ?? null;
  const validationNote = formatExtractionQualitySummary(qualityReport) || "";
  const count = Number(apiJson?.questionCount) || 0;
  const assignedCount = Number(apiJson?.assignedCount) || 0;
  const status = apiJson?.status || "unknown";

  if (status !== "completed") {
    return {
      count: 0,
      assignedCount: 0,
      extractedBy: apiJson?.extractedBy || "none",
      classifiedBy: apiJson?.classifiedBy || "none",
      quality: null,
      qualityReport,
      validationNote,
      error: `Extraction did not complete (status: ${status}).`,
      questions: [],
      jobId: apiJson?.jobId ?? null,
    };
  }

  const bankRowCount = Number(apiJson?.bankRowCount);
  if (Number.isFinite(bankRowCount) && bankRowCount !== count && count > 0) {
    console.warn(
      "[extractionApiRemote] bankRowCount mismatch:",
      bankRowCount,
      "vs questionCount",
      count
    );
  }

  return {
    count,
    assignedCount,
    extractedBy: apiJson?.extractedBy || "none",
    classifiedBy: apiJson?.classifiedBy || "none",
    quality: null,
    qualityReport,
    validationNote,
    error: null,
    questions: [],
    jobId: apiJson?.jobId ?? null,
  };
}

function mapReclassifyResponse(apiJson) {
  const status = apiJson?.status || "unknown";
  const count = Number(apiJson?.questionCount) || 0;
  const assignedCount = Number(apiJson?.assignedCount) || 0;

  if (status !== "completed") {
    return {
      count: 0,
      assignedCount: 0,
      classifiedBy: apiJson?.classifiedBy || "none",
      extractedBy: "existing",
      error: `Classification did not complete (status: ${status}).`,
      questions: [],
    };
  }

  return {
    count,
    assignedCount,
    classifiedBy: apiJson?.classifiedBy || "none",
    extractedBy: "existing",
    error: null,
    questions: [],
  };
}

function mapSyllabusBuildResponse(apiJson) {
  return {
    status: apiJson?.status || "failed",
    mismatchWarning: Boolean(apiJson?.mismatchWarning),
    conceptCount: Number(apiJson?.conceptCount) || 0,
    error: apiJson?.error ?? null,
    syllabusKnowledgeId: apiJson?.syllabusKnowledgeId ?? null,
  };
}

/**
 * Run full extract → classify → persist on the Railway extraction API.
 */
export async function processQuestionPaperRemote(paperId) {
  const { ok, error, body } = await apiPost(
    `/papers/${encodeURIComponent(paperId)}/process`,
    { contextLabel: "Extraction" }
  );

  if (!ok) {
    return {
      count: 0,
      assignedCount: 0,
      extractedBy: "none",
      classifiedBy: "none",
      quality: null,
      qualityReport: null,
      validationNote: "",
      error,
      questions: [],
      jobId: body?.jobId ?? null,
    };
  }

  return mapProcessResponseToSyncResult(body);
}

/**
 * Reclassify existing question_bank rows on the server (no re-extract).
 */
export async function reclassifyPaperRemote(paperId, { onlyUnassigned = false } = {}) {
  const { ok, error, body } = await apiPost(
    `/papers/${encodeURIComponent(paperId)}/reclassify`,
    { body: { onlyUnassigned }, contextLabel: "Chapter classification" }
  );

  if (!ok) {
    return {
      count: 0,
      assignedCount: 0,
      classifiedBy: "none",
      extractedBy: "existing",
      error,
      questions: [],
    };
  }

  return mapReclassifyResponse(body);
}

/**
 * Build syllabus knowledge for one chapter on the server.
 */
export async function buildSyllabusKnowledgeRemote({
  chapterId,
  classId,
  unitId,
  chapterName,
  materialId,
}) {
  const { ok, error, body } = await apiPost(
    `/syllabus/chapters/${encodeURIComponent(chapterId)}/build`,
    {
      body: { classId, unitId, chapterName, materialId },
      contextLabel: "Syllabus knowledge build",
    }
  );

  if (!ok) {
    return {
      status: "failed",
      mismatchWarning: false,
      conceptCount: 0,
      error,
      syllabusKnowledgeId: null,
    };
  }

  return mapSyllabusBuildResponse(body);
}
