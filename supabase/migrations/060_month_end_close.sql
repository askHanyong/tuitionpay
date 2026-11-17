-- ============================================================
-- 060_month_end_close.sql
--
-- Month-end close.
--   1. month_closes          one row per tutor + month: the saved SNAPSHOT
--                            of that month's figures (computed in JS by
--                            src/lib/monthClose.js, never in SQL).
--   2. closed_month_changes  append-only change log: every money-relevant
--                            change to a lesson / payment notice that
--                            belongs to a CLOSED month, plus every
--                            close / reopen.
--   3. close_month() / reopen_month() RPCs — the ONLY way to write to
--      month_closes (no client INSERT/UPDATE/DELETE policies on purpose).
--   4. Two AFTER triggers (lessons, payment_cycles) that write the log.
--      They never block or change the original write.
--
-- Does NOT touch: recompute_payment_cycles, handle_lesson_change,
-- handle_lesson_insert, get_payment_summary, any agency_* table.
--
-- Requires migration 059 (students.is_practice) to be live.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ── 0. Precondition: 059 must be live ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'students'
      AND column_name  = 'is_practice'
  ) THEN
    RAISE EXCEPTION 'Stop: run migration 059 (students.is_practice) before 060.';
  END IF;
END $$;

-- ── 1. month_closes ──────────────────────────────────────────────────────────
CREATE TABLE public.month_closes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id      uuid NOT NULL REFERENCES public.tutors (id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  status        text NOT NULL DEFAULT 'closed'
                CHECK (status IN ('closed', 'reopened')),
  revision      integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  calc_version  integer NOT NULL,
  snapshot      jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  closed_at     timestamptz NOT NULL DEFAULT now(),
  reopened_at   timestamptz,
  reopen_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, month)
);

COMMENT ON TABLE public.month_closes IS
  'Month-end close. One row per tutor + month. snapshot = figures saved at close (built by src/lib/monthClose.js). Written only via close_month()/reopen_month().';
COMMENT ON COLUMN public.month_closes.month IS
  'First day of the month closed (Asia/Singapore calendar month).';
COMMENT ON COLUMN public.month_closes.status IS
  'closed = figures locked, changes are logged. reopened = tutor reopened it; snapshot kept for comparison until it is closed again.';
COMMENT ON COLUMN public.month_closes.revision IS
  '1 on first close, +1 every time the month is closed again after a reopen.';
COMMENT ON COLUMN public.month_closes.calc_version IS
  'CALC_VERSION of src/lib/monthClose.js that built the snapshot.';

