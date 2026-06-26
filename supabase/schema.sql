-- ChopeAndPay schema
-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- Tutors: one row per auth user, created automatically on signup.
create table if not exists tutors (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

-- Students belong to a tutor.
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references tutors (id) on delete cascade,
  name text not null,
  subject text,
  hourly_rate numeric(10, 2),
  lesson_duration_hours numeric(4, 2),
  guardian_name text,
  guardian_contact text,
  notes text,
  created_at timestamptz not null default now(),
  payment_mode text not null default 'lessons' check (payment_mode in ('lessons', 'monthly', 'per_lesson', 'custom_date')),
  payment_cycle_count integer not null default 4 check (payment_cycle_count between 2 and 20),
  payment_custom_day integer check (payment_custom_day is null or payment_custom_day between 1 and 31)
);

-- Lessons belong to a student (and, transitively, a tutor).
create table if not exists lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references tutors (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  lesson_date date not null,
  lesson_time time,
  duration_minutes integer not null,
  rate numeric(10, 2),
  status text not null default 'completed' check (status in ('scheduled', 'completed', 'cancelled')),
  is_completed boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- Payment cycles group lessons into a billable period per student.
create table if not exists payment_cycles (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references tutors (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  amount_due numeric(10, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Tracks which payment cycle a lesson has been billed under, if any.
alter table lessons add column if not exists payment_cycle_id uuid references payment_cycles (id) on delete set null;
create index if not exists lessons_payment_cycle_id_idx on lessons (payment_cycle_id);

create index if not exists students_tutor_id_idx on students (tutor_id);
create index if not exists lessons_tutor_id_idx on lessons (tutor_id);
create index if not exists lessons_student_id_idx on lessons (student_id);
create index if not exists payment_cycles_tutor_id_idx on payment_cycles (tutor_id);
create index if not exists payment_cycles_student_id_idx on payment_cycles (student_id);

-- Automatically create a tutor row when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.tutors (id, full_name, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Whenever an explicitly-completed lesson (is_completed = true — set only by
-- the tutor tapping "Mark as Done", never by lesson_date) is logged, edited,
-- reassigned, or deleted, recompute the student's billing groups from
-- scratch, strictly by lesson_date (not insertion order), so backfilling
-- history out of order can't strand a lesson in the wrong group. A cycle's
-- amount_due is always group_size * hourly_rate * lesson_duration_hours,
-- independent of which specific lessons it covers, so this can safely
-- realign lesson membership and period dates even for already-'paid'
-- cycles without ever touching amount_due, status, or paid_at.
create or replace function public.recompute_payment_cycles(p_student_id uuid, p_tutor_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
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
$$;

create or replace function public.handle_lesson_insert()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.is_completed then
    perform public.recompute_payment_cycles(new.student_id, new.tutor_id);
  end if;
  return new;
end;
$$;

drop trigger if exists on_lesson_insert on lessons;
create trigger on_lesson_insert
  after insert on lessons
  for each row execute procedure public.handle_lesson_insert();

-- Editing a lesson's date/is_completed, reassigning it to a different
-- student, or deleting it also needs to recompute billing, not just inserts.
create or replace function public.handle_lesson_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
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
$$;

drop trigger if exists on_lesson_update on lessons;
create trigger on_lesson_update
  after update on lessons
  for each row execute procedure public.handle_lesson_change();

drop trigger if exists on_lesson_delete on lessons;
create trigger on_lesson_delete
  after delete on lessons
  for each row execute procedure public.handle_lesson_change();

-- Row Level Security: tutors only ever see their own data.
alter table tutors enable row level security;
alter table students enable row level security;
alter table lessons enable row level security;
alter table payment_cycles enable row level security;

create policy "Tutors can view own profile" on tutors
  for select using (id = auth.uid());
create policy "Tutors can update own profile" on tutors
  for update using (id = auth.uid());

create policy "Tutors can view own students" on students
  for select using (tutor_id = auth.uid());
create policy "Tutors can insert own students" on students
  for insert with check (tutor_id = auth.uid());
create policy "Tutors can update own students" on students
  for update using (tutor_id = auth.uid());
create policy "Tutors can delete own students" on students
  for delete using (tutor_id = auth.uid());

create policy "Tutors can view own lessons" on lessons
  for select using (tutor_id = auth.uid());
create policy "Tutors can insert own lessons" on lessons
  for insert with check (tutor_id = auth.uid());
create policy "Tutors can update own lessons" on lessons
  for update using (tutor_id = auth.uid());
create policy "Tutors can delete own lessons" on lessons
  for delete using (tutor_id = auth.uid());

create policy "Tutors can view own payment cycles" on payment_cycles
  for select using (tutor_id = auth.uid());
create policy "Tutors can insert own payment cycles" on payment_cycles
  for insert with check (tutor_id = auth.uid());
create policy "Tutors can update own payment cycles" on payment_cycles
  for update using (tutor_id = auth.uid());
create policy "Tutors can delete own payment cycles" on payment_cycles
  for delete using (tutor_id = auth.uid());
