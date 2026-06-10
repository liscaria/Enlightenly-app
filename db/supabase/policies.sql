-- Row Level Security: each teacher only sees their own rows (owner_id = auth.uid()).
-- Run after schema.sql. Requires users to sign in before reading or writing data.

alter table public.classes   enable row level security;
alter table public.units     enable row level security;
alter table public.chapters  enable row level security;
alter table public.materials enable row level security;
alter table public.question_bank enable row level security;
alter table public.question_papers enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['classes','units','chapters','materials','question_bank','question_papers'])
  loop
    execute format('drop policy if exists "%I auth full" on public.%I', t, t);
    execute format('drop policy if exists "%I owner" on public.%I', t, t);
    execute format(
      'create policy "%I owner" on public.%I
         for all
         to authenticated
         using (owner_id = auth.uid())
         with check (owner_id = auth.uid())',
      t, t
    );
  end loop;
end $$;

-- Storage: object path must start with the signed-in user's id, e.g.
--   {userId}/class-xi/unit-1/chapter-1/lib-123-file.pdf
-- (split_part is more reliable than storage.foldername for RLS checks.)

drop policy if exists "materials storage read auth" on storage.objects;
create policy "materials storage read auth"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'materials'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "materials storage insert auth" on storage.objects;
create policy "materials storage insert auth"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'materials'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "materials storage update auth" on storage.objects;
create policy "materials storage update auth"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'materials'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'materials'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "materials storage delete auth" on storage.objects;
create policy "materials storage delete auth"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'materials'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- Question Bank papers bucket: question-papers

drop policy if exists "question papers storage read auth" on storage.objects;
create policy "question papers storage read auth"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'question-papers'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "question papers storage insert auth" on storage.objects;
create policy "question papers storage insert auth"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'question-papers'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "question papers storage update auth" on storage.objects;
create policy "question papers storage update auth"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'question-papers'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'question-papers'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "question papers storage delete auth" on storage.objects;
create policy "question papers storage delete auth"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'question-papers'
    and split_part(name, '/', 1) = auth.uid()::text
  );
