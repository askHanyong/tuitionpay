-- ============================================================
-- 047_lock_down_feedback_view.sql
-- SECURITY FIX (data leak): the view feedback_with_tutor joins
-- feedback to tutors (full_name, email), ran with its owner's rights
-- (bypassing row-level security) and was granted to anon, so a
-- logged-out visitor with the public key could read feedback messages
-- together with tutor names and emails via /rest/v1/feedback_with_tutor.
-- The app does not use this view (it reads the feedback table).
--
-- Fix: run the view with the caller's rights and remove all access
-- for anon/authenticated (service_role keeps SELECT for the dashboard).
-- Also revokes anon from the manual closeout RPCs; both already check
-- auth.uid() so this is tidiness, not a behaviour change.
-- ============================================================

ALTER VIEW public.feedback_with_tutor SET (security_invoker = true);
REVOKE ALL ON public.feedback_with_tutor FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.feedback_with_tutor TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_manual_closeout_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_closeout_cycle(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.delete_manual_closeout_cycle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_manual_closeout_cycle(uuid) TO authenticated, service_role;
