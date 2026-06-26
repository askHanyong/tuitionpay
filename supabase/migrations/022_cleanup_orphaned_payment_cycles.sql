-- Bug: recompute_payment_cycles() rebuilds which lessons belong to which
-- cycle, but it only ever inserts/updates cycles up to the current
-- num_complete_groups count -- it never removes payment_cycles rows left
-- over from before is_completed existed (when cycles were created off
-- status = 'completed'). Those stale rows are still 'pending' but have no
-- lessons actually attached to them anymore, yet the dashboard still reads
-- and displays them as "payment due".
--
-- Delete pending cycles that no longer have any lessons pointing at them,
-- then re-run recompute for every student so cycles realign with the
-- current is_completed-based reality.
delete from payment_cycles pc
where pc.status = 'pending'
  and not exists (
    select 1 from lessons l where l.payment_cycle_id = pc.id
  );

-- Make this self-healing: every future recompute also drops any pending
-- cycle that ends up with no lessons attached, so this class of stale row
-- can't reaccumulate.
create or replace function public.recompute_payment_cycles(p_student_id uuid, p_tutor_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $func$
declare
  v_hourly_rate numeric(10, 2);
  v_duration_hours numeric(4, 2);
  v_payment_mode text;
  v_cycle_count integer;
  v_custom_day integer;
  group_size integer;
  total_completed integer;
  num_complete_groups integer;
  i integer;
  cycle_ids uuid[];
  cycle_id uuid;
  chunk_lesson_ids uuid[];
  v_period_start date;
  v_period_end date;
  v_amount numeric(10, 2);
  month_rec record;
  v_due_date date;
  v_today date := current_date;
begin
  select hourly_rate, lesson_duration_hours, payment_mode, payment_cycle_count, payment_custom_day
  into v_hourly_rate, v_duration_hours, v_payment_mode, v_cycle_count, v_custom_day
  from students where id = p_student_id;

  update lessons set payment_cycle_id = null
  where student_id = p_student_id and is_completed;

  if v_payment_mode in ('lessons', 'per_lesson') then
    group_size := case
      when v_payment_mode = 'per_lesson' then 1
      else coalesce(v_cycle_count, 4)
    end;

    select count(*) into total_completed
    from lessons where student_id = p_student_id and is_completed;

    num_complete_groups := total_completed / group_size;

    select array_agg(id order by period_start, created_at) into cycle_ids
    from payment_cycles where student_id = p_student_id;

    for i in 1..num_complete_groups loop
      select array_agg(id order by lesson_date, created_at) into chunk_lesson_ids
      from (
        select id, lesson_date, created_at from lessons
        where student_id = p_student_id and is_completed
        order by lesson_date, created_at
        offset (i - 1) * group_size limit group_size
      ) chunk;

      select min(lesson_date), max(lesson_date) into v_period_start, v_period_end
      from lessons where id = any (chunk_lesson_ids);

      v_amount := group_size * coalesce(v_hourly_rate, 0) * coalesce(v_duration_hours, 0);

      if cycle_ids is not null and array_length(cycle_ids, 1) >= i then
        cycle_id := cycle_ids[i];
        update payment_cycles set period_start = v_period_start, period_end = v_period_end
        where id = cycle_id;
      else
        insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
        values (p_tutor_id, p_student_id, v_period_start, v_period_end, v_amount, 'pending')
        returning id into cycle_id;
      end if;

      update lessons set payment_cycle_id = cycle_id
      where id = any (chunk_lesson_ids);
    end loop;

  elsif v_payment_mode in ('monthly', 'custom_date') then
    for month_rec in
      select date_trunc('month', lesson_date)::date as month_start,
             array_agg(id order by lesson_date, created_at) as lesson_ids,
             min(lesson_date) as period_start,
             max(lesson_date) as period_end,
             count(*) as lesson_count
      from lessons
      where student_id = p_student_id and is_completed
      group by date_trunc('month', lesson_date)
      order by month_start
    loop
      if v_payment_mode = 'monthly' then
        v_due_date := (month_rec.month_start + interval '1 month' - interval '1 day')::date;
      else
        v_due_date := least(
          (month_rec.month_start + ((coalesce(v_custom_day, 1) - 1) || ' days')::interval)::date,
          (month_rec.month_start + interval '1 month' - interval '1 day')::date
        );
      end if;

      -- a month's cycle is only created/due once its due date has arrived
      if v_today < v_due_date then
        continue;
      end if;

      v_amount := month_rec.lesson_count * coalesce(v_hourly_rate, 0) * coalesce(v_duration_hours, 0);

      select id into cycle_id
      from payment_cycles
      where student_id = p_student_id
        and period_start >= month_rec.month_start
        and period_start < (month_rec.month_start + interval '1 month')
      order by created_at
      limit 1;

      if cycle_id is not null then
        update payment_cycles
        set period_start = month_rec.period_start, period_end = v_due_date
        where id = cycle_id;
      else
        insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
        values (p_tutor_id, p_student_id, month_rec.period_start, v_due_date, v_amount, 'pending')
        returning id into cycle_id;
      end if;

      update lessons set payment_cycle_id = cycle_id
      where id = any (month_rec.lesson_ids);
    end loop;
  end if;

  -- drop any pending cycle for this student that ended up with no lessons
  -- attached -- it no longer corresponds to a real completed-lesson group.
  delete from payment_cycles pc
  where pc.student_id = p_student_id
    and pc.status = 'pending'
    and not exists (select 1 from lessons l where l.payment_cycle_id = pc.id);
end;
$func$;

do $$
declare
  r record;
begin
  for r in select distinct tutor_id, id as student_id from students
  loop
    perform public.recompute_payment_cycles(r.student_id, r.tutor_id);
  end loop;
end $$;
