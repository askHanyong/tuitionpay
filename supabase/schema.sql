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
  guardian_name text,
  guardian_contact text,
  hourly_rate numeric(10, 2),
  notes text,
  created_at timestamptz not null default now()
);

-- Lessons belong to a student (and, transitively, a tutor).
create table if not exists lessons (
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
