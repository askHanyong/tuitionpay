-- ============================================================
-- 041_manual_closeout_rpc.sql
-- Two RPC functions callable from the frontend:
--   create_manual_closeout_cycle(p_student_id) → uuid
--   delete_manual_closeout_cycle(p_cycle_id)   → void
--
-- Both are SECURITY DEFINER; ownership is enforced inside the
-- function body (v_tutor_id IS DISTINCT FROM auth.uid()) since
-- payment_cycles has no RLS and lessons/students are accessed
-- under the definer's role. Consistent with all other public
-- functions in this schema (no explicit GRANT needed — Supabase
-- applies the default anon/authenticated/service_role grants).
-- ============================================================


-- ------------------------------------------------------------
-- 1. create_manual_closeout_cycle
--
-- Bills all completed unlinked lessons for a per-lesson student
-- immediately, without waiting for the automatic N-group to fill.
-- Computes amount server-side; returns the new cycle's id.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_manual_closeout_cycle(p_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tutor_id     uuid;
  v_payment_mode text;
  v_hourly_rate  numeric(10, 2);
  v_cycle_id     uuid;
  v_period_start date;
  v_period_end   date;
  v_amount       numeric(10, 2);
  v_lesson_ids   uuid[];
BEGIN
  -- Ownership check: the student must belong to the calling user.
  SELECT tutor_id, payment_mode, hourly_rate
  INTO v_tutor_id, v_payment_mode, v_hourly_rate
  FROM students
  WHERE id = p_student_id;

  IF v_tutor_id IS NULL THEN
    RAISE EXCEPTION 'Student not found.';
  END IF;

  IF v_tutor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own this student.';
  END IF;

  -- Manual closeout only applies to per-lesson billing modes.
  IF v_payment_mode NOT IN ('lessons', 'per_lesson') THEN
    RAISE EXCEPTION
      'Manual closeout only applies to per-lesson billing students '
      '(this student uses % billing).', v_payment_mode;
  END IF;

  -- Collect completed unlinked lessons, ordered chronologically.
  SELECT ARRAY_AGG(id ORDER BY lesson_date, created_at)
  INTO v_lesson_ids
  FROM lessons
  WHERE student_id = p_student_id
    AND is_completed
    AND payment_cycle_id IS NULL;

  IF v_lesson_ids IS NULL OR ARRAY_LENGTH(v_lesson_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Nothing to bill: no completed lessons are waiting to be grouped.';
  END IF;

  -- Compute period bounds from the unlinked lessons.
  SELECT MIN(lesson_date), MAX(lesson_date)
  INTO v_period_start, v_period_end
  FROM lessons WHERE id = ANY(v_lesson_ids);

  -- Compute amount using the same rate_type logic as recompute_payment_cycles.
  -- Always derived server-side; never trusted from the client.
  SELECT COALESCE(SUM(
    CASE
      WHEN rate_type = 'per_session' THEN COALESCE(rate, v_hourly_rate, 0)
      ELSE (duration_minutes / 60.0) * COALESCE(rate, v_hourly_rate, 0)
    END
  ), 0)
  INTO v_amount
  FROM lessons WHERE id = ANY(v_lesson_ids);

  -- Insert the manual closeout cycle.
  INSERT INTO payment_cycles
    (tutor_id, student_id, period_start, period_end, amount_due,
     status, is_manual_closeout)
  VALUES
    (v_tutor_id, p_student_id, v_period_start, v_period_end, v_amount,
     'pending', TRUE)
  RETURNING id INTO v_cycle_id;

  -- Link the lessons to the new cycle.
  UPDATE lessons
  SET payment_cycle_id = v_cycle_id
  WHERE id = ANY(v_lesson_ids);

  RETURN v_cycle_id;
END;
$$;


-- ------------------------------------------------------------
-- 2. delete_manual_closeout_cycle
--
-- Undoes a pending manual closeout: unlinks its lessons, deletes
-- the cycle, and calls recompute_payment_cycles so the lessons
-- immediately re-enter automatic N-grouping.
-- Refuses to touch automatic cycles or already-paid cycles.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_manual_closeout_cycle(p_cycle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tutor_id   uuid;
  v_student_id uuid;
  v_manual     boolean;
  v_status     text;
BEGIN
  SELECT tutor_id, student_id, is_manual_closeout, status
  INTO v_tutor_id, v_student_id, v_manual, v_status
  FROM payment_cycles
  WHERE id = p_cycle_id;

  IF v_tutor_id IS NULL THEN
    RAISE EXCEPTION 'Cycle not found.';
  END IF;

  IF v_tutor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own this payment cycle.';
  END IF;

  IF NOT v_manual THEN
    RAISE EXCEPTION
      'This is an automatic payment cycle and cannot be deleted here. '
      'It will be removed automatically when lessons are edited.';
  END IF;

  IF v_status <> 'pending' THEN
    RAISE EXCEPTION
      'Cannot undo a % cycle. Only pending manual cycles can be deleted.',
      v_status;
  END IF;

  -- Unlink the lessons so they fall back into normal grouping.
  UPDATE lessons
  SET payment_cycle_id = NULL
  WHERE payment_cycle_id = p_cycle_id;

  -- Delete the cycle row.
  DELETE FROM payment_cycles WHERE id = p_cycle_id;

  -- Recompute so the unlinked lessons immediately re-enter automatic
  -- N-grouping rather than sitting orphaned until the next lesson edit.
  PERFORM recompute_payment_cycles(v_student_id, v_tutor_id);
END;
$$;
