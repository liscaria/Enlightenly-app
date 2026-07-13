-- Enlightenly teaching materials schema
-- Run this in the Supabase SQL editor.
-- All ids are TEXT so they match the ids the client app already generates
-- (e.g. "class-xi", "xii-unit-3", "lib-1737912345-abc").
--
-- Every row is scoped to one teacher via owner_id (= auth.users.id).

create extension if not exists "pgcrypto";
create extension if not exists vector;

------------------------------------------------------------------
-- Catalog: classes / units / chapters
------------------------------------------------------------------

create table if not exists public.classes (
  owner_id    uuid not null references auth.users(id) on delete cascade,
  id          text not null,
  name        text not null,
  position    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner_id, id)
);
create index if not exists classes_owner_idx on public.classes (owner_id);

create table if not exists public.units (
  owner_id    uuid not null references auth.users(id) on delete cascade,
  id          text not null,
  class_id    text not null,
  name        text not null,
  title       text,
  marks       integer,
  position    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade
);
create index if not exists units_owner_class_idx on public.units (owner_id, class_id);

create table if not exists public.chapters (
  owner_id    uuid not null references auth.users(id) on delete cascade,
  id          text not null,
  unit_id     text not null,
  class_id    text not null,
  name        text not null,
  position    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, unit_id) references public.units(owner_id, id) on delete cascade,
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade
);
create index if not exists chapters_owner_unit_idx on public.chapters (owner_id, unit_id);
create index if not exists chapters_owner_class_idx on public.chapters (owner_id, class_id);

------------------------------------------------------------------
-- Materials: one row per uploaded file (PDF / image / etc.)
-- The actual bytes live in Supabase Storage; we only keep the
-- bucket + path here.
------------------------------------------------------------------

create table if not exists public.materials (
  owner_id        uuid not null references auth.users(id) on delete cascade,
  id              text not null,
  chapter_id      text not null,
  unit_id         text not null,
  class_id        text not null,
  name            text not null,
  material_type   text not null
                    check (material_type in ('Question papers', 'Class Notes', 'Syllabus')),
  file_type       text,
  mime_type       text,
  source_kind     text check (source_kind in ('local', 'drive', 'other')),
  source_origin   text,
  storage_bucket  text,
  storage_path    text,
  exam_source     text check (exam_source in ('Class work', 'Test')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, chapter_id) references public.chapters(owner_id, id) on delete cascade,
  foreign key (owner_id, unit_id) references public.units(owner_id, id) on delete cascade,
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade
);
create index if not exists materials_owner_chapter_idx on public.materials (owner_id, chapter_id);
create index if not exists materials_owner_unit_idx on public.materials (owner_id, unit_id);
create index if not exists materials_owner_class_idx on public.materials (owner_id, class_id);
create index if not exists materials_material_type_idx on public.materials (material_type);
create index if not exists materials_exam_source_idx on public.materials (exam_source);

------------------------------------------------------------------
-- Question papers: exam-level papers for the Question Bank (by class, not chapter)
------------------------------------------------------------------

create table if not exists public.question_papers (
  owner_id        uuid not null references auth.users(id) on delete cascade,
  id              text not null,
  class_id        text not null,
  name            text not null,
  paper_source    text not null
                    check (paper_source in ('Final exam', 'Model exam', 'Others')),
  year            integer not null,
  file_type       text,
  mime_type       text,
  source_kind     text check (source_kind in ('local', 'drive', 'other')),
  source_origin   text,
  storage_bucket  text,
  storage_path    text,
  solution_storage_path text,
  solution_mime_type    text,
  last_quality_report   jsonb,
  last_extraction_job_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade
);
create index if not exists question_papers_owner_class_idx on public.question_papers (owner_id, class_id);
create index if not exists question_papers_year_idx on public.question_papers (year);
create index if not exists question_papers_source_idx on public.question_papers (paper_source);

------------------------------------------------------------------
-- Question bank: one row per question (from materials or exam question papers).
-- Populated when AI/manual extraction runs on files in `materials` or
-- `question-papers` storage buckets.
------------------------------------------------------------------

create table if not exists public.question_bank (
  owner_id            uuid not null references auth.users(id) on delete cascade,
  id                  uuid primary key default gen_random_uuid(),
  origin_type         text not null
                        check (origin_type in ('material', 'question_paper')),
  material_id         text,
  question_paper_id   text,
  class_id            text not null,
  unit_id             text,
  chapter_id          text,
  chapter_name        text,
  chapter_confidence  integer
                        check (chapter_confidence is null or (chapter_confidence >= 0 and chapter_confidence <= 100)),
  question_no         integer,
  question_text       text not null,
  marks               numeric,
  solution            text,
  difficulty_level    text not null default 'not Rated'
                        check (difficulty_level in ('not Rated', 'Low', 'Medium', 'High')),
  source              text not null
                        check (source in (
                          'Class work', 'Test',
                          'Final exam', 'Model exam', 'Others'
                        )),
  year                integer,
  topic               text,
  extracted_by        text not null default 'manual',
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint question_bank_origin_check check (
    (origin_type = 'material' and material_id is not null and question_paper_id is null)
    or (origin_type = 'question_paper' and question_paper_id is not null and material_id is null)
  ),
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade,
  foreign key (owner_id, material_id) references public.materials(owner_id, id) on delete cascade,
  foreign key (owner_id, question_paper_id) references public.question_papers(owner_id, id) on delete cascade,
  foreign key (owner_id, unit_id) references public.units(owner_id, id) on delete cascade,
  foreign key (owner_id, chapter_id) references public.chapters(owner_id, id) on delete cascade
);
create index if not exists question_bank_owner_class_idx on public.question_bank (owner_id, class_id);
create index if not exists question_bank_owner_source_idx on public.question_bank (owner_id, source);
create index if not exists question_bank_owner_year_idx on public.question_bank (owner_id, year);
create index if not exists question_bank_owner_chapter_idx on public.question_bank (owner_id, chapter_id);
create index if not exists question_bank_material_idx on public.question_bank (owner_id, material_id)
  where material_id is not null;
