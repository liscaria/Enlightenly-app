import { log } from "../lib/logger.js";
import { PRICING_VERSION } from "../lib/openaiPricing.js";

/**
 * Fire-and-forget insert into openai_usage_events. Never throws to caller.
 */
export function insertOpenAIUsageEvent(supabase, row) {
  if (!supabase || !row?.owner_id || !row?.action) return;

  void supabase
    .from("openai_usage_events")
    .insert({
      ...row,
      metadata: {
        pricingVersion: PRICING_VERSION,
        ...(row.metadata || {}),
      },
    })
    .then(({ error }) => {
      if (error) {
        log("warn", "openai.usage.persistFailed", {
          ownerId: row.owner_id,
          action: row.action,
          jobId: row.job_id,
          error: error.message,
        });
      }
    })
    .catch((err) => {
      log("warn", "openai.usage.persistFailed", {
        ownerId: row.owner_id,
        action: row.action,
        error: err?.message || String(err),
      });
    });
}
