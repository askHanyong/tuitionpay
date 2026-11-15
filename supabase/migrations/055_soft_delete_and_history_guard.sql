-- ============================================================
-- 055_soft_delete_and_history_guard.sql
--
-- Three changes:
--   1. Formalise students.deleted_at  (column already exists live but
--      was added outside the migration system; ADD COLUMN IF NOT EXISTS
--      is a no-op on the live DB but brings the repo in sync).
--   2. Add lessons.student_name_snapshot so the monthly recap can show
--      a student's name even after the student row is soft-deleted.
--      Backfill existing rows from students.name.
--   3. Tighten the lessons and payment_cycles → students FK from
--      ON DELETE CASCADE to ON DELETE RESTRICT, so a true hard-delete
--      of a student who has any financial history is refused by Postgres.
--      (student_subjects, booking_links, booking_requests keep CASCADE —
--      those are operational records, not financial history.)
--
-- RLS: existing policies on lessons and payment_cycles use
-- "tutor_id = auth.uid()" with no archived/deleted filter — correct.
-- The tutor can read all their own data regardless of student status.
-- No RLS change needed.
-- ============================================================

-- ── 1. Formalise deleted_at ───────────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 2. Name snapshot on lessons ──────────────────────────────────────────────
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS student_name_snapshot text;

-- Backfill from current student names.
-- Future lesson inserts set this in the frontend (Step 3 of the fix).
UPDATE public.lessons l
SET    student_name_snapshot = s.name
FROM   public.students s
WHERE  l.student_id = s.id
  AND  l.student_name_snapshot IS NULL;

-- ── 3. lessons → students: CASCADE → RESTRICT ────────────────────────────────
ALTER TABLE public.lessons
  DROP CONSTRAINT IF EXISTS lessons_student_id_fkey;

ALTER TABLE public.lessons
  ADD CONSTRAINT lessons_student_id_fkey
  FOREIGN KEY (student_id)
  REFERENCES public.students(id)
  ON DELETE RESTRICT;

-- ── 4. payment_cycles → students: CASCADE → RESTRICT ─────────────────────────
ALTER TABLE public.payment_cycles
  DROP CONSTRAINT IF EXISTS payment_cycles_student_id_fkey;

ALTER TABLE public.payment_cycles
  ADD CONSTRAINT payment_cycles_student_id_fkey
  FOREIGN KEY (student_id)
  REFERENCES public.students(id)
  ON DELETE RESTRICT;
