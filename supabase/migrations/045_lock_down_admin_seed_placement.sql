-- ============================================================
-- 045_lock_down_admin_seed_placement.sql
-- Security fix: migration 039 revoked EXECUTE from PUBLIC only, but
-- Supabase also grants EXECUTE to anon and authenticated directly, so
-- anyone could call admin_seed_placement() through the API.
-- Now only the database owner (postgres) and service_role can run it.
-- Applied to the live database before 044 (it was the more serious gap).
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.admin_seed_placement(
  uuid, uuid, uuid, text, numeric, integer, text, timestamptz,
  timestamptz, text, boolean, uuid
) FROM PUBLIC, anon, authenticated;
