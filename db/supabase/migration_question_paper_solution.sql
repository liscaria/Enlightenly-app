-- Optional solution PDF for a question paper (stored separately; not extracted yet).
alter table public.question_papers
  add column if not exists solution_storage_path text,
  add column if not exists solution_mime_type text;
