-- ============================================================
-- 057_recompute_on_rate_and_duration_change.sql
--
-- handle_lesson_change() only recomputed payment cycles when a
-- lesson's date, completion or student changed. Editing duration,
-- rate or rate_type left pending notices at the old amount.
-- This adds those three columns to the trigger condition.
-- Paid and waived cycles are unaffected (recompute only rebuilds
-- pending, non-manual cycles).
--
-- Run manually in the Supabase SQL Editor on 2026-11-16.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_lesson_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.is_completed then
      perform public.recompute_payment_cycles(old.student_id, old.tutor_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.lesson_date is distinct from old.lesson_date
      or new.is_completed is distinct from old.is_completed
      or new.student_id is distinct from old.student_id
      or new.duration_minutes is distinct from old.duration_minutes
      or new.rate is distinct from old.rate
      or new.rate_type is distinct from old.rate_type
    then
      if old.is_completed or new.is_completed then
        perform public.recompute_payment_cycles(old.student_id, old.tutor_id);
        if new.student_id <> old.student_id then
          perform public.recompute_payment_cycles(new.student_id, new.tutor_id);
        end if;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$function$;

COMMIT;
