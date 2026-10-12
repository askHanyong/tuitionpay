-- ============================================================
-- 043_billing_functions_search_path.sql
-- Pins search_path on the three SECURITY DEFINER billing functions
-- so they cannot be tricked into using look-alike objects from
-- another schema (flagged by the Supabase security advisor).
-- No change to what the functions do.
-- ============================================================

ALTER FUNCTION public.recompute_payment_cycles(uuid, uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.create_manual_closeout_cycle(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.delete_manual_closeout_cycle(uuid) SET search_path = public, pg_temp;
