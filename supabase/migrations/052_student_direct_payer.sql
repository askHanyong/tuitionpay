-- ============================================================
-- 052_student_direct_payer.sql
-- Optional label for who pays the tutor directly for a student whose fees the
-- tutor collects (e.g. SSEC, Edulab). Used only to group the "paid directly to
-- you" section of an agency statement. Free text, additive, existing rows unaffected.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================
alter table public.students
  add column if not exists direct_payer text;
