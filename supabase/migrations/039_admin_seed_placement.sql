-- ============================================================
-- 039_admin_seed_placement.sql
-- Adds a transaction-scoped bypass to the placement state-machine
-- trigger and a SECURITY DEFINER seed function for testing the
-- placement workflow before the placement-creation UI exists.
--
-- TESTING ONLY. This function is intentionally inaccessible from
-- PostgREST (EXECUTE revoked from PUBLIC / authenticated / anon).
-- Only the postgres / service-role superuser (SQL Editor) can call it.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Update trg_fn_placement_state_machine() to honour the
--    transaction-scoped admin seed bypass flag.
--
--    The bypass check is the very first statement in the function —
--    before TG_OP branching — so it short-circuits both the INSERT
--    path (commission reset) and the UPDATE path (identity lock,
--    role checks, terminal-state fills) equally.
--
--    current_setting('app.is_admin_seed', true):
--      The second argument `true` suppresses the "unrecognized
--      configuration parameter" error when the flag has never been
--      set in this session; it returns NULL in that case, which
--      evaluates to not-equal to 'true' and falls through normally.
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

  -- ── Admin seed bypass ────────────────────────────────────────
  -- Set by admin_seed_placement() for the duration of its transaction.
  -- Automatically resets after commit/rollback (set_config third arg = true).
  -- Never set by application code.
  IF current_setting('app.is_admin_seed', true) = 'true' THEN
    RETURN NEW;
  END IF;

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
      RAISE EXCEPTION 'Only the agency may change commission terms.';
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
  IF NEW.status = 'ended' AND OLD.status IS DISTINCT FROM 'ended' THEN
    NEW.ended_by := CASE WHEN v_is_agency_owner THEN 'agency' ELSE 'tutor' END;
    NEW.ended_at := now();
    SELECT EXISTS (
      SELECT 1 FROM agency_ledger_entries
      WHERE placement_id = NEW.id AND status != 'settled'
    ) INTO NEW.ended_with_unsettled_ledger;
  END IF;

  -- On 'declined': forcibly set ended_at and ended_by (audit trail).
  IF NEW.status = 'declined' AND OLD.status IS DISTINCT FROM 'declined' THEN
    NEW.ended_at := now();
    NEW.ended_by := CASE WHEN v_is_agency_owner THEN 'agency' ELSE 'tutor' END;
  END IF;

  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- 2. admin_seed_placement()
--
-- Inserts or updates a placement row with full control over all
-- fields, bypassing the state-machine trigger's role checks,
-- commission reset, and terminal-state auto-fills.
-- Intended for use in the SQL Editor only.
--
-- Access control:
--   SECURITY DEFINER controls execution context, not call rights.
--   PostgreSQL grants EXECUTE to PUBLIC by default; the explicit
--   REVOKE below removes that, leaving only the postgres superuser
--   (SQL Editor / service role) with access. authenticated / anon /
--   any app user going through PostgREST cannot call this function.
--   Known tradeoff: anyone who already has direct postgres-role SQL
--   Editor access can call it freely — but they could also disable
--   the trigger outright, so this function is a convenience tool,
--   not a security boundary. Drop it once the real placement-creation
--   UI exists.
--
-- Usage — INSERT:
--   SELECT admin_seed_placement(
--     p_agency_id             => '<agency-uuid>',
--     p_tutor_id              => '<tutor-uuid>',
--     p_student_id            => '<student-uuid>',
--     p_commission_mode       => 'handoff_after_n',
--     p_commission_rate       => 0.15,
--     p_handoff_after_lessons => 3,
--     p_status                => 'active',
--     p_started_at            => '2026-09-01 00:00:00+08'
--   );
--
-- Usage — UPDATE (pass p_id; identity cols ignored on UPDATE):
--   SELECT admin_seed_placement(
--     p_id         => '<existing-placement-uuid>',
--     p_agency_id  => '<agency-uuid>',
--     p_tutor_id   => '<tutor-uuid>',
--     p_student_id => '<student-uuid>',
--     p_status     => 'ended',
--     p_ended_at   => now(),
--     p_ended_by   => 'agency',
--     p_ended_with_unsettled_ledger => true
--   );
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_seed_placement(
  p_agency_id                   uuid,
  p_tutor_id                    uuid,
  p_student_id                  uuid,
  p_commission_mode             text        DEFAULT 'ongoing',
  p_commission_rate             numeric     DEFAULT 0.10,
  p_handoff_after_lessons       int         DEFAULT NULL,
  p_status                      text        DEFAULT 'pending_agency_review',
  p_started_at                  timestamptz DEFAULT now(),
  p_ended_at                    timestamptz DEFAULT NULL,
  p_ended_by                    text        DEFAULT NULL,
  p_ended_with_unsettled_ledger boolean     DEFAULT NULL,
  p_id                          uuid        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_placement_id uuid;
BEGIN
  -- Scoped to this transaction only; resets automatically on commit/rollback.
  PERFORM set_config('app.is_admin_seed', 'true', true);

  IF p_id IS NULL THEN
    INSERT INTO agency_placements (
      agency_id,
      tutor_id,
      student_id,
      commission_mode,
      commission_rate,
      handoff_after_lessons,
      status,
      started_at,
      ended_at,
      ended_by,
      ended_with_unsettled_ledger
    ) VALUES (
      p_agency_id,
      p_tutor_id,
      p_student_id,
      p_commission_mode,
      p_commission_rate,
      p_handoff_after_lessons,
      p_status,
      p_started_at,
      p_ended_at,
      p_ended_by,
      COALESCE(p_ended_with_unsettled_ledger, false)
    )
    RETURNING id INTO v_placement_id;
  ELSE
    -- Identity columns (agency_id, tutor_id, student_id) are not updated —
    -- they are fixed at INSERT and enforced immutable by the trigger on normal
    -- UPDATEs. Passing them here is required by the function signature but
    -- they are intentionally excluded from the SET clause.
    UPDATE agency_placements SET
      commission_mode               = p_commission_mode,
      commission_rate               = p_commission_rate,
      handoff_after_lessons         = p_handoff_after_lessons,
      status                        = p_status,
      started_at                    = p_started_at,
      ended_at                      = p_ended_at,
      ended_by                      = p_ended_by,
      ended_with_unsettled_ledger   = COALESCE(p_ended_with_unsettled_ledger, false)
    WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No placement found with id = %', p_id;
    END IF;

    v_placement_id := p_id;
  END IF;

  RETURN v_placement_id;
END;
$$;

-- Revoke default PUBLIC execute right.
-- Only the postgres superuser (SQL Editor / service role) retains access.
-- PostgREST (authenticated / anon) cannot call this function.
REVOKE EXECUTE ON FUNCTION admin_seed_placement(
  uuid, uuid, uuid, text, numeric, int, text, timestamptz,
  timestamptz, text, boolean, uuid
) FROM PUBLIC;
