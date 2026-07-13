-- Teacher difficulty rating per question (Low / Medium / High).
-- Safe to re-run.

alter table public.question_bank
  add column if not exists difficulty_level text not null default 'not Rated';

alter table public.question_bank
  drop constraint if exists question_bank_difficulty_level_check;

alter table public.question_bank
  add constraint question_bank_difficulty_level_check
  check (difficulty_level in ('not Rated', 'Low', 'Medium', 'High'));
