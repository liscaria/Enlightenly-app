#!/usr/bin/env node
/**
 * Phase 1 parity: compare FE question_bank baseline vs Railway POST /papers/:id/process.
 *
 * Usage:
 *   TOKEN=... npm run parity-test
 *   TOKEN=... PAPER_ID=lib-... npm run parity-test
 *   TOKEN=... API_URL=https://enlightenly-app-production.up.railway.app npm run parity-test
 */
import dotenv from "dotenv";
import { buildPaperExtractionQualityReport } from "../src/extraction/extractionQualityReport.js";

dotenv.config();

const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = (process.env.SUPABASE_ANON_KEY || "").trim();
const token = (process.env.TOKEN || "").trim();
const paperIdHint = (process.env.PAPER_ID || "").trim();
const paperNameHint = (process.env.PAPER_NAME || "55-3-1").trim();
const apiUrl = (
  process.env.API_URL || "https://enlightenly-app-production.up.railway.app"
).replace(/\/$/, "");

if (!token) {
  console.error("Set TOKEN (Supabase access_token from logged-in app). See PHASE1_TESTING.md.");
  process.exit(1);
}
if (!supabaseUrl || !anonKey) {
  console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY in server/.env");
  process.exit(1);
}

function supabaseHeaders() {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function supabaseGet(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { ...supabaseHeaders(), Accept: "application/json" },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Supabase GET ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function bankRowToEntry(row) {
  return {
    id: row.id,
    questionNo: row.question_no,
    questionText: row.question_text,
    marks: row.marks,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    questionPaperId: row.question_paper_id,
  };
}

function pickReportFields(report) {
  if (!report) return null;
  return {
    validationStatus: report.validationStatus,
    extractedCount: report.extractedCount,
    expectedCount: report.expectedCount,
    missing: report.missing || [],
    duplicateNumbers: report.duplicateNumbers || [],
    extraNumbers: report.extraNumbers || [],
    status: report.status,
  };
}

function compareReports(fe, api) {
  const fields = ["validationStatus", "extractedCount", "expectedCount", "status"];
  const diffs = [];
  for (const f of fields) {
    if (fe?.[f] !== api?.[f]) diffs.push({ field: f, fe: fe?.[f], api: api?.[f] });
  }
  const feMissing = JSON.stringify(fe?.missing || []);
  const apiMissing = JSON.stringify(api?.missing || []);
  if (feMissing !== apiMissing) {
    diffs.push({ field: "missing", fe: fe?.missing, api: api?.missing });
  }
  return diffs;
}

async function resolvePaperId() {
  if (paperIdHint) return paperIdHint;

  const rows = await supabaseGet(
    `question_papers?select=id,name&name=ilike.*${encodeURIComponent(paperNameHint)}*&order=updated_at.desc&limit=5`
  );
  if (!rows?.length) {
    throw new Error(`No question_papers matching name "${paperNameHint}". Set PAPER_ID explicitly.`);
  }
  if (rows.length > 1) {
    console.log("Multiple papers matched; using most recently updated:");
    for (const r of rows) console.log(`  - ${r.id}  ${r.name}`);
  }
  return rows[0].id;
}

async function fetchFeBaseline(paperId) {
  const [paperRows, bankRows] = await Promise.all([
    supabaseGet(`question_papers?select=id,name,last_quality_report&id=eq.${paperId}&limit=1`),
    supabaseGet(
      `question_bank?select=id,question_no,question_text,marks,metadata,question_paper_id&question_paper_id=eq.${paperId}&order=question_no.asc`
    ),
  ]);

  const paper = paperRows?.[0];
  if (!paper) throw new Error(`Paper ${paperId} not found for this user.`);

  const entries = (bankRows || []).map(bankRowToEntry);
  const reportFromBank = buildPaperExtractionQualityReport(entries, paperId);

  return {
    paper,
    bankRowCount: bankRows?.length || 0,
    reportFromBank,
    cachedReport: paper.last_quality_report || null,
  };
}

async function runRailwayProcess(paperId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15 * 60 * 1000);

  try {
    const res = await fetch(`${apiUrl}/papers/${encodeURIComponent(paperId)}/process`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    return {
      ok: res.ok,
      status: res.status,
      requestId: res.headers.get("x-request-id"),
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

console.log("Phase 1 parity test");
console.log("API:", apiUrl);
console.log("Paper name hint:", paperNameHint);
console.log("---");

const paperId = await resolvePaperId();
console.log("Paper ID:", paperId);

const fe = await fetchFeBaseline(paperId);
console.log("\n## FE baseline (question_bank)");
console.log("Paper name:", fe.paper.name);
console.log("Bank rows:", fe.bankRowCount);
console.log("Report from bank:", JSON.stringify(pickReportFields(fe.reportFromBank), null, 2));
if (fe.cachedReport) {
  console.log("Cached last_quality_report:", JSON.stringify(pickReportFields(fe.cachedReport), null, 2));
}

console.log("\n## Railway POST /papers/:id/process (may take 2–5 min)...");
const railway = await runRailwayProcess(paperId);

console.log("HTTP status:", railway.status);
console.log("request-id:", railway.requestId || "(none)");

if (!railway.ok) {
  console.error("Railway process failed:", JSON.stringify(railway.body, null, 2));
  process.exit(1);
}

const apiReport = railway.body?.qualityReport;
console.log("\n## Railway API response");
console.log(
  JSON.stringify(
    {
      jobId: railway.body?.jobId,
      questionCount: railway.body?.questionCount,
      extractedBy: railway.body?.extractedBy,
      classifiedBy: railway.body?.classifiedBy,
      qualityReport: pickReportFields(apiReport),
    },
    null,
    2
  )
);

const diffs = compareReports(pickReportFields(fe.reportFromBank), pickReportFields(apiReport));

console.log("\n## Parity comparison (FE bank vs Railway API)");
if (!fe.bankRowCount) {
  console.log(
    "WARN: No question_bank rows — run Update question bank in the app first for a true FE baseline."
  );
}

if (!diffs.length) {
  console.log("PASS: extractedCount, expectedCount, missing, validationStatus match.");
  process.exit(0);
}

console.log("DIFFERENCES:");
for (const d of diffs) {
  console.log(`  ${d.field}: FE=${JSON.stringify(d.fe)}  API=${JSON.stringify(d.api)}`);
}

const countClose =
  Math.abs((fe.reportFromBank?.extractedCount || 0) - (apiReport?.extractedCount || 0)) <= 1;
if (countClose && fe.reportFromBank?.expectedCount === apiReport?.expectedCount) {
  console.log("\nACCEPTABLE: counts within ±1 (known vision variance on 55-3-1.pdf).");
  process.exit(0);
}

console.log("\nFAIL: parity gap larger than acceptable tolerance.");
process.exit(1);
