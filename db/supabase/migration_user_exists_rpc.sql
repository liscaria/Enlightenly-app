-- Lets the sign-in page check whether an email is already registered.
-- Run once in Supabase → SQL Editor.

create or replace function public.user_exists_by_email(check_email text)
returns boolean
language sql
security definer
stable
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users
    where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.user_exists_by_email(text) from public;
grant execute on function public.user_exists_by_email(text) to anon, authenticated;
