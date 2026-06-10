-- Question papers: Class work | Test (replaces Class test | Public exam).
-- Run in Supabase SQL editor on projects that already have the old check constraint.

update public.materials
set exam_source = 'Class work'
where exam_source in ('Class test', 'Public exam');

update public.questions
set exam_source = 'Class work'
where exam_source in ('Class test', 'Public exam');

alter table public.materials drop constraint if exists materials_exam_source_check;
alter table public.materials
  add constraint materials_exam_source_check
  check (exam_source is null or exam_source in ('Class work', 'Test'));

alter table public.questions drop constraint if exists questions_exam_source_check;
alter table public.questions
  add constraint questions_exam_source_check
  check (exam_source is null or exam_source in ('Class work', 'Test'));
