# TuitionPay

React + Vite app for tutors to track students, lessons, and payment cycles, backed by Supabase (auth + Postgres) and styled with Tailwind CSS.

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It creates the `tutors`, `students`, `lessons`, and `payment_cycles` tables, a trigger that creates a `tutors` row on signup, and row-level security policies scoping every table to `auth.uid()` so each tutor only ever sees their own data.
3. Copy `.env.example` to `.env` and fill in your project's URL and anon key:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
4. Install dependencies and start the dev server:
   ```
   npm install
   npm run dev
   ```

## Auth flow

`/login` handles both sign up and login via Supabase Auth. After a successful login, users are redirected to `/dashboard`, which is wrapped in `ProtectedRoute` and redirects back to `/login` if there's no session.
