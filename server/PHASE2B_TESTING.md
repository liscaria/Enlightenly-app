# Phase 2b — chapter classification

Phase 2b extends `POST /papers/:paperId/process` to classify questions to syllabus chapters after extraction, persist denormalized chapter fields on `question_bank`, and write `question_classifications` rows.

## What changed

- Job phase **`classifying`** runs between validate and save
- Response includes `assignedCount`; `classifiedBy` is `vector`, `ai`, or `heuristic` (not `"none"`)
- Flag: `classifyToChapters: true` in [`src/config/extractionConfig.js`](src/config/extractionConfig.js)

## DB prerequisites

Apply in Supabase SQL editor if not already run:

- [`db/supabase/migration_question_classifications.sql`](../../db/supabase/migration_question_classifications.sql)
- [`db/supabase/migration_syllabus_knowledge.sql`](../../db/supabase/migration_syllabus_knowledge.sql) (vector path)
- [`db/supabase/migration_chapter_confidence.sql`](../../db/supabase/migration_chapter_confidence.sql) (optional)
- Re-run [`db/supabase/policies.sql`](../../db/supabase/policies.sql)

## Local setup

Same as Phase 1 — see [`PHASE1_TESTING.md`](PHASE1_TESTING.md).

```bash
cd server
npm install
npm run dev
```

## Quick verify (no JWT)

```bash
cd server
npm run smoke
npm run verify:phase2b
```

`verify:phase2b` checks config flags, heuristic/vector classification, override merge, and OpenAI embeddings API.

## Full E2E (requires fresh JWT)

**Recommended — one line** (paste in a **new** terminal tab, not the Vite tab):

```bash
curl --max-time 600 -X POST "https://enlightenly-app-production.up.railway.app/papers/lib-1781709699450-hf6tmlp6/process" -H "Authorization: Bearer YOUR_TOKEN" -H "Content-Type: application/json"
```

**Or with env vars** (easier to re-run):

```bash
export TOKEN='your_access_token'
export PAPER_ID='lib-1781709699450-hf6tmlp6'

curl --max-time 600 -X POST "https://enlightenly-app-production.up.railway.app/papers/${PAPER_ID}/process" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json"
```

Local server (Phase 2b must be running via `npm run dev` in `server/`):

```bash
curl --max-time 600 -X POST "http://localhost:3000/papers/${PAPER_ID}/process" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json"
```

Expected response:

```json
{
  "jobId": "...",
  "status": "completed",
  "questionCount": 27,
  "bankRowCount": 27,
  "assignedCount": 24,
  "extractedBy": "ai",
  "classifiedBy": "vector",
  "qualityReport": { ... }
}
```

## Verify in Supabase

```sql
-- Bank chapter fields
select question_no, chapter_id, chapter_name, chapter_confidence
from question_bank
where question_paper_id = 'lib-1781709699450-hf6tmlp6'
order by question_no;

-- Classification source of truth
select qb.question_no, qc.chapter_id, qc.confidence,
       qc.classification_source, qc.review_status
from question_classifications qc
join question_bank qb on qb.id = qc.question_id
where qb.question_paper_id = 'lib-1781709699450-hf6tmlp6'
order by qb.question_no;

-- Latest job
select status, phase, classified_by, question_count, error
from extraction_jobs
where question_paper_id = 'lib-1781709699450-hf6tmlp6'
order by created_at desc
limit 1;
```

## Test matrix

| ID | Check | Pass |
|----|-------|------|
| **B-1** | Class with syllabus KB → `classifiedBy: "vector"`, `assignedCount > 0` | |
| **B-2** | Class without KB → `classifiedBy: "ai"` or `"heuristic"` | |
| **B-3** | `question_classifications` rows match assigned bank rows | |
| **B-4** | Set `MANUAL_OVERRIDE` in UI; re-process paper → same `question_no` keeps override | |
| **B-5** | Compare `assignedCount` vs FE **Update question bank** on same paper | Comparable |
| **B-6** | Classify failure (local: bad OpenAI key) | Job `failed`; bank unchanged |
| **L-B0** | `npm run smoke` | OK |
| **R-B1** | Railway `POST /process` | Same as local B-1/B-2 |

## Railway

```bash
curl --max-time 600 -X POST \
  "https://enlightenly-app-production.up.railway.app/papers/${PAPER_ID}/process" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

## Out of scope (Phase 2b)

- **`POST /papers/:id/reclassify`** — classify-only (UI **Classify chapters** button) — future endpoint
- FE calling Railway (`VITE_USE_EXTRACTION_API`) — Phase 3
- Building syllabus KB from server — only reads existing embeddings

## Manual override on re-extract

Full re-process assigns **new UUIDs** each run. Overrides are preserved by **`question_no`**, not question id.
