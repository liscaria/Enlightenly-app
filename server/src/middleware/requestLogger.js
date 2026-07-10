import crypto from "crypto";
import { log } from "../lib/logger.js";

export function requestLogger(req, res, next) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  log("info", "request.start", {
    requestId,
    method: req.method,
    path: req.originalUrl || req.url,
  });

  res.on("finish", () => {
    log("info", "request.finish", {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - started,
      userId: req.userId || null,
      outcome: res.statusCode >= 500 ? "failed" : res.statusCode >= 400 ? "client_error" : "success",
    });
  });

  next();
}
