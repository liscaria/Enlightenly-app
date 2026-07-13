-- OpenAI usage tracking: per-call events + job-level rollup on extraction_jobs.
-- Safe to re-run.

create table if not exists public.openai_usage_events (
  owner_id            uuid not null references auth.users(id) on delete cascade,
  id                  uuid primary key default gen_random_uuid(),
  action              text not null check (action in (
    'extract.text', 'extract.vision',
    'classify.vector', 'classify.llm',
    'syllabus.concepts', 'syllabus.embed'
  )),
  model               text not null,
  prompt_tokens       integer not null default 0,
  completion_tokens   integer not null default 0,
  total_tokens        integer not null default 0,
  estimated_cost_usd  numeric(12, 6) not null default 0,
  job_id              uuid references public.extraction_jobs(id) on delete set null,
  question_paper_id   text,
  request_id          text,
  metadata            jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists openai_usage_owner_created_idx
  on public.openai_usage_events (owner_id, created_at desc);

create index if not exists openai_usage_action_created_idx
  on public.openai_usage_events (action, created_at desc);

create index if not exists openai_usage_job_idx
  on public.openai_usage_events (job_id)
  where job_id is not null;

alter table public.extraction_jobs
  add column if not exists usage_summary jsonb;

alter table public.openai_usage_events enable row level security;
