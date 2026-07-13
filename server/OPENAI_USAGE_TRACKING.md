# OpenAI usage tracking (Railway server)

Per-call token and estimated-cost tracking for server-side OpenAI usage during `POST /papers/:paperId/process`.

## Action codes

| Code | When |
|------|------|
| `extract.text` | Text-based PDF extraction (`extractWithOpenAISingle`) |
| `extract.vision` | Vision PDF extraction + retry passes |
| `classify.vector` | Question embeddings during vector classification |
| `classify.llm` | LLM chapter classification fallback |
| `syllabus.concepts` | Syllabus concept extraction (`POST /syllabus/chapters/:id/build`) |
| `syllabus.embed` | Syllabus + concept embeddings |

## Database setup

Run in Supabase SQL editor:

1. [`db/supabase/migration_openai_usage.sql`](../db/supabase/migration_openai_usage.sql)
2. Re-run [`db/supabase/policies.sql`](../db/supabase/policies.sql)
3. Verify with [`db/supabase/verify_openai_usage_migration.sql`](../db/supabase/verify_openai_usage_migration.sql)

## What gets recorded

**Per call** — `openai_usage_events` row + Railway log `openai.usage`:

- `ownerId`, `action`, `model`, token counts, `estimatedCostUsd`
- `jobId`, `questionPaperId`, `requestId`
- optional `metadata` (page range, batch index, retry flag)

**Per job** — `extraction_jobs.usage_summary` JSON rollup:

```json
{
  "pricingVersion": "2025-07",
  "extractPath": "vision",
  "classifiedBy": "vector",
  "byAction": {
    "extract.vision": { "calls": 28, "promptTokens": 420000, "completionTokens": 12000, "estimatedCostUsd": 1.05 },
    "classify.vector": { "calls": 2, "promptTokens": 800, "completionTokens": 0, "estimatedCostUsd": 0.00002 }
  },
  "totals": { "promptTokens": 420800, "completionTokens": 12000, "estimatedCostUsd": 1.05 }
}
```

## API responses

`POST /papers/:id/process`, `POST /papers/:id/reclassify`, `POST /syllabus/chapters/:id/build`, and `GET /jobs/:jobId` include `usageSummary` when tracking ran.

## Railway monitoring

Filter deploy logs for:

- `"message":"openai.usage"` — each API call
- `"message":"job.completed"` — includes `usage` totals and `extractionPath`

Example fields: `ownerId`, `action`, `estimatedCostUsd`, `jobId`, `paperId`.

## Supabase queries

**Per user, last 30 days by action:**

```sql
select action,
       count(*) as calls,
       sum(prompt_tokens) as prompt_tokens,
       sum(completion_tokens) as completion_tokens,
       sum(estimated_cost_usd) as cost_usd
from openai_usage_events
where owner_id = 'USER_UUID'
  and created_at > now() - interval '30 days'
group by action
order by cost_usd desc;
```

**Per extraction job:**

```sql
select usage_summary
from extraction_jobs
where id = 'JOB_UUID';
```

## OpenAI dashboard

Each request sets `user` to `enlightenly:{ownerId}:{action}` for coarse grouping in API logs.

Use the **Models** tab for model-level totals; use Supabase for per-user/per-action breakdown.

## Pricing

Rates in [`server/src/lib/openaiPricing.js`](src/lib/openaiPricing.js) (`PRICING_VERSION`).

Override via env: `OPENAI_PRICE_OVERRIDES_JSON='{"gpt-4o":{"inputPerMillion":2.5,"outputPerMillion":10}}'`

## Verify locally

```bash
cd server
npm run smoke
npm run verify:usage
```

## Deferred

Browser paths (syllabus KB build, **Classify chapters** button) are not tracked until Phase 4 server migration.

## Rollback

```sql
drop table if exists public.openai_usage_events cascade;
alter table public.extraction_jobs drop column if exists usage_summary;
```

Tracking failures are warn-only — jobs still complete if event insert fails.
