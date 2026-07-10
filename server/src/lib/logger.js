import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function shouldLog(level) {
  return (LEVELS[level] || 20) >= (LEVELS[config.logLevel] || 20);
}

/** Structured JSON log line for Railway / local stdout. */
export function log(level, message, fields = {}) {
  if (!shouldLog(level)) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
