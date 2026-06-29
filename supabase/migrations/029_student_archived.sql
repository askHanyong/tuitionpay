-- Lets a tutor "pause" a student (e.g. on a temporary break) without losing
-- their lesson/payment history, as an alternative to deleting them outright.
alter table students
  add column if not exists archived boolean not null default false;
