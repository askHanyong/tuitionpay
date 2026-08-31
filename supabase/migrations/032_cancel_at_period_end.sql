-- Migration 032: track Stripe's cancel_at_period_end on the tutors row.
-- Written by the subscription.updated webhook when a tutor schedules a cancellation.
-- Reset to false when they resume or when subscription.deleted fires.

alter table tutors
  add column if not exists cancel_at_period_end boolean not null default false;
