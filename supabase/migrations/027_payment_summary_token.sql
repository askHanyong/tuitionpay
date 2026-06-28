-- Adds a per-student public share token so tutors can send students a
-- no-login payment summary link, and a SECURITY DEFINER function to read
-- that summary safely (bypassing RLS) given only the token.
alter table students
  add column if not exists payment_token text default gen_random_uuid()::text;

update students
  set payment_token = gen_random_uuid()::text
  where payment_token is null;

create or replace function get_payment_summary(p_token text)
returns json as $$
  select json_build_object(
    'student_name', s.name,
    'subject', s.subject,
    'tutor_first_name', split_part(t.full_name, ' ', 1),
    'paynow_number', t.paynow_number,
    'cycles', (
      select json_agg(json_build_object(
        'period_start', pc.period_start,
        'period_end', pc.period_end,
        'amount_due', pc.amount_due,
        'status', pc.status,
        'paid_at', pc.paid_at
      ) order by pc.period_start desc)
      from payment_cycles pc
      where pc.student_id = s.id
    )
  )
  from students s
  join tutors t on s.tutor_id = t.id
  where s.payment_token = p_token;
$$ language sql security definer;
