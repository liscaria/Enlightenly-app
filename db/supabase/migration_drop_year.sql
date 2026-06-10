-- Remove year from materials and questions (no longer used in the app).
-- Run once in Supabase SQL editor.

drop index if exists public.materials_year_idx;

alter table public.materials drop column if exists year;

alter table public.questions drop column if exists year;
