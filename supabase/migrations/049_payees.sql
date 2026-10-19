-- ============================================================
-- 049_payees.sql
-- Tutor-side "payees": agencies a tutor claims from (e.g. Lumina,
-- Mindflex, SSEC), each with its own share %. Students can be
-- linked to a payee, and flagged as fee collected by the agency
-- ('payee') or by the tutor ('me').
-- Does not touch agency_* tables, payment_cycles or any RPC.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================
create table if not exists public.payees (
  id            uuid primary key default gen_random_uuid(),
  tutor_id      uuid not null references public.tutors (id) on delete cascade,
  name          text not null,
  share_percent numeric(5, 2) not null default 80
                check (share_percent >= 0 and share_percent <= 100),
  notes         text,
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists payees_tutor_id_idx on public.payees (tutor_id);

alter table public.payees enable row level security;

drop policy if exists "Tutors manage own payees" on public.payees;
create policy "Tutors manage own payees"
  on public.payees for all
  using (tutor_id = (select auth.uid()))
  with check (tutor_id = (select auth.uid()));

alter table public.students
  add column if not exists payee_id uuid references public.payees (id) on delete set null,
  add column if not exists fee_collected_by text not null default 'payee'
    check (fee_collected_by in ('payee', 'me'));

create index if not exists students_payee_id_idx on public.students (payee_id);
