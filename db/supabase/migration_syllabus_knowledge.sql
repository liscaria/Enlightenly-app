-- Phase 3: Syllabus knowledge base (concepts + embeddings per catalog chapter).
-- Run in Supabase SQL editor before using syllabus knowledge features.
-- Safe to re-run.

create extension if not exists vector;

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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'syllabus_knowledge_set_updated_at') then
    create trigger syllabus_knowledge_set_updated_at
      before update on public.syllabus_knowledge
      for each row execute function public.set_updated_at();
  end if;
end $$;
