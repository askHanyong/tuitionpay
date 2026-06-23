-- Billing cycles only recomputed on lesson INSERT. Editing a lesson's date
-- (or status), reassigning it to a different student, or deleting it left
-- stale/incorrect pending cycles behind. Add triggers so any such change
-- re-runs recompute_payment_cycles() for the affected student(s).
-- Paid cycles are still never touched (recompute_payment_cycles only ever
-- dissolves and regroups 'pending' cycles).

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
    if old.status = 'completed' or new.status = 'completed' then
      perform public.recompute_payment_cycles(old.student_id, old.tutor_id);
      if new.student_id <> old.student_id then
        perform public.recompute_payment_cycles(new.student_id, new.tutor_id);
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists on_lesson_update on lessons;
create trigger on_lesson_update
  after update on lessons
  for each row execute procedure public.handle_lesson_change();

drop trigger if exists on_lesson_delete on lessons;
create trigger on_lesson_delete
  after delete on lessons
  for each row execute procedure public.handle_lesson_change();
