-- Lessons logged with a future lesson_date were previously inserted as
-- 'completed' regardless of date. Flip any that haven't happened yet back
-- to 'scheduled' so they stop counting toward billing progress until their
-- date arrives. The on_lesson_update trigger (fixed in migration 009) will
-- safely recompute payment cycles for each affected student.
update lessons
set status = 'scheduled'
where status = 'completed'
  and lesson_date > current_date;
