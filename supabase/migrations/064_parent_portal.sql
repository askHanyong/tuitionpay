-- ============================================================
-- 064_parent_portal.sql
-- Parent portal (Pay / Progress / Book behind one private link).
-- Progress data is NOT in this migration: it comes from
-- get_progress_summary() in migration 061 (docs/specs/done-to-parent-report.md).
--
--  1. students: portal settings + unique index on payment_token
--     (the existing /pay token becomes the single parent-link token).
--  2. payment_claims: "parent says they've paid" records. Keyed on the
--     STUDENT, never on a payment_cycles.id, because
--     recompute_payment_cycles deletes and re-creates pending cycles
--     (their ids are not stable).
--  3. get_parent_portal(token)            anon read, one student only
--     claim_parent_payment(token, total)  anon write, rate-limited
--     withdraw_parent_payment_claim(token)
--     rotate_parent_link(student_id)      tutor only
--  4. Trigger on payment_cycles: when a notice becomes paid/waived,
--     close the matching open claim. Never blocks the update.
--
-- Does NOT touch recompute_payment_cycles, handle_lesson_change,
-- lessons, booking_requests, agency_* tables or the Netlify functions.
-- get_payment_summary is kept (old cached pages may still call it);
-- only its search_path is pinned.
--
-- Independent of migrations 059-063: students.is_practice (059) is read
-- defensively, and nothing here references lesson_reports (061).
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ── 0. Preconditions (abort early with a clear message) ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE payment_token IS NOT NULL
    GROUP BY payment_token HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate students.payment_token values found. Stop and investigate.';
  END IF;
END $$;

-- ── 1. students: portal settings ─────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS portal_pay_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS portal_pay_note text,
  ADD COLUMN IF NOT EXISTS portal_token_rotated_at timestamptz;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_portal_pay_mode_check,
  ADD  CONSTRAINT students_portal_pay_mode_check
       CHECK (portal_pay_mode IN ('auto', 'note', 'hidden')),
  DROP CONSTRAINT IF EXISTS students_portal_pay_note_check,
  ADD  CONSTRAINT students_portal_pay_note_check
       CHECK (portal_pay_note IS NULL OR char_length(portal_pay_note) <= 300),
  DROP CONSTRAINT IF EXISTS students_payment_token_len_check,
  ADD  CONSTRAINT students_payment_token_len_check
       CHECK (payment_token IS NULL OR char_length(payment_token) BETWEEN 32 AND 80);

COMMENT ON COLUMN public.students.portal_pay_mode IS
  'Parent portal Pay tab. auto = tutor PayNow QR unless an agency collects (then a note); note = never show QR or amounts; hidden = no Pay tab.';
COMMENT ON COLUMN public.students.portal_pay_note IS
  'Optional text shown to the parent instead of the PayNow QR when the Pay tab is in note mode. Max 300 chars.';
COMMENT ON COLUMN public.students.portal_token_rotated_at IS
  'Last time the tutor reset this student''s parent link (rotate_parent_link).';

-- Every student gets a token (safety net; expected to update 0 rows).
UPDATE public.students
SET payment_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE payment_token IS NULL;

-- Token lookups must be unique and indexed.
CREATE UNIQUE INDEX IF NOT EXISTS students_payment_token_key
  ON public.students (payment_token);

-- ── 2. payment_claims ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id       uuid NOT NULL REFERENCES public.tutors(id)   ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  amount_claimed numeric(10, 2) NOT NULL CHECK (amount_claimed > 0),
  reference      text,
  covers_from    date NOT NULL,     -- earliest period_start of the notices claimed
  covers_through date NOT NULL,     -- latest period_end of the notices claimed
  notice_count   integer NOT NULL CHECK (notice_count > 0),
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'confirmed', 'dismissed', 'withdrawn')),
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

COMMENT ON TABLE public.payment_claims IS
  'A parent tapped "I''ve paid" on the parent portal. This is only a message to the tutor: it never changes payment_cycles. open = waiting for tutor; confirmed = tutor marked the notice(s) paid/waived; dismissed = tutor says not received; withdrawn = parent tapped "I haven''t paid yet".';

