import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: (process.env.SUPABASE_URL || "").trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || "").trim(),
  openaiApiKey: (process.env.OPENAI_API_KEY || "").trim(),
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  questionPapersBucket: process.env.SUPABASE_QUESTION_PAPERS_BUCKET || "question-papers",
  corsOrigin: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  logLevel: process.env.LOG_LEVEL || "info",
  promptVersion: process.env.PROMPT_VERSION || "1",
};

export function assertServerConfig() {
  const missing = [];
  if (!config.supabaseUrl) missing.push("SUPABASE_URL");
  if (!config.supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");
  if (!config.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (missing.length) {
    console.warn(`[config] Missing env: ${missing.join(", ")}`);
  }
}
