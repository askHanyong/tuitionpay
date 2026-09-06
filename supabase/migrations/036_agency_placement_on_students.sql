-- Adds a nullable FK on students pointing to the agency_placement responsible
-- for this student's onboarding. NULL = no agency involvement (default).
-- Backward-compatible: existing rows get NULL, all existing behaviour unchanged.
--
-- Also updates get_payment_summary() to branch on this field:
--   - agency_placement_id IS NOT NULL → use agencies.paynow_number as payee
--   - agency_placement_id IS NULL     → existing behaviour, byte-for-byte identical

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS agency_placement_id uuid
    REFERENCES agency_placements(id) ON DELETE SET NULL;

-- Updated function: branches on agency_placement_id.
-- The NULL branch is identical to the current function in 035.
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
    -- Branch: agency-collected vs tutor-collected.
    -- NOTE (migration 037, DEFERRED): for handoff_after_n placements, this
    -- should also check whether the completed-lesson count has reached
    -- agency_placements.handoff_after_lessons and fall through to
    -- t.paynow_number when the threshold is crossed. Deferred until a live
    -- handoff-mode placement exists to test the edge case (lesson crossing N
    -- mid-billing-cycle, timing relative to payment_cycles) against real data.
    'paynow_number',    case
                          when s.agency_placement_id is not null
                            then a.paynow_number
                          else t.paynow_number
                        end,
    'collected_by',     case
                          when s.agency_placement_id is not null
                            then a.name
                          else null
                        end,
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
  left join agency_placements ap on ap.id = s.agency_placement_id
  left join agencies a           on a.id  = ap.agency_id
  where s.payment_token = p_token;
$$ language sql security definer;