create index if not exists question_bank_question_paper_idx on public.question_bank (owner_id, question_paper_id)
  where question_paper_id is not null;

------------------------------------------------------------------
-- Syllabus knowledge: concepts + embeddings per catalog chapter
------------------------------------------------------------------

create table if not exists public.syllabus_knowledge (
  owner_id            uuid not null references auth.users(id) on delete cascade,
  id                  uuid primary key default gen_random_uuid(),
  class_id            text not null,
  unit_id             text not null,
  chapter_id          text not null,
  material_id         text,
  chapter_name        text not null,
  summary             text,
  title_embedding     vector(1536),
  summary_embedding   vector(1536),
  extract_status      text not null default 'pending'
                        check (extract_status in ('pending', 'complete', 'failed')),
  extract_error       text,
  mismatch_warning    boolean not null default false,
  concept_count       integer not null default 0,
  extracted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (owner_id, chapter_id),
  foreign key (owner_id, class_id) references public.classes(owner_id, id) on delete cascade,
  foreign key (owner_id, unit_id) references public.units(owner_id, id) on delete cascade,
  foreign key (owner_id, chapter_id) references public.chapters(owner_id, id) on delete cascade,
  foreign key (owner_id, material_id) references public.materials(owner_id, id) on delete set null
);
create index if not exists syllabus_knowledge_owner_class_idx
  on public.syllabus_knowledge (owner_id, class_id);

create table if not exists public.chapter_concepts (
  owner_id              uuid not null references auth.users(id) on delete cascade,
  id                    uuid primary key default gen_random_uuid(),
  chapter_id            text not null,
  syllabus_knowledge_id uuid not null references public.syllabus_knowledge(id) on delete cascade,
  concept_name          text not null,
  concept_embedding     vector(1536),
  position              integer not null default 0,
  created_at            timestamptz not null default now(),
  foreign key (owner_id, chapter_id) references public.chapters(owner_id, id) on delete cascade
);
create index if not exists chapter_concepts_knowledge_idx
  on public.chapter_concepts (syllabus_knowledge_id);
create index if not exists chapter_concepts_owner_chapter_idx
  on public.chapter_concepts (owner_id, chapter_id);
create index if not exists chapter_concepts_embedding_hnsw_idx
  on public.chapter_concepts using hnsw (concept_embedding vector_cosine_ops);
create index if not exists syllabus_knowledge_summary_hnsw_idx
  on public.syllabus_knowledge using hnsw (summary_embedding vector_cosine_ops);

------------------------------------------------------------------
-- Question classifications: vector / override metadata per question
------------------------------------------------------------------

create table if not exists public.question_classifications (
  owner_id              uuid not null references auth.users(id) on delete cascade,
  id                    uuid primary key default gen_random_uuid(),
  question_id           uuid not null references public.question_bank(id) on delete cascade,
  chapter_id            text not null,
  confidence            numeric(4, 3) not null
                          check (confidence >= 0 and confidence <= 1),
  alternatives          jsonb not null default '[]'::jsonb,
  review_status         text not null
                          check (review_status in (
                            'AUTO_APPROVED',
                            'SUGGEST_REVIEW',
                            'MANUAL_REVIEW_REQUIRED'
                          )),
  classification_source text not null
                          check (classification_source in (
                            'VECTOR',
                            'AI_RERANK',
                            'MANUAL_OVERRIDE',
                            'HEURISTIC_FALLBACK'
                          )),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (owner_id, question_id),
  foreign key (owner_id, chapter_id) references public.chapters(owner_id, id) on delete cascade
);
create index if not exists question_classifications_owner_question_idx
  on public.question_classifications (owner_id, question_id);
create index if not exists question_classifications_owner_chapter_idx
  on public.question_classifications (owner_id, chapter_id);

------------------------------------------------------------------
-- Extraction jobs: server-side paper processing (Railway API)
------------------------------------------------------------------

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
  usage_summary       jsonb,
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

------------------------------------------------------------------
-- OpenAI usage events (per API call; aggregated on extraction_jobs.usage_summary)
------------------------------------------------------------------

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

------------------------------------------------------------------
-- updated_at triggers
------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'classes_set_updated_at') then
    create trigger classes_set_updated_at  before update on public.classes  for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'units_set_updated_at') then
    create trigger units_set_updated_at    before update on public.units    for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'chapters_set_updated_at') then
    create trigger chapters_set_updated_at before update on public.chapters for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'materials_set_updated_at') then
    create trigger materials_set_updated_at before update on public.materials for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'question_bank_set_updated_at') then
    create trigger question_bank_set_updated_at before update on public.question_bank for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'question_papers_set_updated_at') then
    create trigger question_papers_set_updated_at before update on public.question_papers for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'syllabus_knowledge_set_updated_at') then
    create trigger syllabus_knowledge_set_updated_at before update on public.syllabus_knowledge for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'question_classifications_set_updated_at') then
    create trigger question_classifications_set_updated_at before update on public.question_classifications for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'extraction_jobs_set_updated_at') then
    create trigger extraction_jobs_set_updated_at before update on public.extraction_jobs for each row execute function public.set_updated_at();
  end if;
end $$;
