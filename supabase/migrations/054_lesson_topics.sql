-- ============================================================
-- 054_lesson_topics.sql
-- Feedback reports, step 1: record which IB syllabus topics were covered
-- in each lesson, and how secure the student was on each.
--
--  * syllabus_topics : read-only reference list (IB Math AA, 83 subtopics),
--                      copied from the askhanyong project. Same for every tutor.
--  * lesson_topics   : one row per (lesson, subtopic). rating 1/2/3 =
--                      needs work / developing / secure. Tutor-private.
--  * student_subjects.syllabus : which syllabus a student's subject follows
--                      ('ib_maa' for now). Null = no topic tracking.
--
-- Does not touch payment_cycles, recompute_payment_cycles, lessons columns,
-- agency_* tables, or any RPC.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Reference table: syllabus_topics
-- ------------------------------------------------------------
create table if not exists public.syllabus_topics (
  code            text primary key,                 -- e.g. 'AA5.8'
  syllabus        text not null default 'ib_maa',
  topic_number    int  not null,                    -- 1..5
  subtopic_number int  generated always as (split_part(code, '.', 2)::int) stored,
  topic_name      text not null,                    -- e.g. 'Calculus'
  subtopic_name   text not null,
  level_scope     text not null check (level_scope in ('SL', 'AHL'))
);

alter table public.syllabus_topics enable row level security;

-- Everyone signed in can read; nobody can write through the API
-- (no insert/update/delete policy = denied).
drop policy if exists "Signed-in users read syllabus topics" on public.syllabus_topics;
create policy "Signed-in users read syllabus topics"
  on public.syllabus_topics for select
  to authenticated
  using (true);

insert into public.syllabus_topics
  (code, topic_number, topic_name, subtopic_name, level_scope)
