-- The original on_lesson_insert trigger billed a student as soon as 4
-- *unbilled* lessons existed at insert time. If lessons were logged out of
-- chronological order (e.g. backfilling history), a cycle could close using
-- only the lessons present so far, permanently stranding an earlier-dated
-- lesson as unbilled even though it belongs in that same group of 4.
--
-- This migration replaces the trigger with one that recomputes a student's
-- pending billing groups from scratch on every completed-lesson insert,
-- always grouping strictly by lesson_date. Cycles already marked 'paid' are
-- never touched or reassigned.

create or replace function public.recompute_payment_cycles(p_student_id uuid, p_tutor_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_hourly_rate numeric(10, 2);
  v_duration_hours numeric(4, 2);
  total_unbilled integer;
  num_complete_groups integer;
  i integer;
  new_cycle_id uuid;
  v_period_start date;
  v_period_end date;
begin
  -- Pending cycles are safe to dissolve and regroup; lessons.payment_cycle_id
  -- is set to null automatically via the foreign key's "on delete set null".
  -- Paid cycles are left untouched.
  delete from payment_cycles
  where student_id = p_student_id and status = 'pending';

  select hourly_rate, lesson_duration_hours into v_hourly_rate, v_duration_hours
  from students
  where id = p_student_id;

  select count(*) into total_unbilled
  from lessons
  where student_id = p_student_id
    and status = 'completed'
    and payment_cycle_id is null;

  num_complete_groups := total_unbilled / 4;

  for i in 1..num_complete_groups loop
    select min(lesson_date), max(lesson_date) into v_period_start, v_period_end
    from (
      select lesson_date
      from lessons
      where student_id = p_student_id
        and status = 'completed'
        and payment_cycle_id is null
      order by lesson_date, created_at
      limit 4
    ) batch;

    insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
    values (
      p_tutor_id,
      p_student_id,
      v_period_start,
      v_period_end,
      4 * coalesce(v_hourly_rate, 0) * coalesce(v_duration_hours, 0),
      'pending'
    )
    returning id into new_cycle_id;

    update lessons
    set payment_cycle_id = new_cycle_id
    where id in (
      select id
      from lessons
      where student_id = p_student_id
        and status = 'completed'
        and payment_cycle_id is null
      order by lesson_date, created_at
      limit 4
    );
  end loop;
end;
$$;

create or replace function public.handle_lesson_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'completed' then
    perform public.recompute_payment_cycles(new.student_id, new.tutor_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_lesson_insert on lessons;
create trigger on_lesson_insert
  after insert on lessons
  for each row execute procedure public.handle_lesson_insert();

-- One-time backfill: fix any student whose existing lessons were billed
-- out of chronological order.
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
