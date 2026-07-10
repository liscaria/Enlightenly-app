#!/usr/bin/env node
/**
 * Call POST /papers/:paperId/process (requires running server + valid JWT).
 *
 * Usage:
 *   TOKEN=... PAPER_ID=... npm run process-paper
 *   API_URL=http://localhost:3000 (optional)
 */
const apiUrl = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");
const token = (process.env.TOKEN || "").trim();
const paperId = (process.env.PAPER_ID || "").trim();

if (!token || !paperId) {
  console.error("Set TOKEN and PAPER_ID env vars. See PHASE1_TESTING.md.");
  process.exit(1);
}

const res = await fetch(`${apiUrl}/papers/${encodeURIComponent(paperId)}/process`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  body = text;
}

console.log("status:", res.status);
console.log("request-id:", res.headers.get("x-request-id"));
console.log(JSON.stringify(body, null, 2));

if (!res.ok) process.exit(1);