-- At most one open claim per student (also the concurrency guard).
CREATE UNIQUE INDEX IF NOT EXISTS payment_claims_one_open_per_student
  ON public.payment_claims (student_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS payment_claims_tutor_status_idx
  ON public.payment_claims (tutor_id, status);
CREATE INDEX IF NOT EXISTS payment_claims_student_claimed_idx
  ON public.payment_claims (student_id, claimed_at DESC);

ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;

-- Tutors: read, update (dismiss) and delete their own claims.
-- INSERT: deliberately NO policy. Claims are only ever created by
-- claim_parent_payment() (SECURITY DEFINER). The app never inserts directly.
-- anon: NO policies at all.
DROP POLICY IF EXISTS "Tutors read own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors read own payment claims"
  ON public.payment_claims FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Tutors update own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors update own payment claims"
  ON public.payment_claims FOR UPDATE TO authenticated
  USING (tutor_id = (SELECT auth.uid()))
  WITH CHECK (tutor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Tutors delete own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors delete own payment claims"
  ON public.payment_claims FOR DELETE TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

REVOKE ALL ON public.payment_claims FROM anon;
GRANT SELECT, UPDATE, DELETE ON public.payment_claims TO authenticated;

-- ── 3a. get_parent_portal ────────────────────────────────────────────────────
-- Everything the parent page needs for ONE student, looked up by token.
-- Returns NULL for an unknown / reset / deleted-student token.
-- Never returns: ids, tutor email, guardian contact, lessons.notes,
-- parent_summary, hourly rates, other students, or agency share figures.
CREATE OR REPLACE FUNCTION public.get_parent_portal(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s             public.students%ROWTYPE;
  v_today       date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_tutor_name  text;
  v_paynow      text;
  v_payee_name  text;
  v_agency      boolean;
  v_mode        text;
  v_subject     text;
  v_unpaid      jsonb := '[]'::jsonb;
  v_total       numeric(10, 2) := 0;
  v_latest_end  date;
  v_reference   text;
  v_claim       jsonb;
  v_history     jsonb := '[]'::jsonb;
  v_book_token  text;
  v_next        jsonb;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO s
  FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.full_name, nullif(btrim(t.paynow_number), '')
  INTO v_tutor_name, v_paynow
  FROM tutors t WHERE t.id = s.tutor_id;

  -- Subjects: same rule as get_payment_summary (035).
  SELECT coalesce(
           nullif(btrim((SELECT string_agg(ss.subject, ', ' ORDER BY ss.created_at)
                         FROM student_subjects ss WHERE ss.student_id = s.id)), ''),
           s.subject)
  INTO v_subject;

  -- Who collects the fee?
  --   payee set-up A : payee_id set AND fee_collected_by = 'payee'  -> agency collects
  --   legacy platform: agency_placement_id set (migration 036)       -> agency collects
  --   otherwise the tutor collects.
  -- NOTE: fee_collected_by DEFAULTS to 'payee' for every student, so it only
  -- means "agency collects" when payee_id is also set.
  v_agency := (s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee')
              OR s.agency_placement_id IS NOT NULL;

  IF s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee' THEN
    SELECT p.name INTO v_payee_name FROM payees p
    WHERE p.id = s.payee_id AND p.tutor_id = s.tutor_id;
  ELSIF s.agency_placement_id IS NOT NULL THEN
    SELECT a.name INTO v_payee_name
    FROM agency_placements ap JOIN agencies a ON a.id = ap.agency_id
    WHERE ap.id = s.agency_placement_id;
  END IF;

  v_mode := CASE
    WHEN s.portal_pay_mode = 'hidden' THEN 'hidden'
    WHEN s.portal_pay_mode = 'note' OR v_agency THEN 'note'
    ELSE 'paynow'
  END;

  -- Unpaid notices (pending / overdue, amount > 0). Waived is never shown.
  -- Amounts are withheld server-side unless the tutor collects (mode paynow).
  IF v_mode <> 'hidden' THEN
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'period_start', pc.period_start,
        'period_end',   pc.period_end,
        'amount',       CASE WHEN v_mode = 'paynow' THEN pc.amount_due END,
        'lessons', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'date',             l.lesson_date,
                   'time',             to_char(l.lesson_time, 'HH24:MI'),
                   'duration_minutes', l.duration_minutes,
                   'subject',          l.subject,
                   -- Same expression as recompute_payment_cycles (058). Display only.
                   'amount', CASE WHEN v_mode = 'paynow' THEN round(
                               CASE WHEN l.rate_type = 'per_session'
                                    THEN coalesce(l.rate, s.hourly_rate, 0)
                                    ELSE (l.duration_minutes / 60.0) * coalesce(l.rate, s.hourly_rate, 0)
                               END, 2) END
                 ) ORDER BY l.lesson_date, l.lesson_time NULLS LAST, l.created_at), '[]'::jsonb)
          FROM lessons l
          WHERE l.payment_cycle_id = pc.id AND l.student_id = s.id
        )
      ) ORDER BY pc.period_end, pc.created_at), '[]'::jsonb),
      coalesce(sum(pc.amount_due), 0),
      max(pc.period_end)
    INTO v_unpaid, v_total, v_latest_end
    FROM payment_cycles pc
    WHERE pc.student_id = s.id
      AND pc.status IN ('pending', 'overdue')
      AND pc.amount_due > 0;
  END IF;

  IF v_mode = 'paynow' THEN
    -- PayNow reference, e.g. JIAENLIM-OCT26 (name, letters/digits only, max 12
    -- chars + month of the latest unpaid notice). Max 18 chars; PayNow allows 25.
    IF v_latest_end IS NOT NULL THEN
      v_reference := coalesce(
          nullif(left(upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')), 12), ''),
          'LESSONS')
        || '-' || upper(to_char(v_latest_end, 'MONYY'));
    END IF;

    -- An open "I've paid" claim only counts while a notice it covers is still unpaid.
    SELECT jsonb_build_object(
             'amount',         c.amount_claimed,
             'claimed_at',     c.claimed_at,
             'covers_through', c.covers_through)
    INTO v_claim
    FROM payment_claims c
    WHERE c.student_id = s.id AND c.status = 'open'
      AND EXISTS (
        SELECT 1 FROM payment_cycles pc
        WHERE pc.student_id = s.id
          AND pc.status IN ('pending', 'overdue')
          AND pc.amount_due > 0
          AND pc.period_end <= c.covers_through);

    -- Receipts: the 6 most recent paid notices.
    SELECT coalesce(jsonb_agg(h.obj ORDER BY h.paid_at DESC NULLS LAST, h.period_end DESC), '[]'::jsonb)
    INTO v_history
    FROM (
      SELECT pc.paid_at, pc.period_end,
             jsonb_build_object(
               'period_start', pc.period_start,
               'period_end',   pc.period_end,
               'amount',       pc.amount_due,
               'paid_on',      (pc.paid_at AT TIME ZONE 'Asia/Singapore')::date) AS obj
      FROM payment_cycles pc
      WHERE pc.student_id = s.id AND pc.status = 'paid'
      ORDER BY pc.paid_at DESC NULLS LAST, pc.period_end DESC
      LIMIT 6
    ) h;
  ELSE
    v_total := NULL;
  END IF;

  -- Booking: on only when the tutor has an ACTIVE booking link and the
  -- student is not archived. The token is the existing booking_links token;
  -- the Book tab calls the existing Netlify functions with it.
  IF NOT s.archived THEN
    SELECT bl.token INTO v_book_token
    FROM booking_links bl
    WHERE bl.student_id = s.id AND bl.tutor_id = s.tutor_id AND bl.is_active;
  END IF;

  SELECT jsonb_build_object(
           'date',             l.lesson_date,
           'time',             to_char(l.lesson_time, 'HH24:MI'),
           'duration_minutes', l.duration_minutes)
  INTO v_next
  FROM lessons l
  WHERE l.student_id = s.id
    AND l.lesson_date >= v_today
    AND NOT coalesce(l.is_completed, false)
    AND l.status IS DISTINCT FROM 'cancelled'
  ORDER BY l.lesson_date, l.lesson_time NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'v', 1,
    'today', v_today,
    'student', jsonb_build_object(
      'name',        btrim(s.name),
      -- Read through to_jsonb so this works before AND after migration 059
      -- adds students.is_practice (missing column = not a practice student).
      'is_practice', coalesce((to_jsonb(s) ->> 'is_practice')::boolean, false),
      'archived',    s.archived),
    'guardian_name', nullif(btrim(s.guardian_name), ''),
    'tutor_name',    nullif(btrim(v_tutor_name), ''),
    'subject',       v_subject,
    'pay', jsonb_build_object(
      'mode',         v_mode,
      'paynow_proxy', CASE WHEN v_mode = 'paynow' THEN v_paynow END,
      'collected_by', CASE WHEN v_mode = 'note' THEN v_payee_name END,
      'note',         CASE WHEN v_mode = 'note' THEN nullif(btrim(s.portal_pay_note), '') END,
      'payment_mode', s.payment_mode,
      'unpaid',       v_unpaid,
      'total',        v_total,
      'reference',    v_reference,
      'claim',        v_claim,
      'history',      v_history),
    'book', jsonb_build_object(
      'enabled',     v_book_token IS NOT NULL,
      'token',       v_book_token,
      'next_lesson', v_next)
  );
END;
$$;

-- ── 3b. claim_parent_payment ─────────────────────────────────────────────────
-- Parent taps "I've paid $X". Records a claim for the tutor to check.
-- NEVER changes payment_cycles. The amount is computed here, not trusted
-- from the browser; p_expected_total is only a "has the bill changed since
-- you loaded the page?" check.
-- Returns {ok, code}. Codes: claimed | already | not_found | not_allowed |
-- nothing_due | changed | too_many.
CREATE OR REPLACE FUNCTION public.claim_parent_payment(p_token text, p_expected_total numeric)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s         public.students%ROWTYPE;
  v_total   numeric(10, 2);
  v_from    date;
  v_through date;
  v_count   integer;
  v_recent  integer;
  v_ref     text;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT * INTO s FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Claims only make sense when the parent pays the tutor directly.
  IF s.portal_pay_mode <> 'auto'
     OR (s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee')
     OR s.agency_placement_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_allowed');
  END IF;

  -- One claim action at a time per student (double-taps, two phones).
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_claim:' || s.id::text, 0));

  IF EXISTS (SELECT 1 FROM payment_claims c WHERE c.student_id = s.id AND c.status = 'open') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already');
  END IF;

  -- Abuse guard: at most 5 claims per student per rolling 24 hours
  -- (withdrawn / dismissed ones count).
  SELECT count(*) INTO v_recent
  FROM payment_claims c
  WHERE c.student_id = s.id AND c.claimed_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many');
  END IF;

  SELECT coalesce(sum(pc.amount_due), 0), min(pc.period_start), max(pc.period_end), count(*)
  INTO v_total, v_from, v_through, v_count
  FROM payment_cycles pc
  WHERE pc.student_id = s.id
    AND pc.status IN ('pending', 'overdue')
    AND pc.amount_due > 0;

  IF v_count = 0 OR v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nothing_due');
  END IF;

  IF p_expected_total IS NULL OR round(p_expected_total, 2) <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'code', 'changed');
  END IF;

  v_ref := coalesce(
      nullif(left(upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')), 12), ''),
      'LESSONS')
    || '-' || upper(to_char(v_through, 'MONYY'));

  INSERT INTO payment_claims
    (tutor_id, student_id, amount_claimed, reference, covers_from, covers_through, notice_count)
  VALUES
    (s.tutor_id, s.id, v_total, v_ref, v_from, v_through, v_count);

  RETURN jsonb_build_object('ok', true, 'code', 'claimed');
END;
$$;

-- ── 3c. withdraw_parent_payment_claim ────────────────────────────────────────
-- Parent taps "I haven't paid yet". Idempotent.
CREATE OR REPLACE FUNCTION public.withdraw_parent_payment_claim(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT id INTO v_student_id FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  UPDATE payment_claims
  SET status = 'withdrawn', resolved_at = now()
  WHERE student_id = v_student_id AND status = 'open';

  RETURN jsonb_build_object('ok', true, 'code', 'withdrawn');
END;
$$;

-- ── 3d. rotate_parent_link (tutor only) ──────────────────────────────────────
-- "Reset link": gives the student a brand-new token. The old parent link,
-- old /pay link and old /book link all stop working immediately.
-- Returns the new token.
CREATE OR REPLACE FUNCTION public.rotate_parent_link(p_student_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_new   text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  SELECT tutor_id INTO v_owner FROM students WHERE id = p_student_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own this student.';
  END IF;

  UPDATE students
  SET payment_token = v_new, portal_token_rotated_at = now()
  WHERE id = p_student_id;

  -- The booking token travels inside the portal, so it must change too.
  UPDATE booking_links
  SET token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  WHERE student_id = p_student_id AND tutor_id = v_owner;

  RETURN v_new;
END;
$$;

-- ── 3e. Permissions on the functions ─────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_parent_portal(text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_parent_payment(text, numeric)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_parent_payment_claim(text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_parent_link(uuid)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_parent_portal(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_parent_payment(text, numeric)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_parent_payment_claim(text)  TO anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_parent_link(uuid)                FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_parent_link(uuid)             TO authenticated;

-- ── 4. Auto-close claims when the tutor marks a notice paid / waived ─────────
CREATE OR REPLACE FUNCTION public.resolve_payment_claims_on_cycle_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    UPDATE payment_claims c
    SET status = 'confirmed', resolved_at = now()
    WHERE c.student_id = NEW.student_id
      AND c.status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM payment_cycles pc
        WHERE pc.student_id = NEW.student_id
          AND pc.id <> NEW.id
          AND pc.status IN ('pending', 'overdue')
          AND pc.amount_due > 0
          AND pc.period_end <= c.covers_through);
  EXCEPTION WHEN OTHERS THEN
    -- Never let claim bookkeeping block "Mark as paid".
    RAISE WARNING 'resolve_payment_claims_on_cycle_close: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_payment_claims_on_cycle_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_payment_claims_on_cycle_close() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_payment_cycle_closed_resolve_claims ON public.payment_cycles;
CREATE TRIGGER on_payment_cycle_closed_resolve_claims
  AFTER UPDATE OF status ON public.payment_cycles
  FOR EACH ROW
  WHEN (NEW.status IN ('paid', 'waived') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.resolve_payment_claims_on_cycle_close();

-- ── 5. Harden the legacy function (behaviour unchanged) ──────────────────────
ALTER FUNCTION public.get_payment_summary(text) SET search_path = public, pg_temp;

COMMIT;

-- ============================================================
-- Post-run verification (read-only). Run manually after the migration.
-- ============================================================
-- -- 1. New columns exist with the right defaults (expect 3 rows).
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'students'
--   AND column_name IN ('portal_pay_mode', 'portal_pay_note', 'portal_token_rotated_at')
-- ORDER BY 1;
--
-- -- 2. Every student has a unique token of legal length (expect: total = distinct, 0 bad).
-- SELECT count(*) AS total, count(DISTINCT payment_token) AS distinct_tokens,
--        count(*) FILTER (WHERE payment_token IS NULL OR char_length(payment_token) NOT BETWEEN 32 AND 80) AS bad
-- FROM students;
--
-- -- 3. payment_claims: RLS on, exactly 3 policies (SELECT, UPDATE, DELETE), all for authenticated.
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_claims'::regclass;
-- SELECT policyname, cmd, roles::text FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'payment_claims' ORDER BY cmd;
--
-- -- 4. Functions: security definer, pinned search_path, correct callers.
-- SELECT p.proname, p.prosecdef, p.proconfig,
--        has_function_privilege('anon', p.oid, 'execute')          AS anon_can,
--        has_function_privilege('authenticated', p.oid, 'execute') AS auth_can
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname IN ('get_parent_portal', 'claim_parent_payment', 'withdraw_parent_payment_claim',
--                     'rotate_parent_link', 'resolve_payment_claims_on_cycle_close', 'get_payment_summary')
-- ORDER BY 1;
-- -- Expect: all prosecdef = true, all proconfig contain search_path=public, pg_temp.
-- -- anon_can: true for get_parent_portal, claim_parent_payment, withdraw_parent_payment_claim, get_payment_summary;
-- --           false for rotate_parent_link and resolve_payment_claims_on_cycle_close.
--
-- -- 5. Trigger exists on payment_cycles (expect 1 row).
-- SELECT tgname FROM pg_trigger
-- WHERE tgrelid = 'public.payment_cycles'::regclass AND NOT tgisinternal;
--
-- -- 6. anon has no table privilege on payment_claims (expect false, false).
-- SELECT has_table_privilege('anon', 'public.payment_claims', 'select'),
--        has_table_privilege('anon', 'public.payment_claims', 'insert');
--
-- -- 7. Smoke test with a real token of YOUR practice/test student (paste the token).
-- --    Expect one JSON object; check there is no email, no uuid, no "notes".
-- SELECT jsonb_pretty(get_parent_portal('<paste token here>'));
-- SELECT get_parent_portal('00000000-0000-0000-0000-000000000000') IS NULL AS unknown_token_is_null;  -- expect true
