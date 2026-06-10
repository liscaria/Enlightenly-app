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
| `material_id` or `question_paper_id` | Link back to the source file |

## Setup

1. Ensure `question_papers` table exists (`migration_question_papers.sql` or full `schema.sql`).
2. Run `migration_question_bank.sql` (replaces legacy `questions` table).
3. Re-run `policies.sql`.

## Populating rows

On upload, the app **automatically** tries to extract questions into `question_bank`:

1. **Chapter material** (Material type = Question papers) → rows get `chapter_id`, `chapter_name`, source Class work/Test, `year` null.
2. **Question Bank exam paper** → rows get `year`, source Final exam/Model exam/Others, and `chapter_id` / `chapter_name` when AI classifies against uploaded syllabus.

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
