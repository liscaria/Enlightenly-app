# Enlightenly extraction API (Railway)

Node service for Question Bank exam-paper processing. Implemented in phases — see `db/supabase/PHASE0_SETUP.md`.

## Phase 3 (current)

Frontend **Update question bank** calls Railway when `VITE_USE_EXTRACTION_API=true`. See **`PHASE3_TESTING.md`**.

Endpoints:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | No | Liveness + config check |
| POST | `/papers/:paperId/process` | Bearer JWT | Extract, classify, persist `question_bank` + `question_classifications` |
| GET | `/jobs/:jobId` | Bearer JWT | Poll job status + quality report |

Phase 2b added chapter classification (`assignedCount`, `classifiedBy: "vector"` \| `"ai"` \| `"heuristic"`).

### Local setup

```bash
cd server
cp .env.example .env
# Map values from root .env.local: VITE_SUPABASE_URL → SUPABASE_URL, etc.
npm install
npm run dev
```

Uses `@napi-rs/canvas` with pdf.js `canvasFactory` for vision PDF rendering (no native cairo build).

### Verify

```bash
npm run smoke          # loads extraction module + checks OpenAI env
npm run smoke:health   # also hits GET /health (server must be running)
npm run test:pdf-render # pdf.js vision render smoke test (no JWT)
curl http://localhost:3000/health
```

See **`PHASE1_TESTING.md`** for JWT + `POST /papers/:id/process` curl examples and parity testing.

See **`PHASE2_TESTING.md`** for question_bank persistence verification.

See **`PHASE2B_TESTING.md`** for chapter classification verification.

See **`PHASE3_TESTING.md`** for frontend integration (`VITE_USE_EXTRACTION_API`).

See **`OPENAI_USAGE_TRACKING.md`** for per-action token and cost monitoring.

### Railway deploy

1. Set **Root Directory** to `server`
2. Add env vars from `.env.example` (no `VITE_` prefix)
3. Uses `Dockerfile` + `railway.toml` (`@napi-rs/canvas` prebuilt binaries; no cairo apt packages)
4. Confirm deploy logs show `request.start` / `request.finish` with `requestId`

## Phase 0

- Database: run `db/supabase/migration_extraction_jobs.sql` in Supabase SQL editor, then re-run `db/supabase/policies.sql`.
- Railway: env vars from `.env.example` (same Supabase project as frontend).
