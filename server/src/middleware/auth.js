import { verifyAccessToken } from "../lib/supabase.js";
import { log } from "../lib/logger.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    log("warn", "auth.missing", { requestId: req.requestId });
    return res.status(401).json({ error: "Missing Authorization Bearer token." });
  }

  const accessToken = match[1].trim();
  const { user, error } = await verifyAccessToken(accessToken);
  if (!user) {
    log("warn", "auth.invalid", { requestId: req.requestId, error });
    return res.status(401).json({ error: error || "Unauthorized." });
  }

  req.accessToken = accessToken;
  req.userId = user.id;
  req.supabaseUser = user;
  next();
}
