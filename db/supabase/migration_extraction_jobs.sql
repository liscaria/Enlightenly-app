-- Extraction jobs: async/server-side question-paper processing (Railway API).
-- Safe to re-run.

create table if not exists public.extraction_jobs (
  owner_id            uuid not null references auth.users(id) on delete cascade,
  id                  uuid primary key default gen_random_uuid(),
  question_paper_id   text not null,
  status              text not null default 'queued'
                        check (status in ('queued', 'running', 'completed', 'failed')),
  phase               text not null default 'queued'
                        check (phase in (
                          'queued',
                          'downloading',
                          'extracting',
                          'classifying',
                          'validating',
                          'saving',
                          'completed',
                          'failed'
                        )),
  extracted_by        text
                        check (extracted_by is null or extracted_by in ('ai', 'heuristic', 'none')),
  classified_by       text
                        check (classified_by is null or classified_by in ('vector', 'ai', 'heuristic', 'none')),
  question_count      integer,
  quality_report      jsonb,
  error               text,
  prompt_version      text,
  request_id          text,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (owner_id, question_paper_id)
    references public.question_papers(owner_id, id) on delete cascade
);

create index if not exists extraction_jobs_owner_paper_idx
  on public.extraction_jobs (owner_id, question_paper_id);

create index if not exists extraction_jobs_owner_status_idx
  on public.extraction_jobs (owner_id, status, created_at desc);

-- Optional cache on question_papers for list UI (quality badge without recompute).
alter table public.question_papers
  add column if not exists last_quality_report jsonb;

alter table public.question_papers
  add column if not exists last_extraction_job_id uuid;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'extraction_jobs_set_updated_at') then
    create trigger extraction_jobs_set_updated_at
      before update on public.extraction_jobs
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.extraction_jobs enable row level security;
