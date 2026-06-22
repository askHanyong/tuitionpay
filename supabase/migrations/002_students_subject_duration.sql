-- Run this if you already executed the original schema.sql and need to add
-- the subject / lesson_duration_hours columns to an existing students table.

alter table students add column if not exists subject text;
alter table students add column if not exists lesson_duration_hours numeric(4, 2);
