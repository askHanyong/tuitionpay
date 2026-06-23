-- Bug: recompute_payment_cycles() updates lessons.payment_cycle_id, which
-- re-fired the on_lesson_update trigger added in migration 007, which called
-- recompute_payment_cycles() again, infinitely, until Postgres hit
-- "stack depth limit exceeded". Fix: only recompute on UPDATE when a
-- column that actually affects billing changed (lesson_date, status, or
-- student_id) - not when only payment_cycle_id was touched.

create or replace function public.handle_lesson_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      perform public.recompute_payment_cycles(old.student_id, old.tutor_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.lesson_date is distinct from old.lesson_date
      or new.status is distinct from old.status
      or new.student_id is distinct from old.student_id
    then
      if old.status = 'completed' or new.status = 'completed' then
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
$$;

-- Migration 008's backfill almost certainly aborted partway through (it hit
-- the recursion crash on the very first student it processed), so re-run it
-- now that the recursion is fixed, to make sure every student's cycles get
-- realigned.
do $$
declare
  r record;
begin
  for r in
    select distinct student_id, tutor_id
    from lessons
    where status = 'completed'
  loop
    perform public.recompute_payment_cycles(r.student_id, r.tutor_id);
  end loop;
end $$;
