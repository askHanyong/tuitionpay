-- ============================================================
-- 040_manual_closeout_cycles.sql
-- Adds "Bill now" (manual closeout) support for per_lesson-mode
-- students. A manually closed cycle locks its lessons out of
-- future automatic N-grouping, so the count restarts cleanly
-- from the next unlinked lesson.
--
-- Additive only. Does NOT change behaviour for monthly/custom_date
-- students or any existing automatic (non-manual) cycles.
-- ============================================================

-- ------------------------------------------------------------
-- Part A: Add is_manual_closeout column to payment_cycles
--
-- Default false: all existing rows are unaffected. The column is
-- only ever set true by the create_manual_closeout_cycle function
-- (to be added in a later step). Never set by application code
-- directly.
-- ------------------------------------------------------------
ALTER TABLE payment_cycles
  ADD COLUMN IF NOT EXISTS is_manual_closeout boolean NOT NULL DEFAULT false;

-- ------------------------------------------------------------
-- Part B: Replace recompute_payment_cycles
--
-- Dropped first because CREATE OR REPLACE cannot change parameter
-- names; the existing signature was (p_student_id, p_tutor_id).
--
-- Per_lesson/lessons path changes:
--   - Wipe step now skips lessons already locked into a manual-
--     closeout cycle, leaving those links intact.
--   - Pending non-manual cycles are deleted and recreated fresh
--     rather than reused by position index.
--   - Only unlinked completed lessons are counted for N-grouping,
--     so manual-closeout lessons are invisible to the auto-count
--     and future lessons start a fresh N-count from position 1.
--   - Cleanup at the end also filters on is_manual_closeout = FALSE
--     so it never deletes manual cycles.
--
-- Monthly/custom_date path: byte-for-byte identical to pre-040.
-- ------------------------------------------------------------
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
    group_size := CASE
      WHEN v_payment_mode = 'per_lesson' THEN 1
      ELSE COALESCE(v_cycle_count, 4)
    END;

    -- Wipe only lessons linked to pending non-manual cycles (safe to rebuild).
    -- Lessons locked into manual-closeout cycles are left untouched.
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

    -- Collect completed lessons still unlinked (not in any manual cycle),
    -- ordered chronologically.
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
    -- Monthly/custom_date path: unchanged from pre-040 behaviour.
    UPDATE lessons SET payment_cycle_id = NULL
    WHERE student_id = p_student_id;

    FOR month_rec IN
      SELECT DATE_TRUNC('month', lesson_date)::date AS month_start,
             ARRAY_AGG(id ORDER BY lesson_date, created_at) AS lesson_ids
      FROM lessons
      WHERE student_id = p_student_id AND is_completed
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

      SELECT id INTO cycle_id
      FROM payment_cycles
      WHERE student_id = p_student_id
        AND period_start >= month_rec.month_start
        AND period_start < (month_rec.month_start + INTERVAL '1 month')
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
