-- TuitionPay schema
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
  created_at timestamptz not null default now()
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

-- Whenever a completed lesson is logged, recompute the student's pending
-- billing groups from scratch, strictly by lesson_date (not insertion
-- order), so backfilling history out of order can't strand a lesson in
-- the wrong group. Cycles already marked 'paid' are never touched.
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
