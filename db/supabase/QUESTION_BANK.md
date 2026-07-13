# Question bank (`public.question_bank`)

One **row per question**, built from uploaded question-paper PDFs/files.

## Where questions come from

| Parent file | Storage bucket | Postgres parent table | `origin_type` | `source` values |
|-------------|----------------|----------------------|---------------|-----------------|
| Chapter question paper | `materials` | `materials` (type = Question papers) | `material` | Class work, Test |
| Exam question paper | `question-papers` | `question_papers` | `question_paper` | Final exam, Model exam, Others |

Files stay in Storage; `question_bank` stores extracted (or manual) question rows only.

## Row fields

| Column | Description |
|--------|-------------|
| `question_text` | Question body (required) |
| `marks` | Marks for this question |
| `source` | Class work · Test · Final exam · Model exam · Others |
| `year` | Set for exam papers; usually null for chapter materials |
| `chapter_id` / `chapter_name` | Set when from chapter material; null for exam papers |
| `solution` | Answer/solution text when available |
| `difficulty_level` | Teacher rating: `not Rated` (default), `Low`, `Medium`, `High` |
| `material_id` or `question_paper_id` | Link back to the source file |

## Setup

1. Ensure `question_papers` table exists (`migration_question_papers.sql` or full `schema.sql`).
2. Run `migration_question_bank.sql` (replaces legacy `questions` table).
3. Run `migration_difficulty_level.sql` for teacher difficulty ratings.
4. Run `migration_chapter_confidence.sql` for chapter classification confidence.
5. Run **`migration_syllabus_knowledge.sql`** for Phase 3 syllabus knowledge (requires `vector` / pgvector extension).
6. Run **`migration_question_classifications.sql`** for Phase 4 vector classification metadata.
7. Run **`migration_extraction_jobs.sql`** for Railway extraction job tracking (Phase 0).
8. Re-run `policies.sql`.

See **`PHASE0_SETUP.md`** for Railway env vars and **`server/PHASE1_TESTING.md`** for the extraction API (Phase 1).

## Syllabus knowledge (Phase 3)

When you upload a **Syllabus** PDF under a catalog chapter, the app extracts concepts and a summary, embeds them with OpenAI, and stores rows in:

| Table | Purpose |
|-------|---------|
| `syllabus_knowledge` | One row per chapter: summary, embeddings, build status |
| `chapter_concepts` | Named concepts with embeddings for vector search (Phase 4) |

Run `migration_syllabus_knowledge.sql` in the Supabase SQL editor before using this feature. Chapter status appears in the Materials UI under each chapter's Syllabus section.

## Question classification (Phase 4)

Exam questions are embedded and matched against Phase 3 syllabus knowledge (summaries + concept vectors). Each question gets a chapter assignment, confidence score (0–1), top-3 alternatives, and review status.

| Table | Purpose |
|-------|---------|
| `question_classifications` | Source of truth: confidence, alternatives, review status, source |
| `question_bank` | Denormalized chapter fields for display and search |

Run `migration_question_classifications.sql`, then re-run `policies.sql`. Click a chapter badge in the question table to view candidates or override. Overrides use `MANUAL_OVERRIDE` and are kept on re-classify.

## Populating rows

On upload, the app **automatically** tries to extract questions into `question_bank`:

1. **Chapter material** (Material type = Question papers) → rows get `chapter_id`, `chapter_name`, source Class work/Test, `year` null.
2. **Question Bank exam paper** → rows get `year`, source Final exam/Model exam/Others, and `chapter_id` / `chapter_name` when vector classification runs against Phase 3 syllabus knowledge (LLM fallback if no KB).

Extraction uses PDF/text parsing heuristics by default. For better results, set in `.env.local`:

```bash
VITE_OPENAI_API_KEY=sk-...
VITE_OPENAI_MODEL=gpt-4o-mini
```

Each extracted row includes `question_text`, `marks`, `solution` (when found), and `extracted_by` (`ai` or `heuristic`).

Manual/API population also works via:

- `questionBankRowsFromMaterial()` → `remoteUpsertQuestionBank()`
- `questionBankRowsFromQuestionPaper()` → `remoteUpsertQuestionBank()`

Or replace all questions for a file:

- `remoteReplaceQuestionBankForMaterial()`
- `remoteReplaceQuestionBankForQuestionPaper()`

Deleting a material or question paper row cascades to its `question_bank` rows.