-- ── 2. closed_month_changes (append-only log) ────────────────────────────────
CREATE TABLE public.closed_month_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id      uuid NOT NULL REFERENCES public.tutors (id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  entity_type   text NOT NULL
                CHECK (entity_type IN ('lesson', 'payment_cycle', 'month_close')),
  entity_id     uuid,
  action        text NOT NULL
                CHECK (action IN ('insert', 'update', 'delete', 'closed', 'reopened')),
  student_id    uuid,          -- no FK on purpose: the log must outlive edits
  student_name  text,          -- name at the time of the change
  old_values    jsonb,
  new_values    jsonb,
  amount_before numeric(10, 2),
  amount_after  numeric(10, 2),
  note          text,          -- reopen reason
  changed_by    uuid,          -- auth.uid(); NULL when run from the SQL editor
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX closed_month_changes_lookup_idx
  ON public.closed_month_changes (tutor_id, month, changed_at DESC);

COMMENT ON TABLE public.closed_month_changes IS
  'Append-only log of changes made to a closed month (lessons, payment notices) and of every close/reopen. Written only by triggers and the close/reopen RPCs.';
COMMENT ON COLUMN public.closed_month_changes.amount_before IS
  'lesson: the lesson''s gross fee counted in this month before the change (0 if it was not counted). payment_cycle: amount_due before. month_close: revenue in the previous snapshot.';
COMMENT ON COLUMN public.closed_month_changes.amount_after IS
  'Same meaning as amount_before, after the change.';

-- ── 3. RLS: read-only for the owning tutor; no client writes ─────────────────
ALTER TABLE public.month_closes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closed_month_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.month_closes         FROM anon, authenticated;
REVOKE ALL ON public.closed_month_changes FROM anon, authenticated;
GRANT SELECT ON public.month_closes         TO authenticated;
GRANT SELECT ON public.closed_month_changes TO authenticated;

CREATE POLICY "Tutors can view own month closes"
  ON public.month_closes FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors can view own closed month changes"
  ON public.closed_month_changes FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

-- Deliberately NO INSERT / UPDATE / DELETE policies on either table.
-- All writes go through the SECURITY DEFINER functions below, so a
-- snapshot or a log row cannot be edited or removed from the browser.

-- ── 4. close_month ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_month(p_month date, p_snapshot jsonb)
RETURNS public.month_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today_sgt date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_row       public.month_closes;
  v_old       jsonb;
  v_calc      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF p_month IS NULL OR EXTRACT(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be the first day of a month.';
  END IF;
  IF (p_month + INTERVAL '1 month')::date > v_today_sgt THEN
    RAISE EXCEPTION 'MONTH_NOT_OVER: this month is not over yet (Singapore time).';
  END IF;
  IF p_snapshot IS NULL
     OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot -> 'totals') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'calc_version') IS DISTINCT FROM 'number'
     OR (p_snapshot ->> 'month') IS DISTINCT FROM to_char(p_month, 'YYYY-MM') THEN
    RAISE EXCEPTION 'BAD_SNAPSHOT: snapshot is missing or does not match the month.';
  END IF;
  IF octet_length(p_snapshot::text) > 2000000 THEN
    RAISE EXCEPTION 'BAD_SNAPSHOT: snapshot is too large.';
  END IF;
  v_calc := (p_snapshot ->> 'calc_version')::integer;

  SELECT * INTO v_row
  FROM month_closes
  WHERE tutor_id = v_uid AND month = p_month
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.status = 'closed' THEN
      RAISE EXCEPTION 'MONTH_ALREADY_CLOSED: this month is already closed.';
    END IF;
    v_old := v_row.snapshot -> 'totals';
    UPDATE month_closes
    SET status       = 'closed',
        revision     = revision + 1,
        calc_version = v_calc,
        snapshot     = p_snapshot,
        closed_at    = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    BEGIN
      INSERT INTO month_closes (tutor_id, month, status, revision, calc_version, snapshot)
      VALUES (v_uid, p_month, 'closed', 1, v_calc, p_snapshot)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'MONTH_ALREADY_CLOSED: this month is already closed.';
    END;
  END IF;

  INSERT INTO closed_month_changes
    (tutor_id, month, entity_type, entity_id, action,
     old_values, new_values, amount_before, amount_after, changed_by)
  VALUES
    (v_uid, p_month, 'month_close', v_row.id, 'closed',
     v_old, p_snapshot -> 'totals',
     ROUND(COALESCE((v_old ->> 'revenue_cents')::numeric, 0) / 100, 2),
     ROUND(COALESCE((p_snapshot -> 'totals' ->> 'revenue_cents')::numeric, 0) / 100, 2),
     v_uid);

  RETURN v_row;
END;
$$;

