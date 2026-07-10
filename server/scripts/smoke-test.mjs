#!/usr/bin/env node
/**
 * Phase 1 smoke test: config, extraction imports, optional /health.
 * Usage: npm run smoke [-- --health]
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const runHealth = process.argv.includes("--health");
const port = process.env.PORT || 3000;

const { isOpenAIConfigured } = await import("../src/extraction/questionExtraction.js");
console.log("extraction module: ok");
console.log("openai configured:", isOpenAIConfigured);

if (runHealth) {
  const res = await fetch(`http://localhost:${port}/health`);
  const body = await res.json();
  if (!res.ok || !body.ok) {
    console.error("health check failed:", res.status, body);
    process.exit(1);
  }
  console.log("health:", body);
}
