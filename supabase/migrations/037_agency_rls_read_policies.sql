-- Grants agency owners read access to the tutors, students, and lessons rows
-- associated with their active placements. Without these policies, an agency
-- auth user (user_type = 'agency') gets 0 rows from those tables because the
-- existing policies only match tutor_id = auth.uid().
--
-- Helper functions use SECURITY DEFINER so they can traverse agency_placements
-- and agencies without triggering RLS on those tables. auth.uid() still
-- resolves correctly inside SECURITY DEFINER in Supabase/PostgREST (reads from
-- JWT claims, not the database role).
--
-- Gap not yet addressed: payment_cycles — not needed for the current dashboard
-- because ledger data is read from agency_ledger_entries directly. Add a
-- matching policy when a ledger → cycle drill-down view is built.

-- Helper: does the calling agency owner have a placement for this student?
CREATE OR REPLACE FUNCTION agency_owns_placement_for_student(check_student_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agency_placements ap
    JOIN agencies a ON a.id = ap.agency_id
    WHERE ap.student_id = check_student_id
      AND a.owner_id = auth.uid()
  );
$$;

-- Helper: does the calling agency owner have a placement for this tutor?
CREATE OR REPLACE FUNCTION agency_owns_placement_for_tutor(check_tutor_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agency_placements ap
    JOIN agencies a ON a.id = ap.agency_id
    WHERE ap.tutor_id = check_tutor_id
      AND a.owner_id = auth.uid()
  );
$$;

-- Grant agency owners read access to just their placed students.
CREATE POLICY "Agency owners can read their placed students"
  ON students FOR SELECT
  USING (agency_owns_placement_for_student(id));

-- Grant agency owners read access to just their placed tutors.
CREATE POLICY "Agency owners can read their placed tutors"
  ON tutors FOR SELECT
  USING (agency_owns_placement_for_tutor(id));

-- Grant agency owners read access to lessons for their placed students
-- (used for the handoff_after_n lesson counter in AgencyDashboard).
CREATE POLICY "Agency owners can read lessons for their placed students"
  ON lessons FOR SELECT
  USING (agency_owns_placement_for_student(student_id));
