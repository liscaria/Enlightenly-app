-- Question Bank: exam-level question papers table + storage bucket.
-- Run in Supabase SQL editor, then storage_bucket.sql (question-papers row) and policies.sql.

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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'question_papers_set_updated_at') then
    create trigger question_papers_set_updated_at
      before update on public.question_papers
      for each row execute function public.set_updated_at();
  end if;
end $$;
