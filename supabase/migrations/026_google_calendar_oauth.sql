-- Replaces the old implicit-grant access-token columns with a single jsonb
-- column holding the full OAuth code-flow token set (access + refresh token),
-- and adds the lesson-level Google Calendar event id used for sync/delete.
alter table tutors
  add column if not exists google_calendar_tokens jsonb;

alter table lessons
  add column if not exists google_event_id text;
