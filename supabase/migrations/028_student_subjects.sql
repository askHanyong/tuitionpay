-- Lets a tutor teach the same student multiple subjects, each with its own
-- level/rate/duration, instead of needing a separate student record per
-- subject. students.subject/level/hourly_rate/lesson_duration_hours are kept
-- as a fallback (synced from the student's first subject) for any code path
-- not yet updated to read from student_subjects.
create table if not exists student_subjects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  tutor_id uuid not null references tutors(id) on delete cascade,
  subject text not null,
  level text,
  hourly_rate numeric(10, 2),
  lesson_duration_hours numeric(4, 2),
  created_at timestamptz not null default now()
);

alter table student_subjects enable row level security;

create policy "Tutors can manage own student subjects"
  on student_subjects for all using (tutor_id = auth.uid());

insert into student_subjects (student_id, tutor_id, subject, level, hourly_rate, lesson_duration_hours)
select id, tutor_id, subject, level, hourly_rate, lesson_duration_hours
from students
where subject is not null
  and not exists (
    select 1 from student_subjects ss where ss.student_id = students.id
  );

-- Lets a lesson record exactly which subject it was for, and denormalizes
-- the subject text onto the lesson so Calendar/Dashboard/Lessons displays
-- don't need an extra join for a value that never changes after the lesson
-- is logged.
alter table lessons
  add column if not exists student_subject_id uuid references student_subjects(id) on delete set null;

alter table lessons
  add column if not exists subject text;

update lessons l
set subject = s.subject
from students s
where l.student_id = s.id
  and l.subject is null;
