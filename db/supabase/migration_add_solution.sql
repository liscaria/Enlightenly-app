-- Add solution column to question rows (safe to re-run).
-- The app uses public.question_bank (replaces legacy public.questions).

alter table public.question_bank
  add column if not exists solution text;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'questions'
  ) then
    execute 'alter table public.questions add column if not exists solution text';
  end if;
end $$;