values
  ('AA1.1', 1, 'Number and Algebra', 'Operations with numbers in standard form (a x 10^k)', 'SL'),
  ('AA1.10', 1, 'Number and Algebra', 'Counting principles; binomial theorem extended to rational/negative exponents', 'AHL'),
  ('AA1.11', 1, 'Number and Algebra', 'Partial fractions', 'AHL'),
  ('AA1.12', 1, 'Number and Algebra', 'Complex numbers: Cartesian form and arithmetic', 'AHL'),
  ('AA1.13', 1, 'Number and Algebra', 'Complex numbers: polar and exponential (Euler) form', 'AHL'),
  ('AA1.14', 1, 'Number and Algebra', 'De Moivre''s theorem; conjugate roots of polynomials', 'AHL'),
  ('AA1.15', 1, 'Number and Algebra', 'Proof by induction and by contradiction', 'AHL'),
  ('AA1.16', 1, 'Number and Algebra', 'Systems of linear equations (up to 3 unknowns)', 'AHL'),
  ('AA1.2', 1, 'Number and Algebra', 'Arithmetic sequences and series; sigma notation', 'SL'),
  ('AA1.3', 1, 'Number and Algebra', 'Geometric sequences and series', 'SL'),
  ('AA1.4', 1, 'Number and Algebra', 'Financial applications: compound interest and depreciation', 'SL'),
  ('AA1.5', 1, 'Number and Algebra', 'Exponents and introduction to logarithms', 'SL'),
  ('AA1.6', 1, 'Number and Algebra', 'Simple deductive proof', 'SL'),
  ('AA1.7', 1, 'Number and Algebra', 'Laws of exponents and logarithms (rational exponents)', 'SL'),
  ('AA1.8', 1, 'Number and Algebra', 'Infinite geometric series', 'SL'),
  ('AA1.9', 1, 'Number and Algebra', 'Binomial theorem (positive integer exponent)', 'SL'),
  ('AA2.1', 2, 'Functions', 'Equations of a straight line', 'SL'),
  ('AA2.10', 2, 'Functions', 'Solving equations graphically and analytically', 'SL'),
  ('AA2.11', 2, 'Functions', 'Transformations of graphs', 'SL'),
  ('AA2.12', 2, 'Functions', 'Polynomial functions; factor and remainder theorems', 'AHL'),
  ('AA2.13', 2, 'Functions', 'Rational functions with quadratic denominator; asymptotes', 'AHL'),
  ('AA2.14', 2, 'Functions', 'Odd/even functions; self-inverse functions', 'AHL'),
  ('AA2.15', 2, 'Functions', 'Solving inequalities graphically and analytically', 'AHL'),
  ('AA2.16', 2, 'Functions', 'Further transformations: |f(x)|; f(|x|); reciprocal of a function', 'AHL'),
  ('AA2.2', 2, 'Functions', 'Concept of a function; domain and range', 'SL'),
  ('AA2.3', 2, 'Functions', 'Graphing functions and sketching from context', 'SL'),
  ('AA2.4', 2, 'Functions', 'Key features of graphs; intersections', 'SL'),
  ('AA2.5', 2, 'Functions', 'Composite functions', 'SL'),
  ('AA2.6', 2, 'Functions', 'Quadratic functions: standard/factor/vertex forms', 'SL'),
  ('AA2.7', 2, 'Functions', 'Quadratic equations; discriminant and nature of roots', 'SL'),
  ('AA2.8', 2, 'Functions', 'Reciprocal and simple rational functions', 'SL'),
  ('AA2.9', 2, 'Functions', 'Exponential and logarithmic functions', 'SL'),
  ('AA3.1', 3, 'Geometry and Trigonometry', '3D geometry: distance; midpoint; volume; surface area', 'SL'),
  ('AA3.10', 3, 'Geometry and Trigonometry', 'Compound angle identities', 'AHL'),
  ('AA3.11', 3, 'Geometry and Trigonometry', 'Symmetry properties of trigonometric graphs', 'AHL'),
  ('AA3.12', 3, 'Geometry and Trigonometry', 'Vectors: basic concepts and operations', 'AHL'),
  ('AA3.13', 3, 'Geometry and Trigonometry', 'Scalar (dot) product', 'AHL'),
  ('AA3.14', 3, 'Geometry and Trigonometry', 'Vector equation of a line', 'AHL'),
  ('AA3.15', 3, 'Geometry and Trigonometry', 'Lines in space: parallel; intersecting; skew', 'AHL'),
  ('AA3.16', 3, 'Geometry and Trigonometry', 'Vector (cross) product', 'AHL'),
  ('AA3.17', 3, 'Geometry and Trigonometry', 'Vector equation of a plane', 'AHL'),
  ('AA3.18', 3, 'Geometry and Trigonometry', 'Intersections and angles between lines and planes', 'AHL'),
  ('AA3.2', 3, 'Geometry and Trigonometry', 'Trigonometry in right-angled triangles; sine and cosine rule', 'SL'),
  ('AA3.3', 3, 'Geometry and Trigonometry', 'Applications: elevation/depression; non-right-angled problems', 'SL'),
  ('AA3.4', 3, 'Geometry and Trigonometry', 'Radian measure; arc length and sector area', 'SL'),
  ('AA3.5', 3, 'Geometry and Trigonometry', 'Unit circle definitions of sine and cosine', 'SL'),
  ('AA3.6', 3, 'Geometry and Trigonometry', 'Trigonometric identities: Pythagorean and double-angle', 'SL'),
  ('AA3.7', 3, 'Geometry and Trigonometry', 'Circular functions and their graphs', 'SL'),
  ('AA3.8', 3, 'Geometry and Trigonometry', 'Solving trigonometric equations in a finite interval', 'SL'),
  ('AA3.9', 3, 'Geometry and Trigonometry', 'Reciprocal and inverse trigonometric functions', 'AHL'),
  ('AA4.1', 4, 'Statistics and Probability', 'Concepts of data; sampling and bias', 'SL'),
  ('AA4.10', 4, 'Statistics and Probability', 'Regression line of x on y', 'SL'),
  ('AA4.11', 4, 'Statistics and Probability', 'Conditional probability (formal treatment)', 'SL'),
  ('AA4.12', 4, 'Statistics and Probability', 'Standardization of normal variables', 'SL'),
  ('AA4.13', 4, 'Statistics and Probability', 'Bayes'' theorem', 'AHL'),
  ('AA4.14', 4, 'Statistics and Probability', 'Variance of discrete/continuous random variables', 'AHL'),
  ('AA4.2', 4, 'Statistics and Probability', 'Presentation of data: histograms; box-and-whisker', 'SL'),
  ('AA4.3', 4, 'Statistics and Probability', 'Measures of central tendency and dispersion', 'SL'),
  ('AA4.4', 4, 'Statistics and Probability', 'Linear correlation of bivariate data', 'SL'),
  ('AA4.5', 4, 'Statistics and Probability', 'Probability concepts and sample space', 'SL'),
  ('AA4.6', 4, 'Statistics and Probability', 'Probability diagrams: Venn; tree; sample space', 'SL'),
  ('AA4.7', 4, 'Statistics and Probability', 'Discrete random variables; expected value', 'SL'),
  ('AA4.8', 4, 'Statistics and Probability', 'Binomial distribution', 'SL'),
  ('AA4.9', 4, 'Statistics and Probability', 'Normal distribution', 'SL'),
  ('AA5.1', 5, 'Calculus', 'Introduction to calculus: limits and derivative', 'SL'),
  ('AA5.10', 5, 'Calculus', 'Indefinite integrals', 'SL'),
  ('AA5.11', 5, 'Calculus', 'Definite integrals; area under/between curves', 'SL'),
  ('AA5.12', 5, 'Calculus', 'Continuity and differentiability; first principles', 'AHL'),
  ('AA5.13', 5, 'Calculus', 'Evaluation of limits: L''Hopital''s rule and Maclaurin series', 'AHL'),
  ('AA5.14', 5, 'Calculus', 'Implicit differentiation; related rates', 'AHL'),
  ('AA5.15', 5, 'Calculus', 'Derivatives of further special functions', 'AHL'),
  ('AA5.16', 5, 'Calculus', 'Integration by substitution and by parts', 'AHL'),
  ('AA5.17', 5, 'Calculus', 'Areas and volumes of revolution', 'AHL'),
  ('AA5.18', 5, 'Calculus', 'Differential equations', 'AHL'),
  ('AA5.19', 5, 'Calculus', 'Maclaurin series', 'AHL'),
  ('AA5.2', 5, 'Calculus', 'Increasing and decreasing functions', 'SL'),
  ('AA5.3', 5, 'Calculus', 'Derivatives of polynomials', 'SL'),
  ('AA5.4', 5, 'Calculus', 'Tangents and normals', 'SL'),
  ('AA5.5', 5, 'Calculus', 'Introduction to integration', 'SL'),
  ('AA5.6', 5, 'Calculus', 'Derivatives of elementary functions; chain/product/quotient rules', 'SL'),
  ('AA5.7', 5, 'Calculus', 'Second derivative', 'SL'),
  ('AA5.8', 5, 'Calculus', 'Local maxima/minima; optimization', 'SL'),
  ('AA5.9', 5, 'Calculus', 'Kinematics problems', 'SL')
