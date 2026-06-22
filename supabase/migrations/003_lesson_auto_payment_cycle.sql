-- Run this if you already executed the original schema.sql and need to add
-- automatic payment cycle creation when 4 lessons accumulate for a student.

alter table lessons add column if not exists payment_cycle_id uuid references payment_cycles (id) on delete set null;
create index if not exists lessons_payment_cycle_id_idx on lessons (payment_cycle_id);

create or replace function public.handle_lesson_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  uncycled_count integer;
  new_cycle_id uuid;
  v_hourly_rate numeric(10, 2);
  v_duration_hours numeric(4, 2);
  v_period_start date;
  v_period_end date;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  select count(*) into uncycled_count
  from lessons
  where student_id = new.student_id
    and payment_cycle_id is null
    and status = 'completed';

  if uncycled_count >= 4 then
    select hourly_rate, lesson_duration_hours into v_hourly_rate, v_duration_hours
    from students
    where id = new.student_id;

    select min(lesson_date), max(lesson_date) into v_period_start, v_period_end
    from (
      select lesson_date
      from lessons
      where student_id = new.student_id
        and payment_cycle_id is null
        and status = 'completed'
      order by lesson_date, created_at
      limit 4
    ) billed_lessons;

    insert into payment_cycles (tutor_id, student_id, period_start, period_end, amount_due, status)
    values (
      new.tutor_id,
      new.student_id,
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
      where student_id = new.student_id
        and payment_cycle_id is null
        and status = 'completed'
      order by lesson_date, created_at
      limit 4
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_lesson_insert on lessons;
create trigger on_lesson_insert
  after insert on lessons
  for each row execute procedure public.handle_lesson_insert();
