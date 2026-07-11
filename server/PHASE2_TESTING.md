# Phase 2 — question_bank persistence

Phase 2 extends the extraction API to write extracted questions to `question_bank` after successful extraction. Classification is deferred to Phase 2b (`classifiedBy: "none"`).

## What changed

- `POST /papers/:paperId/process` now upserts `question_bank` rows (safe: upsert first, delete orphans second)
- Response includes `bankRowCount`
- Flag: `persistToQuestionBank: true` in [`src/config/extractionConfig.js`](src/config/extractionConfig.js)

## Local setup

Same as Phase 1 — see [`PHASE1_TESTING.md`](PHASE1_TESTING.md).

```bash
cd server
npm install
npm run dev
```

## Process a paper (with bank persist)

```bash
export TOKEN="your_access_token"
export PAPER_ID="lib-1781624870861-zehqz72e"

curl --max-time 600 -X POST "http://localhost:3000/papers/${PAPER_ID}/process" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Expected response fields:

```json
{
  "jobId": "...",
  "status": "completed",
  "questionCount": 30,
  "bankRowCount": 30,
  "extractedBy": "ai",
  "classifiedBy": "none",
  "qualityReport": { ... }
}
```

## Verify in Supabase

```sql
select count(*) from question_bank
where question_paper_id = 'lib-1781624870861-zehqz72e';

select question_no, count(*) from question_bank
where question_paper_id = 'lib-1781624870861-zehqz72e'
group by question_no having count(*) > 1;
```

## Railway

```bash
curl --max-time 600 -X POST \
  "https://enlightenly-app-production.up.railway.app/papers/${PAPER_ID}/process" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Refresh the React app — the paper modal should show questions without clicking **Update question bank**.

## Test matrix

| ID | Check | Pass |
|----|-------|------|
| L-1 | `npm run smoke` | OK |
| L-2 | `GET /health` | JSON 200 |
| L-3 | `POST /process` | `bankRowCount` ≈ `questionCount` |
| L-4 | Supabase row count | Matches API |
| L-6 | UI refresh | Questions visible |
| R-3 | Railway `POST /process` | `bankRowCount` present |
| E-2 | Zero questions | Job fails; bank unchanged |

## Phase 2b (next)

- `classifyToChapters: true`
- Write `question_classifications`
- Preserve `MANUAL_OVERRIDE` on re-process
