-- ============================================================
-- 042_bill_now_monthly.sql
-- Extends "Bill now" (manual closeout) to monthly and
-- custom_date students by fixing two functions:
--
-- 1. recompute_payment_cycles: the monthly/custom_date branch
--    now respects is_manual_closeout just like the per-lesson
--    branch did after migration 040.
--
-- 2. create_manual_closeout_cycle: removes the mode restriction;
--    now accepts all four payment modes.
-- ============================================================

DROP FUNCTION IF EXISTS recompute_payment_cycles(uuid, uuid);

CREATE FUNCTION recompute_payment_cycles(
  p_student_id uuid,
  p_tutor_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_hourly_rate    numeric(10, 2);
  v_payment_mode   text;
  v_cycle_count    integer;
  v_custom_day     integer;
  group_size       integer;
  i                integer;
  cycle_id         uuid;
  chunk_lesson_ids uuid[];
  v_period_start   date;
  v_period_end     date;
  v_amount         numeric(10, 2);
  month_rec        record;
  v_due_date       date;
  v_today          date := current_date;
  unlinked_ids     uuid[];
  total_unlinked   integer;
  num_new_groups   integer;
BEGIN
  SELECT hourly_rate, payment_mode, payment_cycle_count, payment_custom_day
  INTO v_hourly_rate, v_payment_mode, v_cycle_count, v_custom_day
  FROM students WHERE id = p_student_id;

  IF v_payment_mode IN ('lessons', 'per_lesson') THEN
    -- [UNCHANGED from migration 040 — per-lesson branch already handles
    --  is_manual_closeout correctly.]
    group_size := CASE
      WHEN v_payment_mode = 'per_lesson' THEN 1
      ELSE COALESCE(v_cycle_count, 4)
    END;

    UPDATE lessons SET payment_cycle_id = NULL
    WHERE student_id = p_student_id
      AND (
        payment_cycle_id IS NULL
        OR payment_cycle_id IN (
          SELECT id FROM payment_cycles
          WHERE student_id = p_student_id
            AND is_manual_closeout = FALSE
            AND status = 'pending'
        )
      );

    DELETE FROM payment_cycles
    WHERE student_id = p_student_id
      AND is_manual_closeout = FALSE
      AND status = 'pending';

    SELECT ARRAY_AGG(id ORDER BY lesson_date, created_at)
    INTO unlinked_ids
    FROM lessons
    WHERE student_id = p_student_id
      AND is_completed
      AND payment_cycle_id IS NULL;

    total_unlinked := COALESCE(ARRAY_LENGTH(unlinked_ids, 1), 0);
    num_new_groups := total_unlinked / group_size;

    FOR i IN 1..num_new_groups LOOP
      chunk_lesson_ids := unlinked_ids[((i-1)*group_size + 1) : (i*group_size)];

      SELECT MIN(lesson_date), MAX(lesson_date)
      INTO v_period_start, v_period_end
      FROM lessons WHERE id = ANY(chunk_lesson_ids);

      SELECT COALESCE(SUM(
        CASE
          WHEN rate_type = 'per_session' THEN COALESCE(rate, v_hourly_rate, 0)
          ELSE (duration_minutes / 60.0) * COALESCE(rate, v_hourly_rate, 0)
        END
      ), 0)
      INTO v_amount
      FROM lessons WHERE id = ANY(chunk_lesson_ids);

      INSERT INTO payment_cycles
        (tutor_id, student_id, period_start, period_end, amount_due, status)
      VALUES
        (p_tutor_id, p_student_id, v_period_start, v_period_end, v_amount, 'pending')
      RETURNING id INTO cycle_id;

      UPDATE lessons SET payment_cycle_id = cycle_id
      WHERE id = ANY(chunk_lesson_ids);
    END LOOP;

  ELSIF v_payment_mode IN ('monthly', 'custom_date') THEN

    -- FIX 1: Wipe only lessons linked to pending NON-manual cycles.
    -- Lessons locked into a manual closeout cycle are left untouched.
    UPDATE lessons SET payment_cycle_id = NULL
    WHERE student_id = p_student_id
      AND (
        payment_cycle_id IS NULL
        OR payment_cycle_id IN (
          SELECT id FROM payment_cycles
          WHERE student_id = p_student_id
            AND is_manual_closeout = FALSE
            AND status = 'pending'
        )
      );

    -- Delete the now-empty pending non-manual cycles.
    DELETE FROM payment_cycles
    WHERE student_id = p_student_id
      AND is_manual_closeout = FALSE
      AND status = 'pending';

    FOR month_rec IN
      -- FIX 2: Only consider lessons not already in a manual cycle
      -- (payment_cycle_id IS NULL after the wipe above means they
      --  were either unlinked or in a pending non-manual cycle that
      --  we just deleted).
      SELECT DATE_TRUNC('month', lesson_date)::date AS month_start,
             ARRAY_AGG(id ORDER BY lesson_date, created_at) AS lesson_ids
      FROM lessons
      WHERE student_id = p_student_id
        AND is_completed
        AND payment_cycle_id IS NULL
      GROUP BY DATE_TRUNC('month', lesson_date)
      ORDER BY month_start
    LOOP
      IF v_payment_mode = 'monthly' THEN
        v_due_date := (month_rec.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
      ELSE
        v_due_date := LEAST(
          (month_rec.month_start + ((COALESCE(v_custom_day, 1) - 1) || ' days')::interval)::date,
          (month_rec.month_start + INTERVAL '1 month' - INTERVAL '1 day')::date
        );
      END IF;

      IF v_today < v_due_date THEN CONTINUE; END IF;

      v_period_start := month_rec.month_start;

      SELECT COALESCE(SUM(
        CASE
          WHEN rate_type = 'per_session' THEN COALESCE(rate, v_hourly_rate, 0)
          ELSE (duration_minutes / 60.0) * COALESCE(rate, v_hourly_rate, 0)
        END
      ), 0)
      INTO v_amount
      FROM lessons WHERE id = ANY(month_rec.lesson_ids);

      -- FIX 3: Never reuse a manual cycle as the "existing cycle" for
      -- this month. Only match pending non-manual cycles.
      SELECT id INTO cycle_id
      FROM payment_cycles
      WHERE student_id = p_student_id
        AND period_start >= month_rec.month_start
        AND period_start < (month_rec.month_start + INTERVAL '1 month')
        AND is_manual_closeout = FALSE
      ORDER BY created_at
      LIMIT 1;

      IF cycle_id IS NOT NULL THEN
        UPDATE payment_cycles
        SET period_start = v_period_start,
            period_end   = v_due_date,
            amount_due   = CASE WHEN status = 'pending' THEN v_amount ELSE amount_due END
        WHERE id = cycle_id;
      ELSE
        INSERT INTO payment_cycles
          (tutor_id, student_id, period_start, period_end, amount_due, status)
        VALUES
          (p_tutor_id, p_student_id, v_period_start, v_due_date, v_amount, 'pending')
        RETURNING id INTO cycle_id;
      END IF;

      UPDATE lessons SET payment_cycle_id = cycle_id
      WHERE id = ANY(month_rec.lesson_ids);
    END LOOP;
  END IF;

  -- Clean up any pending non-manual cycle left with no lessons attached.
  DELETE FROM payment_cycles pc
  WHERE pc.student_id = p_student_id
    AND pc.status = 'pending'
    AND pc.is_manual_closeout = FALSE
    AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.payment_cycle_id = pc.id);
END;
$$;


-- ------------------------------------------------------------
-- Fix create_manual_closeout_cycle: allow all four modes.
-- For monthly/custom_date the period is MIN–MAX of the unlinked
-- lessons (same as per_lesson). A partial October bill will have
-- period_start = first lesson date, period_end = last lesson date.
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

  -- Removed: the mode restriction that blocked monthly/custom_date.
  -- All four modes are now accepted.

  SELECT ARRAY_AGG(id ORDER BY lesson_date, created_at)
  INTO v_lesson_ids
  FROM lessons
  WHERE student_id = p_student_id
    AND is_completed
    AND payment_cycle_id IS NULL;

  IF v_lesson_ids IS NULL OR ARRAY_LENGTH(v_lesson_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Nothing to bill: no completed lessons are waiting to be grouped.';
  END IF;

  SELECT MIN(lesson_date), MAX(lesson_date)
  INTO v_period_start, v_period_end
  FROM lessons WHERE id = ANY(v_lesson_ids);

  SELECT COALESCE(SUM(
    CASE
      WHEN rate_type = 'per_session' THEN COALESCE(rate, v_hourly_rate, 0)
      ELSE (duration_minutes / 60.0) * COALESCE(rate, v_hourly_rate, 0)
    END
  ), 0)
  INTO v_amount
  FROM lessons WHERE id = ANY(v_lesson_ids);

  INSERT INTO payment_cycles
    (tutor_id, student_id, period_start, period_end, amount_due,
     status, is_manual_closeout)
  VALUES
    (v_tutor_id, p_student_id, v_period_start, v_period_end, v_amount,
     'pending', TRUE)
  RETURNING id INTO v_cycle_id;

  UPDATE lessons
  SET payment_cycle_id = v_cycle_id
  WHERE id = ANY(v_lesson_ids);

  RETURN v_cycle_id;
END;
$$;