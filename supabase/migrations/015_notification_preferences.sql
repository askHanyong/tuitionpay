alter table tutors add column if not exists notify_lesson_reminders boolean not null default true;
alter table tutors add column if not exists notify_payment_due boolean not null default true;
alter table tutors add column if not exists notify_weekly_summary boolean not null default true;
