-- ============================================================
-- 048_add_guardian_relationship.sql
-- Adds an optional relationship label for the parent/guardian
-- (Mother, Father, Guardian, Other) next to the existing
-- guardian_name and guardian_contact columns on students.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================
alter table public.students
  add column if not exists guardian_relationship text;

alter table public.students
  add constraint students_guardian_relationship_check
  check (guardian_relationship is null
         or guardian_relationship in ('mother','father','guardian','other'));
