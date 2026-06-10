-- Enlightenly teaching materials schema
-- Run this in the Supabase SQL editor.
-- All ids are TEXT so they match the ids the client app already generates
-- (e.g. "class-xi", "xii-unit-3", "lib-1737912345-abc").
--
-- Every row is scoped to one teacher via owner_id (= auth.users.id).

create extension if not exists "pgcrypto";

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
  question_no         integer,
  question_text       text not null,
  marks               numeric,
  solution            text,
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
end $$;
