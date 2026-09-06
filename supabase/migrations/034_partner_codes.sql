-- Partner code system for tuition agency collaborations.
-- Each partner agency gets a unique code that grants their tutors an
-- expanded free-tier student limit (e.g. WECARE → 5 students instead of 3).
--
-- Redemption writes partner_code_id + partner_student_limit onto the tutors
-- row at signup or via Settings. The limit is denormalised onto tutors so
-- that deactivating a code never retroactively reduces a tutor's limit.

CREATE TABLE IF NOT EXISTS partner_codes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text        NOT NULL UNIQUE,         -- uppercase, e.g. 'WECARE'
  partner_name   text        NOT NULL,                -- display name, e.g. 'WeCareTuition'
  student_limit  integer     NOT NULL DEFAULT 5,      -- free-tier override (default is 3)
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partner_codes ENABLE ROW LEVEL SECURITY;

-- Authenticated users (tutors) can SELECT to validate a code at signup/settings.
-- Anon users can also SELECT so the signup page (unauthenticated) can validate.
CREATE POLICY "Anyone can read active partner codes"
  ON partner_codes FOR SELECT
  USING (true);

-- Seed the first partner code.
INSERT INTO partner_codes (code, partner_name, student_limit, active)
VALUES ('WECARE', 'WeCareTuition', 5, true)
ON CONFLICT (code) DO NOTHING;

-- Add partner code tracking columns to the tutors table.
-- partner_code_id: which code was redeemed (null = no partner code).
-- partner_student_limit: denormalised limit copied from partner_codes.student_limit
--   at redemption time so deactivating a code doesn't hurt existing tutors.
ALTER TABLE tutors
  ADD COLUMN IF NOT EXISTS partner_code_id      uuid REFERENCES partner_codes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_student_limit integer;
