-- Updates get_payment_summary to read subjects from student_subjects
-- (canonical post-028 location) as a comma-joined list, falling back
-- to the legacy students.subject column for any student with no rows there.

create or replace function get_payment_summary(p_token text)
returns json as $$
  select json_build_object(
    'student_name',     s.name,
    'subject',          coalesce(
                          nullif(trim(
                            (select string_agg(ss.subject, ', ' order by ss.created_at)
                             from student_subjects ss
                             where ss.student_id = s.id)
                          ), ''),
                          s.subject
                        ),
    'tutor_first_name', split_part(t.full_name, ' ', 1),
    'paynow_number',    t.paynow_number,
    'cycles', (
      select json_agg(json_build_object(
        'period_start', pc.period_start,
        'period_end',   pc.period_end,
        'amount_due',   pc.amount_due,
        'status',       pc.status,
        'paid_at',      pc.paid_at
      ) order by pc.period_start desc)
      from payment_cycles pc
      where pc.student_id = s.id
    )
  )
  from students s
  join tutors t on s.tutor_id = t.id
  where s.payment_token = p_token;
$$ language sql security definer;
