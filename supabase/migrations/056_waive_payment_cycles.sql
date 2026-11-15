-- ============================================================
-- 056_waive_payment_cycles.sql
--
-- Adds "write off" (waive) support to payment_cycles.
--
-- Changes:
--   1. Extend the status CHECK constraint to allow 'waived'.
--      Constraint name: payment_cycles_status_check
--   2. Add waived_at timestamptz — when the cycle was written off.
--   3. Add waived_from_status text — the status before waiving
--      ('pending' or 'overdue'), so Undo can restore the exact value.
--   4. Update recompute_payment_cycles so it never deletes, matches,
--      re-links or re-bills anything belonging to a waived cycle.
--      Only change vs 044: in the monthly/custom_date cycle-lookup
--      query, add AND status != 'waived' so a waived cycle for a given
--      month is never reused — a new pending cycle is inserted instead,
--      covering only the unlinked (new) lessons for that month.
--      Waived cycles' lessons retain payment_cycle_id pointing at the
--      waived cycle, so they never appear in the unlinked set and are
--      never re-billed.
-- ============================================================

BEGIN;

-- ── 1. Extend the status check constraint ────────────────────────────────────
ALTER TABLE public.payment_cycles
  DROP CONSTRAINT payment_cycles_status_check;

ALTER TABLE public.payment_cycles
  ADD CONSTRAINT payment_cycles_status_check
  CHECK (status IN ('pending', 'paid', 'overdue', 'waived'));

-- ── 2. waived_at ─────────────────────────────────────────────────────────────
ALTER TABLE public.payment_cycles
  ADD COLUMN IF NOT EXISTS waived_at timestamptz;

-- ── 3. waived_from_status ────────────────────────────────────────────────────
ALTER TABLE public.payment_cycles
  ADD COLUMN IF NOT EXISTS waived_from_status text
  CHECK (waived_from_status IN ('pending', 'overdue'));

-- ── 4. recompute_payment_cycles — add waived guard ───────────────────────────
-- Full function body. Identical to 044 except the monthly/custom_date
-- cycle-lookup query gains: AND status != 'waived'
-- (marked with <-- CHANGED in comment)
CREATE OR REPLACE FUNCTION public.recompute_payment_cycles(
  p_student_id uuid,
  p_tutor_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  v_owner          uuid;
BEGIN
  -- Ownership check (from 044).
  SELECT tutor_id INTO v_owner FROM students WHERE id = p_student_id;

  IF v_owner IS NOT NULL THEN
    IF p_tutor_id IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'Tutor does not own this student.';
    END IF;
    IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM v_owner THEN
      RAISE EXCEPTION 'You do not own this student.';
    END IF;
  END IF;

  SELECT hourly_rate, payment_mode, payment_cycle_count, payment_custom_day
  INTO v_hourly_rate, v_payment_mode, v_cycle_count, v_custom_day
  FROM students WHERE id = p_student_id;

  IF v_payment_mode IN ('lessons', 'per_lesson') THEN
    group_size := CASE
      WHEN v_payment_mode = 'per_lesson' THEN 1
      ELSE COALESCE(v_cycle_count, 4)
    END;

    -- Unlink lessons from pending cycles only. Waived cycles' lessons
    -- (payment_cycle_id pointing at a waived cycle) are intentionally
    -- left linked — they must never be re-billed.
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

    -- Unlink lessons from pending cycles only. Waived cycles' lessons
    -- are left linked so they are never included in month_rec.lesson_ids
    -- below and cannot be re-billed.
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

    -- month_rec.lesson_ids contains only unlinked lessons; waived cycles'
    -- lessons are not unlinked above, so they never appear here.
    FOR month_rec IN
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

      -- Look for an existing non-manual cycle in this month to update.
      -- Exclude waived cycles: a waived cycle for this month must not be
      -- reused. If only a waived cycle exists, cycle_id stays NULL and
      -- a new pending cycle is inserted for the unlinked lessons only.  <-- CHANGED
      SELECT id INTO cycle_id
      FROM payment_cycles
      WHERE student_id = p_student_id
        AND period_start >= month_rec.month_start
        AND period_start < (month_rec.month_start + INTERVAL '1 month')
        AND is_manual_closeout = FALSE
        AND status != 'waived'                                           -- <-- CHANGED
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

  DELETE FROM payment_cycles pc
  WHERE pc.student_id = p_student_id
    AND pc.status = 'pending'
    AND pc.is_manual_closeout = FALSE
    AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.payment_cycle_id = pc.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_payment_cycles(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_payment_cycles(uuid, uuid) TO authenticated, service_role;

COMMIT;
