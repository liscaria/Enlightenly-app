# Phase 0 setup — extraction jobs + Railway

Complete these steps before Phase 1 (Node API code).

## 1. Supabase SQL (required)

In [Supabase SQL Editor](https://supabase.com/dashboard), run in order:

1. **`migration_extraction_jobs.sql`** — creates `extraction_jobs`, adds `last_quality_report` / `last_extraction_job_id` on `question_papers`
2. **`policies.sql`** — RLS for `extraction_jobs` (owner-only)

### Verify

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'extraction_jobs'
order by ordinal_position;
```

You should see `status`, `phase`, `quality_report`, `question_paper_id`, etc.

## 2. Railway variables (prep)

Project: your Enlightenly service (e.g. under `renewed-gentleness`).

| Variable | Value |
|----------|--------|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` in `.env.local` |
| `SUPABASE_ANON_KEY` | Same as `VITE_SUPABASE_ANON_KEY` |
| `OPENAI_API_KEY` | Your OpenAI key (server-only, no `VITE_`) |
| `OPENAI_MODEL` | `gpt-4o` |
| `PORT` | `3000` |
| `LOG_LEVEL` | `info` |
| `PROMPT_VERSION` | `1` |
| `CORS_ORIGIN` | `http://localhost:5173,https://YOUR_VERCEL_APP.vercel.app` |

**Root Directory:** leave as repo root until Phase 1 adds `server/package.json`; then set to `server`.

Deploy may fail until Phase 1 — that is expected.

## 3. Frontend env (optional now, required Phase 3)

In `.env.local` / Vercel (when API is deployed):

```bash
# VITE_EXTRACTION_API_URL=https://your-service.up.railway.app
# VITE_USE_EXTRACTION_API=false
```

Keep `VITE_USE_EXTRACTION_API=false` until Phase 3 integration.

## Phase 0 tests

| ID | Check |
|----|--------|
| P0-1 | Railway `SUPABASE_URL` matches local `VITE_SUPABASE_URL` |
| P0-2 | RLS: user A cannot read user B's `extraction_jobs` rows |
| P0-3 | `question-papers` bucket upload/download still works |

## Rollback

- Drop table only if unused: `drop table if exists public.extraction_jobs cascade;`
- Remove optional columns: `alter table question_papers drop column if exists last_quality_report, drop column if exists last_extraction_job_id;`
- Pause Railway service — no frontend impact yet
