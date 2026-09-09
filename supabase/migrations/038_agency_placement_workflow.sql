-- ============================================================
-- 038_agency_placement_workflow.sql
-- Adds mutual-confirmation handshake, membership table, and
-- placement lifecycle to the existing agency domain.
--
-- Additive only. Does NOT modify:
--   agencies, agency_ledger_entries, get_payment_summary(),
--   any tutor-facing tables, or any practitioner tables.
-- ============================================================


-- ------------------------------------------------------------
-- 1. agency_tutor_memberships
--    Many-to-many: a tutor joins an agency by entering its
--    invite_code. Insertion is gated via join_agency() below
--    so the invite_code is validated atomically at the data
--    layer. Direct inserts by tutors are blocked (no INSERT
--    RLS policy on this table for tutors).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agency_tutor_memberships (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id  uuid        NOT NULL REFERENCES agencies(id)  ON DELETE CASCADE,
  tutor_id   uuid        NOT NULL REFERENCES tutors(id)    ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),

  -- A tutor cannot join the same agency twice.
  UNIQUE (agency_id, tutor_id)
);

ALTER TABLE agency_tutor_memberships ENABLE ROW LEVEL SECURITY;

-- Agency owner reads all memberships under their agency.
CREATE POLICY "Agency owner can read memberships"
  ON agency_tutor_memberships FOR SELECT
  USING (
    agency_id IN (SELECT id FROM agencies WHERE owner_id = auth.uid())
  );

-- Tutor reads their own memberships (to know which agencies they belong to).
CREATE POLICY "Tutors can read own memberships"
  ON agency_tutor_memberships FOR SELECT
  USING (tutor_id = auth.uid());


