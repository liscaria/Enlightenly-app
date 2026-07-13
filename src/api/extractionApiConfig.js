/** Railway extraction API feature flag (Phase 3). */

export function isExtractionApiEnabled() {
  return String(import.meta.env.VITE_USE_EXTRACTION_API || "").trim() === "true";
}

export function extractionApiBaseUrl() {
  return String(import.meta.env.VITE_EXTRACTION_API_URL || "").trim().replace(/\/$/, "");
}

export function isExtractionApiConfigured() {
  return isExtractionApiEnabled() && Boolean(extractionApiBaseUrl());
}
