-- Phase 4: question chapter classifications (source of truth for vector/override).
-- Safe to re-run.

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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'question_classifications_set_updated_at') then
    create trigger question_classifications_set_updated_at
      before update on public.question_classifications
      for each row execute function public.set_updated_at();
  end if;
end $$;
