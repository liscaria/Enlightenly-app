# Phase 1 — API testing

## Local setup

```bash
cd server
cp .env.example .env
# Fill SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY (same values as root .env.local, without VITE_ prefix)
npm install
npm run dev
```

**macOS:** `npm install` uses `@napi-rs/canvas` (prebuilt binaries). No Homebrew cairo deps needed.

Quick checks (no JWT needed):

```bash
npm run smoke
npm run smoke:health   # server must be running
npm run test:pdf-render # pdf.js canvasFactory vision path (no JWT)
```

Server runs at `http://localhost:3000`.

## Health check

```bash
curl http://localhost:3000/health
```

## Get a JWT

1. Log in to the React app at http://localhost:5173
2. Open DevTools → Application → Local Storage → find Supabase auth key, or Console:

```js
const key = Object.keys(localStorage).find(k => k.includes('auth-token'));
JSON.parse(localStorage.getItem(key)).access_token
```

## Process a paper

```bash
export TOKEN="your_access_token"
export PAPER_ID="your_question_paper_id"

# Option A: npm helper (server must be running)
cd server && TOKEN="$TOKEN" PAPER_ID="$PAPER_ID" npm run process-paper

# Option B: curl
curl -X POST "http://localhost:3000/papers/${PAPER_ID}/process" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json"
```

Response includes `jobId`, `qualityReport`, `questionCount`.

## Poll job

```bash
curl "http://localhost:3000/jobs/${JOB_ID}" \
  -H "Authorization: Bearer ${TOKEN}"
```

## Parity test (React vs API)

1. Run **Update question bank** in the app (flag off) on paper `55-3-1.pdf`
2. Note `question_bank` count + quality badge
3. Run `POST /papers/:id/process` for the same paper
4. Compare `qualityReport.extractedCount`, `expectedCount`, `missing`, `validationStatus`

## Railway

- Set **Root Directory** to `server`
- Uses `Dockerfile` for `node-canvas` system libs
- Verify logs show `request.start` / `request.finish` with `requestId`
