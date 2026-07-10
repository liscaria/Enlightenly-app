import express from "express";
import cors from "cors";
import { config, assertServerConfig } from "./lib/config.js";
import { log } from "./lib/logger.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { requireAuth } from "./middleware/auth.js";
import { papersRouter } from "./routes/papers.js";
import { jobsRouter } from "./routes/jobs.js";

assertServerConfig();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(requestLogger);
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "enlightenly-extraction-api",
    promptVersion: config.promptVersion,
    openaiConfigured: Boolean(config.openaiApiKey),
  });
});

app.use("/papers", requireAuth, papersRouter);
app.use("/jobs", requireAuth, jobsRouter);

app.use((err, req, res, _next) => {
  log("error", "unhandled", {
    requestId: req.requestId,
    error: err?.message || String(err),
  });
  if (err?.message?.startsWith("CORS blocked")) {
    return res.status(403).json({ error: err.message });
  }
  return res.status(500).json({ error: "Internal server error." });
});

app.listen(config.port, () => {
  log("info", "server.start", { port: config.port });
});