-- ── 5. reopen_month ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_month(p_month date, p_reason text)
RETURNS public.month_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_row    public.month_closes;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: please say why you are reopening this month.';
  END IF;
  IF char_length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
  END IF;

  SELECT * INTO v_row
  FROM month_closes
  WHERE tutor_id = v_uid AND month = p_month
  FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'closed' THEN
    RAISE EXCEPTION 'MONTH_NOT_CLOSED: this month is not closed.';
  END IF;

  UPDATE month_closes
  SET status        = 'reopened',
      reopened_at   = now(),
      reopen_reason = v_reason
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO closed_month_changes
    (tutor_id, month, entity_type, entity_id, action,
     old_values, amount_before, amount_after, note, changed_by)
  VALUES
    (v_uid, p_month, 'month_close', v_row.id, 'reopened',
     v_row.snapshot -> 'totals',
     ROUND(COALESCE((v_row.snapshot -> 'totals' ->> 'revenue_cents')::numeric, 0) / 100, 2),
     NULL, v_reason, v_uid);

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_month(date, jsonb)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_month(date, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_month(date, jsonb)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reopen_month(date, text)  TO authenticated;

-- ── 6. Trigger: log lesson changes in a closed month ─────────────────────────
-- Fires only for money-relevant columns. payment_cycle_id re-linking done by
-- recompute_payment_cycles is NOT logged (it is not in the column list).
-- A lesson counts in a month only while is_completed is true; its amount uses
-- the same expression as recompute_payment_cycles.
-- Moving a lesson between months writes one row per closed month affected.
-- Practice students are skipped. The whole body is wrapped so a logging
-- problem can never block the tutor's lesson change.
CREATE OR REPLACE FUNCTION public.log_closed_month_lesson_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tutor      uuid;
  v_lesson     uuid;
  v_action     text := lower(TG_OP);
  v_old_month  date;
  v_new_month  date;
  v_old_amt    numeric(10, 2) := 0;
  v_new_amt    numeric(10, 2) := 0;
  v_old_vals   jsonb;
  v_new_vals   jsonb;
  v_old_sid    uuid;
  v_new_sid    uuid;
  v_old_name   text;
  v_new_name   text;
  v_rate       numeric;
  v_practice   boolean;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.lesson_date      IS NOT DISTINCT FROM OLD.lesson_date
         AND NEW.is_completed     IS NOT DISTINCT FROM OLD.is_completed
         AND NEW.student_id       IS NOT DISTINCT FROM OLD.student_id
         AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
         AND NEW.rate             IS NOT DISTINCT FROM OLD.rate
         AND NEW.rate_type        IS NOT DISTINCT FROM OLD.rate_type THEN
        RETURN NULL;
      END IF;
    END IF;

    -- Old side (UPDATE / DELETE)
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_tutor   := OLD.tutor_id;
      v_lesson  := OLD.id;
      v_old_sid := OLD.student_id;
      v_old_vals := jsonb_build_object(
        'lesson_date', OLD.lesson_date, 'is_completed', OLD.is_completed,
        'student_id', OLD.student_id, 'duration_minutes', OLD.duration_minutes,
        'rate', OLD.rate, 'rate_type', OLD.rate_type);
      IF COALESCE(OLD.is_completed, FALSE) THEN
        SELECT name, hourly_rate, COALESCE(is_practice, FALSE)
        INTO v_old_name, v_rate, v_practice
        FROM students WHERE id = OLD.student_id;
        IF NOT COALESCE(v_practice, FALSE) THEN
          v_old_month := date_trunc('month', OLD.lesson_date)::date;
          v_old_amt := ROUND((CASE
            WHEN OLD.rate_type = 'per_session' THEN COALESCE(OLD.rate, v_rate, 0)
            ELSE (OLD.duration_minutes / 60.0) * COALESCE(OLD.rate, v_rate, 0)
          END)::numeric, 2);
        END IF;
      END IF;
    END IF;

    -- New side (INSERT / UPDATE)
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_tutor   := NEW.tutor_id;
      v_lesson  := NEW.id;
      v_new_sid := NEW.student_id;
      v_new_vals := jsonb_build_object(
        'lesson_date', NEW.lesson_date, 'is_completed', NEW.is_completed,
        'student_id', NEW.student_id, 'duration_minutes', NEW.duration_minutes,
        'rate', NEW.rate, 'rate_type', NEW.rate_type);
      IF COALESCE(NEW.is_completed, FALSE) THEN
        v_rate := NULL; v_practice := NULL;
        SELECT name, hourly_rate, COALESCE(is_practice, FALSE)
        INTO v_new_name, v_rate, v_practice
        FROM students WHERE id = NEW.student_id;
        IF NOT COALESCE(v_practice, FALSE) THEN
          v_new_month := date_trunc('month', NEW.lesson_date)::date;
          v_new_amt := ROUND((CASE
            WHEN NEW.rate_type = 'per_session' THEN COALESCE(NEW.rate, v_rate, 0)
            ELSE (NEW.duration_minutes / 60.0) * COALESCE(NEW.rate, v_rate, 0)
          END)::numeric, 2);
        END IF;
      END IF;
    END IF;

    -- Not counted before and not counted after: nothing to log.
    IF v_old_month IS NULL AND v_new_month IS NULL THEN
      RETURN NULL;
    END IF;

    -- Tutor row gone (account being deleted): do not write log rows.
    IF NOT EXISTS (SELECT 1 FROM tutors WHERE id = v_tutor) THEN
      RETURN NULL;
    END IF;

    IF v_old_month IS NOT NULL AND v_new_month IS NOT NULL
       AND v_old_month = v_new_month THEN
      IF EXISTS (SELECT 1 FROM month_closes
                 WHERE tutor_id = v_tutor AND month = v_old_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_old_month, 'lesson', v_lesson, v_action, v_new_sid, v_new_name,
           v_old_vals, v_new_vals, v_old_amt, v_new_amt, auth.uid());
      END IF;
    ELSE
      IF v_old_month IS NOT NULL AND EXISTS (
           SELECT 1 FROM month_closes
           WHERE tutor_id = v_tutor AND month = v_old_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_old_month, 'lesson', v_lesson, v_action, v_old_sid, v_old_name,
           v_old_vals, v_new_vals, v_old_amt, 0, auth.uid());
      END IF;
      IF v_new_month IS NOT NULL AND EXISTS (
           SELECT 1 FROM month_closes
           WHERE tutor_id = v_tutor AND month = v_new_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_new_month, 'lesson', v_lesson, v_action, v_new_sid, v_new_name,
           v_old_vals, v_new_vals, 0, v_new_amt, auth.uid());
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_closed_month_lesson_change skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_closed_month_lesson ON public.lessons;
CREATE TRIGGER trg_log_closed_month_lesson
  AFTER INSERT OR DELETE
     OR UPDATE OF lesson_date, is_completed, student_id, duration_minutes, rate, rate_type
  ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.log_closed_month_lesson_change();

-- ── 7. Trigger: log payment-notice changes in a closed month ─────────────────
-- A notice belongs to the month of its period_end (same rule as the recap).
-- Logged: status or amount_due changes on any notice; creating or undoing a
-- MANUAL ("Bill now") notice. NOT logged: automatic notices being deleted and
-- re-created by recompute_payment_cycles (that is routine regrouping; the
-- lesson change that caused it is already logged by the trigger above).
CREATE OR REPLACE FUNCTION public.log_closed_month_cycle_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tutor    uuid;
  v_cycle    uuid;
  v_sid      uuid;
  v_month    date;
  v_before   numeric(10, 2);
  v_after    numeric(10, 2);
  v_old_vals jsonb;
  v_new_vals jsonb;
  v_name     text;
  v_practice boolean;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT NEW.is_manual_closeout THEN RETURN NULL; END IF;
      v_tutor := NEW.tutor_id; v_cycle := NEW.id; v_sid := NEW.student_id;
      v_month := date_trunc('month', NEW.period_end)::date;
      v_before := 0; v_after := NEW.amount_due;
    ELSIF TG_OP = 'DELETE' THEN
      IF NOT OLD.is_manual_closeout THEN RETURN NULL; END IF;
      v_tutor := OLD.tutor_id; v_cycle := OLD.id; v_sid := OLD.student_id;
      v_month := date_trunc('month', OLD.period_end)::date;
      v_before := OLD.amount_due; v_after := 0;
    ELSE
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.amount_due IS NOT DISTINCT FROM OLD.amount_due THEN
        RETURN NULL;
      END IF;
      v_tutor := OLD.tutor_id; v_cycle := OLD.id; v_sid := OLD.student_id;
      v_month := date_trunc('month', OLD.period_end)::date;
      v_before := OLD.amount_due; v_after := NEW.amount_due;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_old_vals := jsonb_build_object(
        'status', OLD.status, 'amount_due', OLD.amount_due,
        'paid_at', OLD.paid_at, 'waived_at', OLD.waived_at,
        'period_start', OLD.period_start, 'period_end', OLD.period_end,
        'is_manual_closeout', OLD.is_manual_closeout);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_new_vals := jsonb_build_object(
        'status', NEW.status, 'amount_due', NEW.amount_due,
        'paid_at', NEW.paid_at, 'waived_at', NEW.waived_at,
        'period_start', NEW.period_start, 'period_end', NEW.period_end,
        'is_manual_closeout', NEW.is_manual_closeout);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM month_closes
                   WHERE tutor_id = v_tutor AND month = v_month AND status = 'closed') THEN
      RETURN NULL;
    END IF;

    SELECT name, COALESCE(is_practice, FALSE) INTO v_name, v_practice
    FROM students WHERE id = v_sid;
    IF COALESCE(v_practice, FALSE) THEN
      RETURN NULL;
    END IF;

    INSERT INTO closed_month_changes
      (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
       old_values, new_values, amount_before, amount_after, changed_by)
    VALUES
      (v_tutor, v_month, 'payment_cycle', v_cycle, lower(TG_OP), v_sid, v_name,
       v_old_vals, v_new_vals, v_before, v_after, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_closed_month_cycle_change skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_closed_month_cycle ON public.payment_cycles;
CREATE TRIGGER trg_log_closed_month_cycle
  AFTER INSERT OR DELETE OR UPDATE OF status, amount_due
  ON public.payment_cycles
  FOR EACH ROW EXECUTE FUNCTION public.log_closed_month_cycle_change();

REVOKE EXECUTE ON FUNCTION public.log_closed_month_lesson_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_closed_month_cycle_change()  FROM PUBLIC, anon, authenticated;

COMMIT;
