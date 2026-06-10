-- Create the Storage bucket for uploaded teaching files.
-- Run once in Supabase SQL editor (safe to re-run).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials',
  'materials',
  false,
  null,
  null
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'question-papers',
  'question-papers',
  false,
  null,
  null
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public;

-- After this, run policies.sql so authenticated users can upload under {userId}/...
