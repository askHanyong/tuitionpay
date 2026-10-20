-- ============================================================
-- 042_parent_booking_schema.sql
-- Phase 1: Parent booking — schema only.
-- Tutor-side availability UI and parent /book/<token> pages
-- are built on top of these tables.
-- ============================================================

create extension if not exists btree_gist;

-- 1. Per-tutor booking rules
create table public.booking_settings (
  tutor_id uuid primary key references auth.users(id) on delete cascade,
  min_notice_hours     int not null default 48  check (min_notice_hours >= 0),
  max_book_days_ahead  int not null default 14  check (max_book_days_ahead > 0),
  view_days_ahead      int not null default 28  check (view_days_ahead >= max_book_days_ahead),
  min_lesson_minutes   int not null default 60  check (min_lesson_minutes > 0),
  max_lesson_minutes   int not null default 120 check (max_lesson_minutes >= min_lesson_minutes),
  lesson_step_minutes  int not null default 30  check (lesson_step_minutes > 0),
  request_expiry_hours int not null default 48  check (request_expiry_hours > 0),
  updated_at timestamptz not null default now()
);

-- 2. One private link per student
create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  token text not null unique default
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (student_id)
);

-- 3. Date-specific open windows set by the tutor
create table public.availability_windows (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references auth.users(id) on delete cascade,
  start_at timestamptz not null,
  end_at   timestamptz not null,
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index availability_windows_tutor_start_idx
  on public.availability_windows (tutor_id, start_at);

-- 4. Parent requests (kept separate from lessons until the tutor confirms)
create table public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  start_at timestamptz not null,
  end_at   timestamptz not null,
  duration_minutes int generated always as
    ((extract(epoch from (end_at - start_at)) / 60)::int) stored,
  status text not null default 'pending'
    check (status in ('pending','confirmed','declined','cancelled','expired')),
  parent_note text,
  tutor_note text,
  lesson_id uuid references public.lessons(id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (end_at > start_at),
  check (duration_minutes between 30 and 120),
  check (expires_at <= start_at),
  constraint no_overlapping_pending
    exclude using gist (tutor_id with =, tstzrange(start_at, end_at) with &&)
    where (status = 'pending')
);

-- RLS: tutors manage only their own rows. NO anon/public policies, on purpose.
-- Parent pages will go through a server function, never directly to these tables.
alter table public.booking_settings     enable row level security;
alter table public.booking_links        enable row level security;
alter table public.availability_windows enable row level security;
alter table public.booking_requests     enable row level security;

create policy "own settings" on public.booking_settings
  for all using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

create policy "own windows" on public.availability_windows
  for all using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

-- students.tutor_id references tutors(id), and tutors.id = auth.uid(),
-- so this ownership check is correct.
create policy "own links" on public.booking_links
  for all using (tutor_id = auth.uid())
  with check (tutor_id = auth.uid() and exists (
    select 1 from public.students s
    where s.id = student_id and s.tutor_id = auth.uid()));

create policy "own requests" on public.booking_requests
  for all using (tutor_id = auth.uid())
  with check (tutor_id = auth.uid() and exists (
    select 1 from public.students s
    where s.id = student_id and s.tutor_id = auth.uid()));