on conflict (code) do nothing;

-- ------------------------------------------------------------
-- 2. lesson_topics: what was covered in a lesson, and how it went
-- ------------------------------------------------------------
create table if not exists public.lesson_topics (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.tutors (id) on delete cascade,
  lesson_id   uuid not null references public.lessons (id) on delete cascade,
  topic_code  text not null references public.syllabus_topics (code),
  rating      smallint check (rating between 1 and 3),  -- 1 needs work, 2 developing, 3 secure; null = covered, not rated
  created_at  timestamptz not null default now(),
  unique (lesson_id, topic_code)
);

create index if not exists lesson_topics_tutor_idx
  on public.lesson_topics (tutor_id, topic_code);

alter table public.lesson_topics enable row level security;

-- Own rows only. WITH CHECK also confirms the lesson itself is the
-- tutor's, so nobody can attach topics to someone else's lesson.
drop policy if exists "Tutors manage own lesson topics" on public.lesson_topics;
create policy "Tutors manage own lesson topics"
  on public.lesson_topics for all
  to authenticated
  using (tutor_id = (select auth.uid()))
  with check (
    tutor_id = (select auth.uid())
    and exists (
      select 1 from public.lessons l
      where l.id = lesson_id
        and l.tutor_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------------
-- 3. Which syllabus does a student's subject follow?
--    Subject names are free text ("MAA HL", "IBDP MAA SL", "MA"...), so
--    this is an explicit flag instead of guessing from the text.
-- ------------------------------------------------------------
alter table public.student_subjects
  add column if not exists syllabus text;

-- Backfill only the unambiguous ones. Anything like plain "MA" or
-- "Maths" stays null until you set it from the student's subject form.
update public.student_subjects
   set syllabus = 'ib_maa'
 where syllabus is null
   and subject ilike '%MAA%';
