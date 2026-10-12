-- ============================================================
-- 046_security_hardening.sql
--
-- 1. rate_benchmark: was callable by logged-out visitors and returned
--    min/max/avg hourly rates for any subject+level, even when only one
--    tutor's student matched (which would reveal that tutor's rate).
--    Now: logged-in users only, and returns nothing unless the sample
--    covers at least 3 different tutors.
--
-- 2. join_agency: was callable by logged-out visitors, so invite codes
--    could be guessed without an account. Now: logged-in users only,
--    with a pinned search_path.
--
-- 3. Row-level rules on lessons and payment_cycles only checked that
--    tutor_id = the caller. They did not check that the student belongs
--    to the caller, so a tutor who knew another tutor's student ID could
--    attach lessons or bills to that student (and bills appear on that
--    student's public payment page). Insert and update rules now also
--    require that the student is the caller's own.
-- ============================================================

-- 1. rate_benchmark ------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_benchmark(p_subject text, p_level text)
RETURNS TABLE(avg_rate numeric, min_rate numeric, max_rate numeric, sample_size bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  select
    avg(hourly_rate)::numeric(10,2),
    min(hourly_rate)::numeric(10,2),
    max(hourly_rate)::numeric(10,2),
    count(*)
  from students
  where subject = p_subject
    and level = p_level
    and hourly_rate is not null
  having count(distinct tutor_id) >= 3;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_benchmark(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_benchmark(text, text) TO authenticated, service_role;

-- 2. join_agency ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_agency(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be logged in.';
  END IF;

  SELECT id INTO v_agency_id
  FROM agencies
  WHERE upper(trim(invite_code)) = upper(trim(p_invite_code));

  IF v_agency_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code.';
  END IF;

  INSERT INTO agency_tutor_memberships (agency_id, tutor_id)
  VALUES (v_agency_id, auth.uid())
  ON CONFLICT (agency_id, tutor_id) DO NOTHING;

  RETURN v_agency_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.join_agency(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_agency(text) TO authenticated, service_role;

-- 3. Student-ownership checks on lessons and payment_cycles --------
ALTER POLICY "Tutors can insert own lessons" ON public.lessons
  WITH CHECK (
    tutor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.tutor_id = auth.uid())
  );

ALTER POLICY "Tutors can update own lessons" ON public.lessons
  WITH CHECK (
    tutor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.tutor_id = auth.uid())
  );

ALTER POLICY "Tutors can insert own payment cycles" ON public.payment_cycles
  WITH CHECK (
    tutor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.tutor_id = auth.uid())
  );

ALTER POLICY "Tutors can update own payment cycles" ON public.payment_cycles
  WITH CHECK (
    tutor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.students s WHERE s.id = student_id AND s.tutor_id = auth.uid())
  );
