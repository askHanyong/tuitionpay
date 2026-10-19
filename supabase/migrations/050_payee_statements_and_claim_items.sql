-- ============================================================
-- 050_payee_statements_and_claim_items.sql
-- Phase 2 of agency statements:
--  * payee_claim_items: manual expense / adjustment lines per payee + month
--    (positive amount = the payee owes the tutor; negative = tutor owes payee)
--  * payee_statements: one record per payee + month, created when the tutor
--    marks it as sent. Stores the share % used at that time (so later changes
--    to the payee's %, do not rewrite past months) plus sent/reimbursed dates.
-- Does not touch agency_* tables, payment_cycles or any RPC.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================
create table if not exists public.payee_claim_items (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.tutors (id) on delete cascade,
  payee_id    uuid not null references public.payees (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  description text not null,
  amount      numeric(10, 2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index if not exists payee_claim_items_lookup_idx
  on public.payee_claim_items (tutor_id, payee_id, month);

create table if not exists public.payee_statements (
  id              uuid primary key default gen_random_uuid(),
  tutor_id        uuid not null references public.tutors (id) on delete cascade,
  payee_id        uuid not null references public.payees (id) on delete cascade,
  month           date not null check (extract(day from month) = 1),
  share_percent   numeric(5, 2) not null check (share_percent >= 0 and share_percent <= 100),
  claimed_total   numeric(10, 2) not null,
  status          text not null default 'sent' check (status in ('sent', 'reimbursed')),
  sent_at         timestamptz not null default now(),
  reimbursed_at   timestamptz,
  created_at      timestamptz not null default now(),
  unique (payee_id, month)
);

create index if not exists payee_statements_tutor_idx
  on public.payee_statements (tutor_id, month);

alter table public.payee_claim_items enable row level security;
alter table public.payee_statements  enable row level security;

drop policy if exists "Tutors manage own claim items" on public.payee_claim_items;
create policy "Tutors manage own claim items"
  on public.payee_claim_items for all
  using (tutor_id = (select auth.uid()))
  with check (tutor_id = (select auth.uid()));

drop policy if exists "Tutors manage own payee statements" on public.payee_statements;
create policy "Tutors manage own payee statements"
  on public.payee_statements for all
  using (tutor_id = (select auth.uid()))
  with check (tutor_id = (select auth.uid()));
