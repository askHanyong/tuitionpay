-- Replace your existing students (and their lessons/payment cycles, via
-- cascade) with fictional demo data, safe to use in screenshots.
--
-- Run this in the Supabase SQL editor while logged in as the tutor whose
-- data you want to replace, OR set :tutor_id manually below.
--
-- WARNING: this permanently deletes all students, lessons and payment
-- cycles belonging to the tutor — make sure you're pointed at a test
-- account, not your real one, unless you intend to wipe real student data.

begin;

-- 1. Identify the tutor to seed. Defaults to the currently authenticated
--    user (auth.uid()) when run from the Supabase SQL editor while logged
--    in via the app's session. Replace with a literal uuid if needed.
with target_tutor as (
  select auth.uid() as id
)

-- 2. Delete all existing students for that tutor. Lessons and payment
--    cycles referencing them are removed automatically via
--    "on delete cascade" foreign keys.
delete from students
where tutor_id = (select id from target_tutor);

-- 3. Insert the four fictional demo students.
insert into students (tutor_id, name, subject, level, hourly_rate, lesson_duration_hours)
select auth.uid(), name, subject, level, hourly_rate, lesson_duration_hours
from (
  values
    ('Wei Ming', 'Add. Maths',  'Sec 4',     60, 1.5),
    ('Priya',    'Chemistry',   'JC1',       70, 2.0),
    ('Danial',   'English',     'Primary 6', 45, 1.0),
    ('Sarah',    'Biology',     'IBDP HL',   80, 1.5)
) as demo_students (name, subject, level, hourly_rate, lesson_duration_hours);

commit;
