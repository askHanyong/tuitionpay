-- Reset script: drops and rebuilds ONLY the TuitionPay tables/trigger,
-- leaving any other apps' tables in this Supabase project untouched.
-- Safe to run because no real students/lessons/payment cycles exist yet.

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_lesson_insert on lessons;
drop function if exists public.handle_new_user();
drop function if exists handle_new_user();
drop function if exists public.handle_lesson_insert();

drop table if exists payment_cycles cascade;
drop table if exists lessons cascade;
drop table if exists students cascade;
drop table if exists tutors cascade;

-- ============================================
-- Canonical schema (matches the app's queries)
-- ============================================

create extension if not exists "pgcrypto";

create table tutors (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

create table students (
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

create table lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references tutors (id) on delete cascade,
  student_id uuid not null references students (id) on delete cascade,
  lesson_date date not null,
  duration_minutes integer not null,
  rate numeric(10, 2),
  status text not null default 'completed' check (status in ('scheduled', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

create table payment_cycles (
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

alter table lessons add column if not exists payment_cycle_id uuid references payment_cycles (id) on delete set null;
create index if not exists lessons_payment_cycle_id_idx on lessons (payment_cycle_id);

create index if not exists students_tutor_id_idx on students (tutor_id);
create index if not exists lessons_tutor_id_idx on lessons (tutor_id);
create index if not exists lessons_student_id_idx on lessons (student_id);
create index if not exists payment_cycles_tutor_id_idx on payment_cycles (tutor_id);
create index if not exists payment_cycles_student_id_idx on payment_cycles (student_id);

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

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

create trigger on_lesson_insert
  after insert on lessons
  for each row execute procedure public.handle_lesson_insert();

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
