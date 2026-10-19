-- ============================================================
-- 051_student_placement_fee.sql
-- One-off placement / referral fee a student pays to a recommending agency
-- (e.g. Mindflex) out of their first lessons. The fee is taken from the
-- student's earliest lessons (on/after placement_fee_start, if set) in date
-- order until the total is used up. The amount is NOT claimable from the
-- payee and is shown on the statement as "paid to <agency>".
-- Additive only: three optional columns on students. Existing rows unaffected.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================
alter table public.students
  add column if not exists placement_fee_agency text,
  add column if not exists placement_fee_amount numeric(10, 2)
    check (placement_fee_amount is null or placement_fee_amount >= 0),
  add column if not exists placement_fee_start  date;
