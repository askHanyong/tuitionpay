BEGIN;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS is_practice boolean NOT NULL DEFAULT false;
COMMIT;
