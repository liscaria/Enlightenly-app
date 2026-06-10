-- Unified question bank (replaces legacy public.questions).
-- One row per question from materials (Question papers) or question_papers uploads.
-- Run once in Supabase SQL editor.

drop table if exists public.questions cascade;

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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'question_bank_set_updated_at') then
    create trigger question_bank_set_updated_at
      before update on public.question_bank
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- Re-run policies.sql so question_bank gets RLS (and questions policy is dropped).
