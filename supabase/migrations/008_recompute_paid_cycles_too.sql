-- recompute_payment_cycles() previously only ever touched 'pending' cycles,
-- leaving already-'paid' cycles frozen even if their lesson membership was
-- formed out of chronological order before the 006/007 fix. Since a cycle's
-- amount_due is always 4 * hourly_rate * lesson_duration_hours (independent
-- of which specific 4 lessons it covers), we can safely realign which
-- lessons belong to a cycle and its period_start/period_end without ever
-- touching amount_due, status, or paid_at.
--
-- This redefines recompute_payment_cycles() to detach and regroup ALL of a
-- student's completed lessons (not just unbilled ones) into chronological
-- groups of 4, mapping each group onto the student's existing cycles in
-- chronological order (oldest cycle <-> earliest 4 lessons, etc.), only
-- creating a new 'pending' cycle when a complete group has no cycle yet.

create or replace function public.recompute_payment_cycles(p_student_id uuid, p_tutor_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_hourly_rate numeric(10, 2);
  v_duration_hours numeric(4, 2);
  total_completed integer;
  num_complete_groups integer;
  i integer;
  cycle_ids uuid[];
  cycle_id uuid;
  chunk_lesson_ids uuid[];
  v_period_start date;
  v_period_end date;
begin
  select hourly_rate, lesson_duration_hours into v_hourly_rate, v_duration_hours
  from students
  where id = p_student_id;

  -- Detach every completed lesson from any cycle. The payment_cycles rows
  -- themselves (and their amount_due/status/paid_at) are untouched here.
  update lessons
  set payment_cycle_id = null
  where student_id = p_student_id and status = 'completed';

  select count(*) into total_completed
  from lessons
  where student_id = p_student_id and status = 'completed';

  num_complete_groups := total_completed / 4;

  select array_agg(id order by period_start, created_at) into cycle_ids
  from payment_cycles
  where student_id = p_student_id;

  for i in 1..num_complete_groups loop
    select array_agg(id order by lesson_date, created_at) into chunk_lesson_ids
    from (
      select id, lesson_date, created_at
      from lessons
      where student_id = p_student_id and status = 'completed'
      order by lesson_date, created_at
      offset (i - 1) * 4
      limit 4
    ) chunk;

    select min(lesson_date), max(lesson_date) into v_period_start, v_period_end
    from lessons
    where id = any (chunk_lesson_ids);

    if cycle_ids is not null and array_length(cycle_ids, 1) >= i then
      cycle_id := cycle_ids[i];
      update payment_cycles
      set period_start = v_period_start, period_end = v_period_end
      where id = cycle_id;
    else
      insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
      values (
        p_tutor_id,
        p_student_id,
        v_period_start,
        v_period_end,
        4 * coalesce(v_hourly_rate, 0) * coalesce(v_duration_hours, 0),
        'pending'
      )
      returning id into cycle_id;
    end if;

    update lessons
    set payment_cycle_id = cycle_id
    where id = any (chunk_lesson_ids);
  end loop;
end;
$$;

-- One-time backfill: realign every existing student's cycles now.
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