-- ------------------------------------------------------------
-- 2. SECURITY DEFINER function: sole path for a tutor to join
--    an agency. Validates invite_code (case-insensitive),
--    inserts the membership row atomically, and returns the
--    agency_id. ON CONFLICT DO NOTHING makes duplicate joins
--    idempotent. Raises a clear exception on invalid code.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION join_agency(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_agency_id uuid;
BEGIN
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


-- ------------------------------------------------------------
-- 3. New columns on agency_placements
--
-- NOTE on the existing partial unique index:
--   CREATE UNIQUE INDEX agency_placements_unique_active
--     ON agency_placements USING btree (tutor_id, student_id)
--     WHERE (ended_at IS NULL)
--
--   This index prevents two rows with the same (tutor_id, student_id)
--   from both having ended_at IS NULL. The state-machine trigger below
--   auto-sets ended_at = now() on both 'declined' and 'ended'
--   transitions, which frees the slot for a fresh placement request.
--   If ended_at were left NULL on a terminal transition, the index
--   would block any new request for the same pair — the trigger
--   prevents this automatically.
-- ------------------------------------------------------------

-- Placement lifecycle status. Default is 'pending_agency_review'.
ALTER TABLE agency_placements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_agency_review'
    CHECK (status IN (
      'pending_agency_review',       -- tutor submitted; agency has not yet responded
      'pending_tutor_confirmation',  -- agency proposed terms; awaiting tutor
      'active',                      -- both parties confirmed; ledger + routing apply
      'declined',                    -- either party declined; terminal, kept as record
      'ended'                        -- either party ended an active placement; terminal
    ));

-- Who ended or declined the placement. NULL until status reaches a terminal state.
ALTER TABLE agency_placements
  ADD COLUMN IF NOT EXISTS ended_by text
    CHECK (ended_by IN ('tutor', 'agency'));

-- True if any linked ledger entries were not 'settled' at the moment of ending.
-- Set automatically by the state-machine trigger; never set by application code.
ALTER TABLE agency_placements
  ADD COLUMN IF NOT EXISTS ended_with_unsettled_ledger boolean NOT NULL DEFAULT false;

-- Backfill existing rows: any placement with ended_at IS NULL was active
-- under the old ended_at-based logic and should be 'active', not the new
-- column default 'pending_agency_review'. Must run before the trigger is
-- created so it is a plain UPDATE, not subject to state-machine validation.
UPDATE agency_placements SET status = 'active' WHERE ended_at IS NULL;


-- ------------------------------------------------------------
-- 4. State-machine trigger (BEFORE INSERT and BEFORE UPDATE)
--
-- A single function handles both events, branching on TG_OP:
--
-- On INSERT:
--   (a) Forcibly reset commission fields to table defaults so a
--       tutor's initial placement request cannot pre-set terms
--       that only the agency is allowed to propose.
--
-- On UPDATE:
--   (a) Block changes to agency_id, student_id, tutor_id (immutable
--       after creation)
--   (b) Status transition validation with caller-role enforcement
--   (c) Commission field write restriction
--   (d) Forcibly set ended_by, ended_at, ended_with_unsettled_ledger
--       on terminal transitions (always authoritative, never caller-supplied)
--
-- SECURITY DEFINER is required so the function can query agencies
-- to identify the caller's role. auth.uid() resolves from JWT
-- claims and works correctly inside SECURITY DEFINER in Supabase.
--
-- v_is_agency_owner and v_is_tutor are computed against
-- OLD.agency_id / OLD.tutor_id on UPDATE, which are immutable
-- (enforced by this trigger). Both are accurate in all transition
-- paths, including both decline paths.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_fn_placement_state_machine()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_agency_owner    boolean;
  v_is_tutor           boolean;
  v_commission_changed boolean;
BEGIN

  -- ── INSERT path ─────────────────────────────────────────────
  -- Forcibly reset commission fields to defaults so the tutor's
  -- initial request cannot pre-set terms the agency has not agreed to.
  -- The agency sets real terms during the proposal transition (UPDATE).
  IF TG_OP = 'INSERT' THEN
    NEW.commission_mode        := 'ongoing';
    NEW.commission_rate        := 0.10;
    NEW.handoff_after_lessons  := NULL;
    RETURN NEW;
  END IF;

  -- ── UPDATE path ─────────────────────────────────────────────

  -- Immutability: agency_id, student_id, and tutor_id cannot change
  -- after creation. Checked first so subsequent logic can trust OLD values.
  IF NEW.agency_id   IS DISTINCT FROM OLD.agency_id  OR
     NEW.student_id  IS DISTINCT FROM OLD.student_id OR
     NEW.tutor_id    IS DISTINCT FROM OLD.tutor_id   THEN
    RAISE EXCEPTION
      'agency_id, student_id, and tutor_id cannot be changed after a '
      'placement is created. Create a fresh placement request instead.';
  END IF;

  -- Identify caller role against the specific placement being updated.
  SELECT EXISTS (
    SELECT 1 FROM agencies
    WHERE id = OLD.agency_id AND owner_id = auth.uid()
  ) INTO v_is_agency_owner;

  v_is_tutor := (OLD.tutor_id = auth.uid());

  -- Detect any change to commission-defining fields.
  v_commission_changed := (
    NEW.commission_mode       IS DISTINCT FROM OLD.commission_mode  OR
    NEW.commission_rate       IS DISTINCT FROM OLD.commission_rate  OR
    NEW.handoff_after_lessons IS DISTINCT FROM OLD.handoff_after_lessons
  );

  -- Commission fields: agency only, and only during the proposal step.
  IF v_commission_changed THEN
    IF NOT v_is_agency_owner THEN
      RAISE EXCEPTION
        'Only the agency may change commission terms.';
    END IF;
    IF NOT (
      OLD.status = 'pending_agency_review'
      AND NEW.status = 'pending_tutor_confirmation'
    ) THEN
      RAISE EXCEPTION
        'Commission terms can only be set during the '
        'pending_agency_review → pending_tutor_confirmation transition.';
    END IF;
  END IF;

  -- Validate status transition only when status actually changes.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    CASE
      -- Agency proposes terms or declines outright.
      WHEN OLD.status = 'pending_agency_review'
        AND NEW.status IN ('pending_tutor_confirmation', 'declined') THEN
        IF NOT v_is_agency_owner THEN
          RAISE EXCEPTION
            'Only the agency may advance or decline a placement '
            'in pending_agency_review.';
        END IF;

      -- Tutor confirms or declines the agency''s proposed terms.
      WHEN OLD.status = 'pending_tutor_confirmation'
        AND NEW.status IN ('active', 'declined') THEN
        IF NOT v_is_tutor THEN
          RAISE EXCEPTION
            'Only the tutor may confirm or decline a placement '
            'in pending_tutor_confirmation.';
        END IF;

      -- Either party can end an active placement unilaterally.
      WHEN OLD.status = 'active' AND NEW.status = 'ended' THEN
        IF NOT (v_is_agency_owner OR v_is_tutor) THEN
          RAISE EXCEPTION
            'Only the agency or the tutor may end an active placement.';
        END IF;

      -- All other transitions are invalid. Terminal statuses (declined,
      -- ended) cannot be changed — create a fresh placement request instead.
      ELSE
        RAISE EXCEPTION
          'Invalid placement status transition: % → %. '
          'Terminal statuses cannot be changed. '
          'Create a fresh placement request instead.',
          OLD.status, NEW.status;
    END CASE;
  END IF;

  -- On 'ended': forcibly set ended_by and ended_at (always authoritative,
  -- never caller-supplied) and flag unsettled ledger entries.
  -- Ending is allowed to proceed even with unsettled entries — the flag
  -- is informational, not a blocker.
  IF NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended' THEN
    NEW.ended_by := CASE WHEN v_is_agency_owner THEN 'agency' ELSE 'tutor' END;
    NEW.ended_at := now();
    SELECT EXISTS (
      SELECT 1 FROM agency_ledger_entries
      WHERE placement_id = NEW.id AND status != 'settled'
    ) INTO NEW.ended_with_unsettled_ledger;
  END IF;

  -- On 'declined': forcibly set ended_at (frees the unique index slot for
  -- a fresh request) and ended_by (audit trail; consistent with the
  -- transition CASE above which already validated who is allowed to decline
  -- at each step). Both are always authoritative, never caller-supplied.
  IF NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined' THEN
    NEW.ended_at := now();
    NEW.ended_by := CASE WHEN v_is_agency_owner THEN 'agency' ELSE 'tutor' END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_placement_state_machine_insert
  BEFORE INSERT ON agency_placements
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_placement_state_machine();

CREATE TRIGGER trg_placement_state_machine_update
  BEFORE UPDATE ON agency_placements
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_placement_state_machine();


-- ------------------------------------------------------------
-- 5. RLS policies on agency_placements
--
-- Existing policies (keep, untouched):
--   "Agency owner can manage placements" — FOR ALL, agency owner
--   "Tutors can read own placements"     — FOR SELECT, tutor
--
-- The existing FOR ALL agency policy is intentionally kept broad
-- to preserve the manual-insert workflow (admin inserts placements
-- directly via Supabase dashboard). The state-machine trigger enforces
-- valid transitions regardless of which client performs the UPDATE.
-- ------------------------------------------------------------

-- Tutor can INSERT a new placement request. WITH CHECK enforces:
--   (a) tutor_id must be the caller
--   (b) agency_id must be one the caller has a membership in
--   (c) student_id must belong to the caller
--   (d) status must be 'pending_agency_review' at insert time
CREATE POLICY "Tutors can request placement"
  ON agency_placements FOR INSERT
  WITH CHECK (
    tutor_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id
      FROM agency_tutor_memberships
      WHERE tutor_id = auth.uid()
    )
    AND student_id IN (
      SELECT id FROM students WHERE tutor_id = auth.uid()
    )
    AND status = 'pending_agency_review'
  );

-- Tutor can UPDATE their own placement rows.
-- Column-level restrictions (commission fields, state transitions)
-- are enforced by the state-machine trigger, not by this policy.
CREATE POLICY "Tutors can update own placements"
  ON agency_placements FOR UPDATE
  USING  (tutor_id = auth.uid())
  WITH CHECK (tutor_id = auth.uid());
