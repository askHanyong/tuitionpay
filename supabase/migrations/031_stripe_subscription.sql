-- Migration 031: Stripe subscription tracking
-- Adds subscription fields to tutors (shared table for user_type = 'tutor' and 'practitioner').
-- No changes to practitioner_rates, practitioner_companies, or any rate-card logic.

alter table tutors
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text unique,
  add column if not exists subscription_status    text
    check (subscription_status in ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'grandfathered')),
  add column if not exists subscription_plan      text
    check (subscription_plan in ('monthly', 'annual')),
  add column if not exists current_period_end     timestamptz;

-- Fast lookups from Stripe webhook payloads
create index if not exists tutors_stripe_customer_id_idx     on tutors (stripe_customer_id);
create index if not exists tutors_stripe_subscription_id_idx on tutors (stripe_subscription_id);

-- All accounts that existed before Stripe billing was introduced are grandfathered in.
-- They can use the app without a paid subscription until you decide on a rollout plan.
-- Query WHERE subscription_status = 'grandfathered' to find who hasn't converted.
update tutors
set subscription_status = 'grandfathered'
where subscription_status is null;
