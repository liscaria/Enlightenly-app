# Phase 3 — Frontend calls Railway extraction API

Phase 3 wires the Question Bank **Update question bank** button to `POST /papers/:paperId/process` when `VITE_USE_EXTRACTION_API=true`. Browser-side extraction remains available when the flag is off.

## What changed

- [`src/api/extractionApiConfig.js`](../src/api/extractionApiConfig.js) — env flag helpers
- [`src/api/extractionApiRemote.js`](../src/api/extractionApiRemote.js) — JWT auth + API client
- [`src/api/syncQuestionBank.js`](../src/api/syncQuestionBank.js) — `updateQuestionBankForPaper` branches to Railway when configured
- [`src/App.jsx`](../src/App.jsx) — loading/error copy for server extraction

## Prerequisites

1. Phases 0–2b complete (Railway deployed, DB migrations applied)
2. Railway `CORS_ORIGIN` includes:
   - `http://localhost:5173` (local dev)
   - Your Vercel production URL
3. Paper uploaded to Supabase `question-papers` storage (`question_papers.storage_path` set)

## Frontend env

In root `.env.local`:

```bash
VITE_EXTRACTION_API_URL=https://enlightenly-app-production.up.railway.app
VITE_USE_EXTRACTION_API=true
```

Restart `npm run dev` after changing env vars (Vite reads them at startup).

For local API testing:

```bash
VITE_EXTRACTION_API_URL=http://localhost:3000
VITE_USE_EXTRACTION_API=true
```

## Local test (P3-2)

Terminal 1 — extraction API:

```bash
cd server
npm run dev
```

Terminal 2 — frontend:

```bash
# .env.local with VITE_USE_EXTRACTION_API=true and VITE_EXTRACTION_API_URL=http://localhost:3000
npm run dev
```

1. Sign in
2. Open Question Bank
3. Click **Update question bank** on a synced paper
4. Expect notice: *"Processing on server — this may take several minutes…"*
5. On success, toast shows question count + `classifiedBy` (e.g. `vector`)

## Production test (P3-3 / P3-4)

1. Set Vercel env vars (`VITE_EXTRACTION_API_URL`, `VITE_USE_EXTRACTION_API=true`)
2. Redeploy frontend
3. Sign in on production, run **Update question bank**
4. Verify in Supabase:

```sql
select qb.question_no, qb.chapter_id, qc.classification_source
from question_bank qb
left join question_classifications qc on qc.question_id = qb.id
where qb.question_paper_id = 'YOUR_PAPER_ID'
order by qb.question_no;
```

## Test matrix

| ID | Scenario | Pass |
|----|----------|------|
| **P3-1** | `VITE_USE_EXTRACTION_API=false` — browser path unchanged | |
| **P3-2** | Flag on, local FE → local server | Toast + `classifiedBy` ≠ `"none"` |
| **P3-3** | Flag on, local FE → Railway prod | Same as Phase 2b curl |
| **P3-4** | Flag on, Vercel prod | No CORS errors |
| **P3-5** | Expired JWT | "Sign in again" message |
| **P3-6** | Paper not in storage | Clear error in UI |
| **P3-7** | **Classify chapters** button | With Phase 4: server path when flag on (see [`PHASE4_TESTING.md`](PHASE4_TESTING.md)) |
| **P3-8** | Manual override + re-extract via API | Override preserved by `question_no` |

## Known limitations

- **Chapter materials upload** (`syncQuestionBankFromMaterial`) still runs in the browser — no server endpoint
- Request is **synchronous** (blocks until complete, up to 15 min client timeout)

Phase 4 adds server paths for **Classify chapters** and **syllabus KB build** — see [`PHASE4_TESTING.md`](PHASE4_TESTING.md).

## Rollback

Set `VITE_USE_EXTRACTION_API=false` in Vercel and redeploy. No server changes required.

## Out of scope

- Async job polling / progress UI
- Server endpoint for chapter library material uploads
