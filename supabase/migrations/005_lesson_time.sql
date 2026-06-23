-- Adds a start time of day to lessons, so calendar exports (.ics) can include
-- an accurate start/end time rather than only a date.
alter table lessons add column if not exists lesson_time time;
