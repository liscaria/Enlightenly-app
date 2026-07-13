# Phase 4 — Remove browser OpenAI key

Phase 4 moves **Classify chapters**, **syllabus KB build**, and (when enabled) **Update question bank** off the browser OpenAI key. The frontend calls Railway with a Supabase JWT; `OPENAI_API_KEY` lives on Railway only.

## What changed

| Piece | File(s) |
|-------|---------|
| Reclassify endpoint | `POST /papers/:paperId/reclassify` — [`server/src/routes/papers.js`](src/routes/papers.js), [`server/src/jobs/reclassifyPaperJob.js`](src/jobs/reclassifyPaperJob.js) |
| Syllabus build endpoint | `POST /syllabus/chapters/:chapterId/build` — [`server/src/routes/syllabus.js`](src/routes/syllabus.js), [`server/src/jobs/buildSyllabusKnowledgeJob.js`](src/jobs/buildSyllabusKnowledgeJob.js) |
| API client | [`src/api/extractionApiRemote.js`](../src/api/extractionApiRemote.js) — `reclassifyPaperRemote`, `buildSyllabusKnowledgeRemote` |
| Classify wiring | [`src/api/syncQuestionBank.js`](../src/api/syncQuestionBank.js) — `reclassifyQuestionPaperBank` branches when `VITE_USE_EXTRACTION_API=true` |
| Syllabus wiring | [`src/api/buildSyllabusKnowledge.js`](../src/api/buildSyllabusKnowledge.js) — calls server when API mode on |
| Usage tracking | `syllabus.concepts`, `syllabus.embed` on server |

## Prerequisites

1. Phase 3 enabled and stable (`VITE_USE_EXTRACTION_API=true`, `VITE_EXTRACTION_API_URL` set)
2. Railway `OPENAI_API_KEY` configured
3. Supabase migrations applied:
   - `migration_openai_usage.sql`
   - `policies.sql` (re-run for `openai_usage_events` RLS)
   - `migration_syllabus_knowledge.sql` (for syllabus KB)

## Frontend env (no browser OpenAI key)

```bash
VITE_EXTRACTION_API_URL=https://enlightenly-app-production.up.railway.app
VITE_USE_EXTRACTION_API=true
# VITE_OPENAI_API_KEY not required for question bank / classify / syllabus
```

Restart `npm run dev` after changing env vars.

**Vercel:** set the two `VITE_*` vars above; remove `VITE_OPENAI_API_KEY` from Production when ready.

## Test matrix

| ID | Action | Expected |
|----|--------|----------|
| P4-1 | **Update question bank** (no `VITE_OPENAI_API_KEY`) | Questions extracted on server, `classifiedBy` ≠ `"none"` when syllabus KB exists |
| P4-2 | **Classify chapters** on a paper with existing bank rows | Server notice, chapters assigned, no browser OpenAI calls |
| P4-3 | Upload **syllabus PDF** under a chapter | KB build runs on server; concepts appear in Syllabus knowledge modal |
| P4-4 | Reclassify after syllabus upload | Unassigned questions get chapters via server |
| P4-5 | `npm run build` | Bundle should not require `VITE_OPENAI_API_KEY` at runtime for P4-1–P4-4 paths |

### curl — reclassify

```bash
TOKEN="<supabase-access-token>"
curl -s -X POST \
  "https://enlightenly-app-production.up.railway.app/papers/lib-1781709699450-hf6tmlp6/reclassify" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"onlyUnassigned":false}'
```

### curl — syllabus build

```bash
curl -s -X POST \
  "https://enlightenly-app-production.up.railway.app/syllabus/chapters/<chapterId>/build" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"classId":"...","unitId":"...","chapterName":"...","materialId":"..."}'
```

## Browser-only paths (still use `VITE_OPENAI_API_KEY`)

- **Chapter material upload** → `syncQuestionBankFromMaterial` (library question papers)
- Fallback when `VITE_USE_EXTRACTION_API=false`

## Rollback

Set `VITE_USE_EXTRACTION_API=false`, restore `VITE_OPENAI_API_KEY` in `.env.local` / Vercel, redeploy.

## OpenAI usage

After migrations, check Supabase:

```sql
select action, count(*), sum(estimated_cost_usd)
from openai_usage_events
group by action
order by action;
```

Expect `classify.vector`, `classify.llm`, `syllabus.concepts`, `syllabus.embed` after P4-2/P4-3.
