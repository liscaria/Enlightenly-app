-- AI chapter classification confidence (0–100) per question.
-- Safe to re-run.

alter table public.question_bank
  add column if not exists chapter_confidence integer;

alter table public.question_bank
  drop constraint if exists question_bank_chapter_confidence_check;

alter table public.question_bank
  add constraint question_bank_chapter_confidence_check
  check (chapter_confidence is null or (chapter_confidence >= 0 and chapter_confidence <= 100));
