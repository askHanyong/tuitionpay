-- Adds per-session flat-rate billing as an opt-in per subject.
-- The ALTER TABLE statements are recorded here for completeness; they were
-- already applied directly to the live DB before this migration was written.
-- The IF NOT EXISTS / DEFAULT guards make them safe to re-run.

-- student_subjects: tutor opts a subject into per-session billing here.
alter table student_subjects
  add column if not exists rate_type text not null default 'hourly'
    check (rate_type in ('hourly', 'per_session'));

-- lessons: snapshot of rate_type at log time so that changing a subject's
-- rate_type later never retroactively alters historical payment amounts.
alter table lessons
  add column if not exists rate_type text not null default 'hourly'
    check (rate_type in ('hourly', 'per_session'));

-- Redefine recompute_payment_cycles to branch on each lesson's snapshotted
-- rate_type: per_session lessons cost exactly `rate` (flat fee); hourly
-- lessons cost (duration_minutes / 60) * rate as before.
create or replace function public.recompute_payment_cycles(p_student_id uuid, p_tutor_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $func$
declare
  v_hourly_rate numeric(10, 2);
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
  select hourly_rate, payment_mode, payment_cycle_count, payment_custom_day
  into v_hourly_rate, v_payment_mode, v_cycle_count, v_custom_day
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

      select coalesce(sum(
        case when rate_type = 'per_session'
          then coalesce(rate, 0)
          else (duration_minutes / 60.0) * coalesce(rate, v_hourly_rate, 0)
        end
      ), 0)
      into v_amount
      from lessons where id = any (chunk_lesson_ids);

      if cycle_ids is not null and array_length(cycle_ids, 1) >= i then
        cycle_id := cycle_ids[i];
        update payment_cycles
        set period_start = v_period_start,
            period_end = v_period_end,
            amount_due = case when status = 'pending' then v_amount else amount_due end
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

      if v_today < v_due_date then
        continue;
      end if;

      v_period_start := month_rec.month_start;

      select coalesce(sum(
        case when rate_type = 'per_session'
          then coalesce(rate, 0)
          else (duration_minutes / 60.0) * coalesce(rate, v_hourly_rate, 0)
        end
      ), 0)
      into v_amount
      from lessons where id = any (month_rec.lesson_ids);

      select id into cycle_id
      from payment_cycles
      where student_id = p_student_id
        and period_start >= month_rec.month_start
        and period_start < (month_rec.month_start + interval '1 month')
      order by created_at
      limit 1;

      if cycle_id is not null then
        update payment_cycles
        set period_start = v_period_start,
            period_end = v_due_date,
            amount_due = case when status = 'pending' then v_amount else amount_due end
        where id = cycle_id;
      else
        insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
        values (p_tutor_id, p_student_id, v_period_start, v_due_date, v_amount, 'pending')
        returning id into cycle_id;
      end if;

      update lessons set payment_cycle_id = cycle_id
      where id = any (month_rec.lesson_ids);
    end loop;
  end if;
end;
$func$;
