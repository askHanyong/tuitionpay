# Spec: Done → parent report (quick lesson capture)

Status: draft for review · Written 16 Nov 2026 · Migration assigned: **061**
Base branch for all PRs: `claude/charming-cray-new6h0`
Concept references: `Main.dc.html` (Today → **Done** → bottom sheet "How did {name} do today?" → "Report ready" preview) and `Parent.dc.html` (**Progress** tab: "Topic mastery, IB Math AA" bars + "Lesson reports" date pills).

---

## 1. Plain-language summary for Hanyong

- When you tap **Done** on a Today lesson, the lesson is marked complete exactly as it is now (billing is untouched). Then, for students with topic tracking on, a small sheet slides up: tap the topics you covered, rate each 1–4, tap a few strength chips. About 20 seconds.
- Everything saves as you tap. If you close the sheet halfway, nothing is lost and you can reopen it from the **Report** button on the lesson row.
- "Create parent report" shows the exact WhatsApp message. One tap opens WhatsApp with the text filled in.
- Parents get a new **Progress** tab on the payment link they already have (`/pay/:token`): topic mastery bars for the 5 IB Math AA topics, plus the last few lesson reports.
- Parents only ever see lessons you have actually sent. Anything you rated but did not send stays private.
- The existing Progress Report PDF (student profile) gains a topic progress section built from the same ratings.
- **Important finding:** the app today has less than the brief assumed. Topics and ratings exist (migration 054, `LessonTopicsPanel`), but there are no strengths, no "areas to improve", no topic analysis and no per-lesson WhatsApp text in the code, and `lesson_topics` has **0 rows** in the live database. This spec builds those missing parts on top of what exists. See section 5.1.

---

## 2. Scope

**In**
- Quick-capture bottom sheet after Done on Dashboard Today (and after "Done" on the overdue-lesson banner).
- Rating scale widened from 1–3 to 1–4 (Needs work / Developing / Secure / Mastered) to match the concept.
- Strength chips and an optional "Next step" line per lesson (one new small table, `lesson_reports`).
- "Recent topics" suggestions per student (derived from existing `lesson_topics`; no new storage).
- Per-lesson WhatsApp message with a link to the parent Progress view.
- Parent **Progress** tab on `/pay/:token`, served by one new SECURITY DEFINER function.
- Topic progress section in the existing Progress Report PDF and a link in its WhatsApp text.
- Topic-set mechanism that can take more syllabuses later; only IB Math AA ships.

**Out**
- Any change to `lessons`, `payment_cycles`, `recompute_payment_cycles`, `handle_lesson_change`, `get_payment_summary`, earnings logic, agency/practitioner code.
- The "$225 earned" line in the concept sheet header. Showing money there would mean re-deriving agency share and practice rules; the header says "Lesson done ✓" instead.
- AI-written report text. `lessons.parent_summary` (the existing "✨ Summarise for parent" output in `Lessons.jsx`) is left exactly as it is.
- Sending WhatsApp automatically. The tutor always taps send inside WhatsApp.

**Later**
- More topic sets (IB Math AI, A-level H2 Math, O-level E/A Math). Recipe in section 6.8.
- Tutor-written note per syllabus topic on the parent page (the concept shows hand-written notes; v1 generates the note from ratings).
- Custom strength chips per tutor.
- Capture sheet from Calendar's Done (`Calendar.jsx` line ~344) and from `Lessons.jsx`.
- Free-text topics for students with no syllabus.

---

## 3. User stories and flows

### 3.1 Tutor: Done → rate → send (concept: `Main.dc.html`, Today list → sheet)

1. Tutor taps **✓ Done** on a Today lesson (`Dashboard.jsx`, `handleMarkDone`).
2. The existing update `lessons.is_completed = true` runs first, unchanged. Existing toast shows. Billing triggers fire as today.
3. Only if that update succeeded, and the student has topic tracking on, and the tutor has not switched auto-open off: the report sheet opens for that lesson.
4. Sheet step 1 ("rate"): suggested topics from this student's last lessons appear as chips. Tap a chip to add it to "Today's topics"; tap 1–4 to rate. Tap strength chips. Optionally type a next step.
5. Every tap saves immediately. **Skip**, the ✕, tapping the backdrop, or closing the browser all leave the lesson Done and keep whatever was entered.
6. **Create parent report** → step 2 ("preview"): the WhatsApp message in a chat bubble. **Send on WhatsApp** opens `wa.me` with the text prefilled and marks the lesson's report as shared. **Edit** goes back to step 1.
7. The Today row now shows **Report sent** and a **Report** button to reopen the sheet.

### 3.2 Tutor: skip now, do it later

1. Tutor taps Done, then Skip (or the sheet never opened because auto-open is off).
2. Later, taps **Report** on the done row (this replaces today's **Topics** button, same position).
3. Sheet opens with saved state. Same flow from step 4 above.

### 3.3 Parent: Progress tab (concept: `Parent.dc.html`, Progress)

1. Parent opens the link in the WhatsApp message: `https://chopeandpay.com/pay/<token>?tab=progress`.
2. Page shows tabs **Pay** | **Progress**, with Progress selected.
3. Headline sentence, topic mastery bars (tap a bar to see its note), then "Lesson reports" with date pills (latest selected).
4. Parent taps **Pay** to see the existing payment summary, unchanged.
5. A parent opening the plain `/pay/<token>` link sees the Pay tab first; the Progress tab only appears if at least one report has been shared.

### 3.4 Tutor: monthly report

1. Student profile → **📄 Progress Report** (existing `ProgressReportModal`).
2. New tick box, on by default: "Include topic progress". PDF gains "Topic progress" and "Lesson reports" sections.
3. **Share via WhatsApp** text gains the Progress link. Second tick box, on by default: "Show these lesson reports on the parent's Progress page" marks rated lessons in the chosen range as shared.

---

## 4. UI spec

Match existing app styling (Tailwind, navy `#1b2d4f`, green `#5ecfaa`, dark green `#0f7a58`, pale green `#edf6f3`). Use the concept for layout and proportions, not for fonts.

### 4.1 `LessonReportSheet` (new component, `src/components/LessonReportSheet.jsx`)

Container: same shell as `LessonTopicsModal` (bottom sheet on mobile `items-end`, centred card from `sm:`), `max-h-[90vh] overflow-y-auto`, drag-handle bar at top as in the concept. All tap targets `min-h-11` (44px).

**Step "rate"**

| Element | Detail |
|---|---|
| Eyebrow | `LESSON DONE ✓` (small caps, dark green). No money figure. |
| Title | `How did {firstName} do today?` If the lesson date is not today: `How did {firstName} do on {Mon 16 Nov}?` |
| Sub-line | `About 20 seconds. This becomes the parent's progress report.` |
| Suggested | Label `Recent for {firstName}`. Up to 6 chips, each `{code} {short subtopic name}` (truncate with CSS to one line). Tap = add to Today's topics (chip disappears from suggestions). Hidden when there are no suggestions. |
| Today's topics | One block per selected topic: name left, rating label right (dark green), then a 4-column grid of buttons `1 2 3 4`. Buttons up to the chosen rating are filled navy (cumulative fill, as in the concept). Tapping the current rating clears it back to unrated (same rule as today's panel). Small ✕ removes the topic. |
| Add other | Button `+ Other topic`. Opens the picker inline: search box (`Search topics, e.g. chain rule or 5.6`) above the existing 5-group accordion from `LessonTopicsPanel`. SL students get the existing "Also show HL-only topics" tick box. If there are no suggestions and no topics yet, the picker starts open. |
| Strengths | Label `Strengths today`. 8 pill chips (list in 6.4), multi-select, `aria-pressed`. |
| Next step | Collapsed link `+ Next step for the parent (optional)` → single-line input, max 200 characters, placeholder `e.g. Definite integrals next week. Practice set shared.` Stays expanded if it has text. |
| Buttons | Primary `Create parent report` (flex 2) · secondary `Skip` (flex 1). Primary is disabled, with hint `Add a topic or a strength first`, until there is at least one topic, strength or next-step text. |
| Footer link | `Don't open this automatically after Done` (small grey text). Tapping sets the localStorage flag, shows toast `OK. Tap Report on a done lesson whenever you want it.`, and closes the sheet. |

**Step "preview"**

| Element | Detail |
|---|---|
| Eyebrow | `REPORT READY` |
| Title | `For {guardian_name}` or `For {firstName}'s parent` when no guardian name. |
| Bubble | Pale green chat bubble containing the exact message text (`whitespace-pre-wrap`). Read-only. |
| No phone hint | If `normalizeWhatsAppNumber(student.guardian_contact)` is null: amber line `No parent number saved. WhatsApp will ask you to pick a contact.` |
| Buttons | `Send on WhatsApp` (green, flex 2) · `Edit` (flex 1). Below: text link `Copy message instead`. |
| After send | Line under the buttons: `Visible on the parent's Progress page · Hide`. `Hide` clears `shared_at`. |

**States**

- Loading: `Loading…` line inside the sheet (sheet opens immediately, content follows).
- Tracking off for this lesson's subject (hook returns `off`): sheet does not open from Done; if opened via Report it shows `Topic tracking is off for this subject. Turn it on in the student's subject settings.` plus strengths and next step (which still work).
- Load error: `Couldn't load this lesson's report: {message}` and a `Try again` button.
- Save error: red line at the bottom `Couldn't save: {message}`; the optimistic change is rolled back (existing pattern). Never fail silently.
- Offline: saving fails with the error line above; the lesson is already Done.

### 4.2 Today row changes (`Dashboard.jsx`, done branch of the Today list)

- Rename the **Topics** button to **Report** (same condition `topicTrackedStudentIds.has(l.student_id)`), opening `LessonReportSheet` instead of `LessonTopicsModal`.
- Badge: `✓ Done` becomes `✓ Report sent` when the lesson's `lesson_reports.shared_at` is not null.
- Undo is unchanged.

### 4.3 `LessonTopicsPanel` (lesson detail modal)

Keeps working, now with 4 rating buttons using the shared `RATING_OPTIONS`. No other change. `LessonTopicsModal.jsx` becomes unused on the Dashboard; leave the file in place.

### 4.4 Parent page: Progress tab (`PaymentSummary.jsx` + new `src/components/ParentProgress.jsx`)

- Tab bar under the logo: `Pay` | `Progress`, pill style. Rendered only when the progress RPC returned at least one report, or the URL has `?tab=progress`.
- The existing payment card is wrapped unchanged as the Pay tab.
- Progress tab content (mobile-first, `max-w-xl`):
  1. **Headline** (h1) and sub-line, see 6.6.
  2. **Card "Topic mastery, {syllabus label}"** with `Tap a topic` hint. One row per syllabus topic group: name, level label, 10px bar. Tapping selects the row; the note box under the bars shows that topic's note. First row with data is selected by default.
  3. **"Lesson reports"**: horizontally scrollable date pills (`Tue 10 Nov`), latest selected, max 12. Card below: each topic with 4 small dots and label; then `Strengths.` and `To work on.` lines (each hidden when empty).
- States: loading `Loading progress…`; empty `No lesson reports yet. {tutorFirstName} will share updates here after lessons.`; error `We couldn't load progress right now. Please try again in a moment.` (payment tab must still work).
- Footer unchanged.

### 4.5 `ProgressReportModal` additions

- Tick box `Include topic progress` (default on; hidden when the student has no tracked subject).
- Tick box `Show these lesson reports on the parent's Progress page` (default on; same visibility).
- Inline status `Loading topic progress…` and error `Couldn't load topic progress: {message}. The PDF will be generated without it.`

---

## 5. Data model

### 5.1 What exists today (verified 16 Nov 2026 against the repo and the live database)

| Thing | Where | Notes |
|---|---|---|
| `syllabus_topics` | migration 054; live: 83 rows, all `syllabus = 'ib_maa'` | Columns `code` (PK, e.g. `AA5.8`), `syllabus`, `topic_number`, `subtopic_number` (generated), `topic_name`, `subtopic_name`, `level_scope` (`SL`/`AHL`, check `syllabus_topics_level_scope_check`). SELECT policy for `authenticated` only. |
| `lesson_topics` | migration 054; live: **0 rows** | `id, tutor_id, lesson_id, topic_code, rating smallint, created_at`; unique `(lesson_id, topic_code)`; check `lesson_topics_rating_check` (1–3); one `FOR ALL` policy "Tutors manage own lesson topics" (authenticated). |
| `student_subjects.syllabus` | migration 054; live values: null ×34, `ib_maa` ×17, `ib_maa_hl` ×7, `ib_maa_sl` ×1 | Every student currently has exactly one subject row. Two tutors have tracked students. |
| `lessons` | live | `is_completed`, `student_subject_id`, `subject`, `lesson_date` (date), `lesson_time`, `parent_summary`. The UPDATE trigger `on_lesson_update` fires on **every** update of a lessons row (no column list), which is why this spec stores nothing new on `lessons`. |
| `students.payment_token` | live | text, default `gen_random_uuid()::text`; 68 students, 0 null, all distinct, length 36. No unique index. |
| `get_payment_summary(p_token text)` | live | SQL, SECURITY DEFINER, executable by anon. Not modified by this spec. |
| `LessonTopicsPanel.jsx`, `LessonTopicsModal.jsx`, `lib/lessonTopics.js`, `hooks/useTopicTrackedStudents.js` | repo | Pick subtopics, rate Shaky/Okay/Solid, each tap saves (optimistic upsert on `lesson_id,topic_code`). |
| Dashboard Done | `Dashboard.jsx` `handleMarkDone` (~line 864), Today list (~line 1330), `handleMarkOverdueLessonDone` (~line 1131) | Done row shows a **Topics** button for tracked students. |
| Progress report | `ProgressReportModal.jsx`, `lib/progressReport.js` | PDF with student details, lesson history, payment summary, tutor note. **No topics, no strengths.** WhatsApp text is a one-liner asking the parent to see the attached PDF. |
| Monthly report | `lib/monthlyReport.js`, `MonthlyReportTemplate.jsx` | Tutor's own earnings report. Not parent-facing. Not touched. |
| `students.is_practice` | **not live yet** (migration 059 pending) | Migration 061 does not reference it. |

Not found anywhere in the repo (all local branches) or database: strengths, areas to improve, topic analysis, per-lesson WhatsApp text, a "report link" route. If these exist on a branch that is not in this checkout, stop and reconcile before building (see Open question 1).

### 5.2 Proposed changes (migration 061)

1. `lesson_topics.rating`: widen the check from 1–3 to 1–4. Meanings 1–3 are unchanged (needs work / developing / secure, as documented in 054); 4 = mastered. No data rewrite is ever needed.
2. New table `lesson_reports`: one optional row per lesson holding strengths, next step and `shared_at`. It is a separate table, not columns on `lessons`, because any update to `lessons` runs the billing trigger.
3. New function `get_progress_summary(p_token text)`: the only way the anon parent page reads progress.
4. `syllabus_topics.level_scope`: allow a third value `CORE` for future syllabuses that have no SL/HL split. No rows change.

No change to `students`, `lessons`, `payment_cycles`, `student_subjects` or any existing function.

### 5.3 Migration file: `supabase/migrations/061_lesson_reports_and_parent_progress.sql`

```sql
-- ============================================================
-- 061_lesson_reports_and_parent_progress.sql
-- Done -> parent report (quick lesson capture).
--
--  1. lesson_topics.rating: 1-3 becomes 1-4 (4 = mastered). 1-3 keep
--     their meaning, so existing rows (none live on 16 Nov 2026) stay valid.
--  2. lesson_reports: optional per-lesson strengths, next step, and
--     shared_at (null = private to the tutor; set = visible to the parent).
--  3. get_progress_summary(p_token): SECURITY DEFINER read for the anon
--     parent page. Returns ONLY shared reports of the one student whose
--     payment_token matches.
--  4. syllabus_topics.level_scope: also allow 'CORE' (future syllabuses).
--
-- Does NOT touch lessons, students, payment_cycles, student_subjects,
-- recompute_payment_cycles, handle_lesson_change, get_payment_summary,
-- or any agency_* / practitioner_* object.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Ratings 1-4
-- ------------------------------------------------------------
ALTER TABLE public.lesson_topics
  DROP CONSTRAINT IF EXISTS lesson_topics_rating_check;

ALTER TABLE public.lesson_topics
  ADD CONSTRAINT lesson_topics_rating_check
  CHECK (rating BETWEEN 1 AND 4);

COMMENT ON COLUMN public.lesson_topics.rating IS
  '1 needs work, 2 developing, 3 secure, 4 mastered; null = covered, not rated';

-- ------------------------------------------------------------
-- 2. lesson_reports
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lesson_reports (
  lesson_id   uuid PRIMARY KEY REFERENCES public.lessons (id) ON DELETE CASCADE,
  tutor_id    uuid NOT NULL REFERENCES public.tutors (id) ON DELETE CASCADE,
  strengths   text[] NOT NULL DEFAULT '{}',
  next_steps  text,
  shared_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lesson_reports_strengths_max CHECK (cardinality(strengths) <= 12),
  CONSTRAINT lesson_reports_next_steps_len CHECK (next_steps IS NULL OR char_length(next_steps) <= 500)
);

COMMENT ON TABLE public.lesson_reports IS
  'Optional per-lesson parent report: strength chip keys, next step, and when it was shared with the parent. Topics and ratings live in lesson_topics.';
COMMENT ON COLUMN public.lesson_reports.strengths IS
  'Stable chip keys, e.g. clear_working. Labels live in src/lib/lessonReport.js.';
COMMENT ON COLUMN public.lesson_reports.shared_at IS
  'NULL = tutor-private. Set when the tutor sends or copies the report; only then does get_progress_summary expose this lesson.';

CREATE INDEX IF NOT EXISTS lesson_reports_tutor_idx
  ON public.lesson_reports (tutor_id);

ALTER TABLE public.lesson_reports ENABLE ROW LEVEL SECURITY;

-- The parent page never reads this table directly (it uses the function
-- below), so anon gets no table privileges at all.
REVOKE ALL ON public.lesson_reports FROM anon;

DROP POLICY IF EXISTS "Tutors select own lesson reports" ON public.lesson_reports;
CREATE POLICY "Tutors select own lesson reports"
  ON public.lesson_reports FOR SELECT
  TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Tutors insert own lesson reports" ON public.lesson_reports;
CREATE POLICY "Tutors insert own lesson reports"
  ON public.lesson_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    tutor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_id
        AND l.tutor_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tutors update own lesson reports" ON public.lesson_reports;
CREATE POLICY "Tutors update own lesson reports"
  ON public.lesson_reports FOR UPDATE
  TO authenticated
  USING (tutor_id = (SELECT auth.uid()))
  WITH CHECK (
    tutor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.lessons l
      WHERE l.id = lesson_id
        AND l.tutor_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Tutors delete own lesson reports" ON public.lesson_reports;
CREATE POLICY "Tutors delete own lesson reports"
  ON public.lesson_reports FOR DELETE
  TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

-- ------------------------------------------------------------
-- 3. Parent read: get_progress_summary
--    Returns NULL when the token matches no live student.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_progress_summary(p_token text)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH s AS (
    SELECT st.id, st.tutor_id, st.name
    FROM students st
    WHERE p_token IS NOT NULL
      AND length(p_token) >= 32
      AND st.payment_token = p_token
      AND st.deleted_at IS NULL
    LIMIT 1
  ),
  shared AS (
    SELECT l.id AS lesson_id, l.lesson_date, l.lesson_time, l.subject,
           r.strengths, r.next_steps
    FROM lessons l
    JOIN s ON s.id = l.student_id AND s.tutor_id = l.tutor_id
    JOIN lesson_reports r ON r.lesson_id = l.id
    WHERE r.shared_at IS NOT NULL
      AND l.is_completed IS TRUE
      AND l.lesson_date >= (now() AT TIME ZONE 'Asia/Singapore')::date - 730
  ),
  ratings AS (
    SELECT sh.lesson_date, lt.topic_code, tp.syllabus, tp.topic_number,
           tp.subtopic_number, tp.topic_name, tp.subtopic_name,
           tp.level_scope, lt.rating
    FROM shared sh
    JOIN lesson_topics lt ON lt.lesson_id = sh.lesson_id
    JOIN syllabus_topics tp ON tp.code = lt.topic_code
  )
  SELECT json_build_object(
    'student_name', s.name,
    'tutor_first_name', split_part(t.full_name, ' ', 1),
    'syllabus', (
      SELECT ss.syllabus FROM student_subjects ss
      WHERE ss.student_id = s.id AND ss.syllabus IS NOT NULL
      ORDER BY ss.created_at
      LIMIT 1
    ),
    'ratings', COALESCE((
      SELECT json_agg(json_build_object(
        'lesson_date',   r.lesson_date,
        'code',          r.topic_code,
        'syllabus',      r.syllabus,
        'topic_number',  r.topic_number,
        'topic_name',    r.topic_name,
        'subtopic_name', r.subtopic_name,
        'level_scope',   r.level_scope,
        'rating',        r.rating
      ) ORDER BY r.lesson_date DESC, r.topic_number, r.subtopic_number)
      FROM ratings r
    ), '[]'::json),
    'reports', COALESCE((
      SELECT json_agg(x.obj ORDER BY x.lesson_date DESC, x.lesson_time DESC NULLS LAST)
      FROM (
        SELECT sh.lesson_date, sh.lesson_time,
          json_build_object(
            'lesson_date', sh.lesson_date,
            'subject',     sh.subject,
            'strengths',   to_json(sh.strengths),
            'next_steps',  sh.next_steps,
            'topics', COALESCE((
              SELECT json_agg(json_build_object(
                'code',   lt.topic_code,
                'name',   tp.subtopic_name,
                'rating', lt.rating
              ) ORDER BY tp.topic_number, tp.subtopic_number)
              FROM lesson_topics lt
              JOIN syllabus_topics tp ON tp.code = lt.topic_code
              WHERE lt.lesson_id = sh.lesson_id
            ), '[]'::json)
          ) AS obj
        FROM shared sh
        ORDER BY sh.lesson_date DESC, sh.lesson_time DESC NULLS LAST
        LIMIT 12
      ) x
    ), '[]'::json),
    'outline', COALESCE((
      SELECT json_agg(json_build_object(
        'syllabus',     o.syllabus,
        'topic_number', o.topic_number,
        'topic_name',   o.topic_name,
        'total',        o.total,
        'sl_total',     o.sl_total
      ) ORDER BY o.syllabus, o.topic_number)
      FROM (
        SELECT tp.syllabus, tp.topic_number, min(tp.topic_name) AS topic_name,
               count(*) AS total,
               count(*) FILTER (WHERE tp.level_scope <> 'AHL') AS sl_total
        FROM syllabus_topics tp
        WHERE tp.syllabus IN (SELECT DISTINCT r.syllabus FROM ratings r)
        GROUP BY tp.syllabus, tp.topic_number
      ) o
    ), '[]'::json)
  )
  FROM s
  JOIN tutors t ON t.id = s.tutor_id;
$$;

COMMENT ON FUNCTION public.get_progress_summary(text) IS
  'Anon parent Progress tab on /pay/:token. Returns only lessons whose lesson_reports.shared_at is set, for the single student matching the payment token.';

REVOKE ALL ON FUNCTION public.get_progress_summary(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_progress_summary(text) TO anon, authenticated;

-- ------------------------------------------------------------
-- 4. Future syllabuses without an SL/HL split
-- ------------------------------------------------------------
ALTER TABLE public.syllabus_topics
  DROP CONSTRAINT IF EXISTS syllabus_topics_level_scope_check;

ALTER TABLE public.syllabus_topics
  ADD CONSTRAINT syllabus_topics_level_scope_check
  CHECK (level_scope IN ('SL', 'AHL', 'CORE'));

COMMIT;
```

The body of `get_progress_summary` was dry-run on 16 Nov 2026 as a plain read-only SELECT against the live database (with stand-in CTEs for `lesson_reports`) and returned well-formed JSON. The function itself has not been created.

### 5.4 Verification queries (run after the migration; all read-only)

```sql
-- A. Rating check is now 1..4, level_scope allows CORE
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname IN ('lesson_topics_rating_check', 'syllabus_topics_level_scope_check');

-- B. lesson_reports exists with RLS on and exactly 4 policies (SELECT/INSERT/UPDATE/DELETE, authenticated)
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.lesson_reports'::regclass;
SELECT policyname, cmd, roles FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'lesson_reports' ORDER BY cmd;

-- C. anon has no table privileges on lesson_reports (expect 0 rows)
SELECT privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'lesson_reports' AND grantee = 'anon';

-- D. Function is SECURITY DEFINER with pinned search_path; anon can execute, PUBLIC cannot
SELECT prosecdef, proconfig FROM pg_proc
WHERE proname = 'get_progress_summary' AND pronamespace = 'public'::regnamespace;
SELECT has_function_privilege('anon', 'public.get_progress_summary(text)', 'execute') AS anon_can,
       has_function_privilege('authenticated', 'public.get_progress_summary(text)', 'execute') AS auth_can;

-- E. Wrong or short token returns NULL
SELECT public.get_progress_summary('nope') IS NULL AS short_token_null,
       public.get_progress_summary('00000000-0000-0000-0000-000000000000') IS NULL AS unknown_token_null;

-- F. A real token with nothing shared returns empty arrays, not an error
SELECT public.get_progress_summary(
  (SELECT payment_token FROM students WHERE deleted_at IS NULL LIMIT 1)
) -> 'reports';   -- expect []

-- G. Nothing else moved
SELECT count(*) FROM lesson_topics;      -- same as before the migration
SELECT count(*) FROM syllabus_topics;    -- 83
```

---

## 6. Logic and edge cases

### 6.1 Done must stay instant and independent

- `handleMarkDone` keeps its current order: optimistic state → `update({ is_completed: true })` → on error roll back and toast → on success toast, `loadAll()`, payment notification check.
- The only addition: after the success toast, `maybeOpenReportSheet(lesson)`. It must not be awaited before `loadAll()` and must not wrap or delay the update.
- If the update fails, the sheet does not open.
- The sheet never writes to `lessons`. It writes only `lesson_topics` and `lesson_reports`. Neither has triggers. So `recompute_payment_cycles` cannot be affected.
- Same hook-in for `handleMarkOverdueLessonDone`.

### 6.2 When the sheet opens automatically

All must be true:
1. The is_completed update succeeded.
2. `topicTrackedStudentIds.has(lesson.student_id)` (existing hook).
3. localStorage key `chopeandpay_report_sheet_auto` is not `"off"` (read inside try/catch; on any error treat as on).

Students without topic tracking, and practitioner accounts (no tracked subjects), see no change at all.

### 6.3 Saving partial input

- Topics and ratings: reuse the existing optimistic upsert/delete on `lesson_topics` (`onConflict: "lesson_id,topic_code"`). Move that logic from `LessonTopicsPanel` into a hook `src/hooks/useLessonTopics.js` used by both the panel and the sheet. Behaviour of the panel must not change.
- Strengths: on each chip toggle, `upsert({ lesson_id, tutor_id, strengths }, { onConflict: "lesson_id" })`. Only the supplied columns are updated on conflict, so `next_steps` and `shared_at` are preserved.
- Next step: save on blur and before moving to preview, `upsert({ lesson_id, tutor_id, next_steps })`. Trim; empty string saves null. Enforce 200 characters in the input (`maxLength`); the database allows 500.
- All writes are idempotent. Two devices editing the same lesson: last write wins per field; no duplicates are possible (PK `lesson_id`, unique `(lesson_id, topic_code)`).
- Every failed write shows the visible error line and rolls back local state.

### 6.4 Strength chips (constants in new `src/lib/lessonReport.js`)

| Key | Label |
|---|---|
| `clear_working` | Clear working |
| `good_questions` | Asked good questions |
| `faster_recall` | Faster recall |
| `stayed_focused` | Stayed focused |
| `worked_independently` | Worked independently |
| `checked_answers` | Checked own answers |
| `homework_done` | Homework done |
| `kept_trying` | Kept trying |

Store keys, never labels. Unknown keys (from a future version) render as the key with underscores replaced by spaces. Parent page uses the same map.

### 6.5 Recent topics per student (no new storage)

Query when the sheet opens:

```js
supabase
  .from("lesson_topics")
  .select("topic_code, created_at, lessons!inner(student_id, lesson_date)")
  .eq("tutor_id", user.id)
  .eq("lessons.student_id", studentId)
  .neq("lesson_id", lessonId)
  .order("created_at", { ascending: false })
  .limit(40)
```

Sort client-side by `lessons.lesson_date` desc then `created_at` desc, de-duplicate by `topic_code`, drop codes already selected for this lesson, keep the first 6. Limit 40 keeps this far below the 1,000-row cap. If the query fails, show no suggestions and no error (the picker still works).

### 6.6 Mastery calculation (new `src/lib/topicMastery.js`, used by the parent page and the PDF)

One implementation in JS; nothing is computed in SQL beyond returning rows.

Input: `ratings` rows (`lesson_date, code, topic_number, topic_name, subtopic_name, level_scope, rating`), `outline` rows, `syllabus`.

1. For each subtopic `code`, take the **latest** row with a non-null rating (highest `lesson_date`). That is the subtopic's current rating.
2. For each topic group: `avg` = mean of current ratings; `pct = round(avg / 4 * 100)`.
3. Level label from `avg`: ≥ 3.5 `Mastered`; ≥ 2.5 `Secure`; ≥ 1.5 `Developing`; otherwise `Needs work`. Group with covered-but-unrated subtopics only: `Covered`, pct 0. Group with nothing: `Not started`, pct 0, grey text.
4. `covered` = distinct codes in the group (rated or not). `total` = `outline.sl_total` when `syllabus === "ib_maa_sl"` and no covered code in that group has `level_scope === "AHL"`; otherwise `outline.total`.
5. Note per group: `{covered} of {total} subtopics covered. Strongest: {subtopic}. Working on: {subtopic}.` Strongest = highest current rating (tie → most recent). "Working on" = lowest current rating if it is ≤ 2; otherwise replace that sentence with `Nothing shaky right now.` With a single rated subtopic, omit "Strongest".
6. Bar colour as in the concept: pct ≥ 70 navy `#1b2d4f`, ≥ 55 `#3f9f84`, else `#5ecfaa`.
7. Headline: two or more rated groups → `{firstName} is strongest in {top group}, and {lowest group} is coming along` (group names lower-case); if top and lowest are equal → `{firstName} is doing steadily across {n} topics`; one rated group → `{firstName} is working on {group}`; none → `Here is what {firstName} has been covering`.
8. Sub-line: `From {tutorFirstName}'s ratings over {n} lessons since {Mon YYYY}`, where n = distinct `lesson_date` values and the month is the earliest.

Syllabus label: `ib_maa_hl` → `IB Math AA HL`, `ib_maa_sl` → `IB Math AA SL`, `ib_maa` → `IB Math AA`. If `ratings` contains more than one `syllabus` value (not possible today), render one mastery card per syllabus.

### 6.7 The WhatsApp message (`buildLessonReportMessage` in `src/lib/whatsapp.js`)

```
Hi Mrs Tan! Quick update on Jamie's lesson (Mon 16 Nov, IB Math AA HL) 📘

Topics covered:
• Integration by substitution and by parts: Secure (3/4)
• Kinematics problems: Developing (2/4)

💪 Strengths: clear working, asked good questions.
🎯 Next: Definite integrals next week. Practice set shared.

📈 Full progress: https://chopeandpay.com/pay/<token>?tab=progress

— Mr Lee
```

Rules:
- Greeting uses the existing private `greeting(guardianName)` helper (`Hi!` when no name).
- Student first name = first word of `students.name`. Subject = `lesson.subject ?? student.subject`; omit `, {subject}` if neither exists.
- Date is formatted from the `lesson_date` string with `formatSGTDate`-style parsing (`new Date(y, m-1, d)`), never `new Date("YYYY-MM-DD")` and never `toISOString()`. Say `today's lesson` when `lesson_date` equals today's local date key.
- Topic line: `• {subtopic_name}: {label} ({n}/4)`; unrated topic: `• {subtopic_name}`. Whole "Topics covered" block omitted when there are none.
- Strengths line: labels lower-cased, comma-joined, full stop. Omitted when none.
- Next line omitted when blank. Never invent a next step.
- Link line: new helper `buildProgressUrl(token)` → `https://chopeandpay.com/pay/${token}?tab=progress` (production host, same convention as `buildPaymentSummaryUrl`). Omitted if the student has no token.
- Sign-off uses the tutor name the Dashboard already passes to `buildPaymentRequestMessage`.
- Open with the existing `buildWhatsAppLink(message, student.guardian_contact)`.

### 6.8 Sharing rule (privacy)

- `lesson_reports.shared_at` is set to `new Date().toISOString()` when the tutor taps **Send on WhatsApp** or **Copy message instead** (upsert; do not overwrite an existing non-null value). `Hide` sets it to null.
- The parent function returns a lesson only if `shared_at IS NOT NULL` **and** the lesson is completed. Undo Done hides it from parents automatically; the saved report data is kept.
- Mastery bars on the parent page are computed only from shared lessons. The tutor's PDF uses all rated lessons in the chosen range.
- The monthly modal's second tick box bulk-shares: for lessons in range that have at least one `lesson_topics` row or a `lesson_reports` row, upsert `{ lesson_id, tutor_id, shared_at }` where not already shared. Chunk upserts by 200 rows.

### 6.9 Topic-set mechanism (extensible; AA ships)

Three layers, all already half-present:

1. **Database:** `syllabus_topics.syllabus` names the topic set (`ib_maa`). A new set is a data-only migration that inserts rows with a new `syllabus` value and a unique code prefix (e.g. `H2.1.1`), `level_scope = 'CORE'` when there is no SL/HL split.
2. **Student option → topic set:** replace the hard-coded `isIbMaa` checks with a registry in `src/lib/lessonTopics.js`:

```js
export const SYLLABUS_REGISTRY = {
  ib_maa_hl: { label: "IB Math AA – HL", shortLabel: "IB Math AA HL", topicSet: "ib_maa", showAhl: true },
  ib_maa_sl: { label: "IB Math AA – SL", shortLabel: "IB Math AA SL", topicSet: "ib_maa", showAhl: false },
  // later: sg_h2_math: { label: "A-Level H2 Math", shortLabel: "H2 Math", topicSet: "sg_h2_math", showAhl: true },
};
```

   `SYLLABUS_OPTIONS` is generated from the registry (plus the "Off" option). `topicSetFor(syllabus)` returns `registry[syllabus]?.topicSet`, treating legacy `"ib_maa"` as `ib_maa` via the existing `normalizeSyllabus`. `isIbMaa` stays exported for compatibility but callers move to `topicSetFor(...) != null`.
3. **Loading:** `loadSyllabusTopics(topicSet = "ib_maa")` caches one promise per set (a `Map`) instead of the single module-level promise.

The parent function and mastery lib already key everything by `syllabus`, so a new set needs no SQL function change.

### 6.10 Money, students and domains

- Nothing money-related changes. No earnings, cycles or amounts are read or written by any new code. The sheet header shows no amount.
- **Practice students** (migration 059): the feature behaves identically. No `is_practice` check is added anywhere in this feature, and migration 061 does not depend on 059.
- **Agency set-up A/B, placement fees, waived/overdue cycles:** not applicable; untouched.
- **Archived students:** hidden from Today as now; their shared reports stay visible on the parent link. **Soft-deleted students:** `get_progress_summary` returns NULL (Progress tab hidden); the Pay tab keeps working as today.
- **Lesson deleted:** `lesson_topics` and `lesson_reports` rows cascade away.
- **Student with several subjects** (none live today): `resolveLessonSubject` already decides which subject a lesson belongs to; if it cannot, tracking is treated as off for that lesson.
- **Domain isolation:** practitioner and agency pages are not edited. `/pay/:token` gains a tab that is hidden unless a tutor has shared a report for that student, so practitioner clients' payment pages are visually unchanged. The progress RPC failing must never break the payment view (separate call, separate error state).

### 6.11 Timezone, limits

- `lesson_date` is a plain date; all display parses it as a local date. The 24-month window in SQL uses `now() AT TIME ZONE 'Asia/Singapore'`.
- `shared_at` is a `timestamptz`; an ISO UTC string is correct for it. If ever displayed, format with `timeZone: "Asia/Singapore"`.
- Parent RPC returns one JSON value, so the 1,000-row cap does not apply; the window is bounded to 24 months and 12 reports.
- Tutor-side range queries for the PDF (phase 5) must page with `.range()` in steps of 1,000.

---

## 7. Security / RLS review checklist

- [ ] `lesson_reports` has RLS enabled and four explicit policies (SELECT, INSERT, UPDATE, DELETE), all `TO authenticated`, all scoped `tutor_id = auth.uid()`.
- [ ] INSERT and UPDATE `WITH CHECK` also require the lesson to belong to the same tutor (cannot attach a report to another tutor's lesson id).
- [ ] The policies reference only `lessons`. `lessons` policies do not reference `lesson_reports`, so there is no circular policy chain. (Same shape as the live 054 policy.)
- [ ] `anon` has no privileges on `lesson_reports` (explicit REVOKE; verification query C).
- [ ] No new anon SELECT policy on any table. `lesson_topics`, `syllabus_topics`, `lessons`, `students` policies are unchanged.
- [ ] `get_progress_summary` is SECURITY DEFINER with `search_path = public, pg_temp`; EXECUTE revoked from PUBLIC and granted only to `anon`, `authenticated`.
- [ ] The function filters every row through the single student matched by `payment_token`, and additionally requires `l.tutor_id = s.tutor_id`.
- [ ] The function returns no ids, no phone numbers, no guardian details, no rates or amounts, no tutor surname or email, no lesson notes, no `parent_summary`.
- [ ] Only lessons with `shared_at IS NOT NULL` and `is_completed` are exposed.
- [ ] Tokens shorter than 32 characters, null tokens and unknown tokens return NULL (no error text that confirms existence).
- [ ] Frontend calls from the tutor app always include `.eq("tutor_id", user.id)` as the existing code does (defence in depth).
- [ ] The parent page calls the RPC with the anon key and must work in a logged-out private window (the anon vs authenticated mismatch test).
- [ ] The Progress link carries the same token as the payment link. Anyone holding it can see both payment status and shared reports for that one student. This is accepted (same audience); note it in the What's New text.

---

## 8. Acceptance tests

Use a **practice or test student** with subject syllabus set to IB Math AA – HL, a guardian name and your own phone number as the guardian contact. Previews use the live database.

### After phase 1 (schema)
1. Run verification queries A–G. All match the expected results.
2. Open the app (production, no frontend change yet). Open a lesson detail, add a topic, rate it Solid. It saves. (Old 1–3 UI still works under the 1–4 check.)

### After phase 2 (sheet)
3. Dashboard → Today → tap **✓ Done** on the test student's lesson. Expected: row turns green at once, toast "Lesson marked complete ✓", then the sheet slides up titled "How did {first name} do today?".
4. Tap **Skip**. Expected: sheet closes, lesson still Done. Refresh the page: still Done. Payments page shows the same notices as it would have without the sheet.
5. Tap **Report** on the done row. Sheet opens. With no history, the topic picker is open. Type `chain` in search: only matching subtopics show.
6. Add two topics, rate one 3 and one 2. Labels read "Secure" and "Developing". Tap rating 2 again on the second: it clears to unrated.
7. Tap two strength chips. Close the sheet with ✕. Reopen with **Report**: topics, ratings and chips are all still there.
8. Mark another lesson Done for the same student (schedule one for today if needed). Expected: "Recent for {first name}" shows the topics from step 6 as chips. Tapping a chip moves it into Today's topics.
9. With nothing entered, **Create parent report** is disabled and shows "Add a topic or a strength first".
10. Tap "Don't open this automatically after Done". Mark another lesson Done: no sheet. The **Report** button still opens it. (To re-enable: clear the `chopeandpay_report_sheet_auto` key in browser storage, or see Open question 5.)
11. Mark Done a student **without** topic tracking: no sheet, behaviour exactly as before.
12. Tap **Undo** on a lesson that has a saved report, then Done again, then Report: saved data is still there.
13. Open the lesson from Lessons → detail modal: "Topics covered" panel shows the same topics with four rating buttons.
14. Turn on flight mode, open Report, tap a rating. Expected: red "Couldn't save: …" line and the rating snaps back.
15. Overdue banner: a past lesson not marked done → tap its Done action. Expected: marked complete, sheet opens with title "How did {first name} do on {date}?".

### After phase 3 (message)
16. In the sheet, tap **Create parent report**. Preview shows the message. Check: greeting uses the guardian name; topic lines show label and `(n/4)`; strengths line lists the chips in lower case; no "Next" line when the field is empty; link ends with `?tab=progress`.
17. Tap **Edit**, add a next step, **Create parent report** again: "🎯 Next:" line appears.
18. Tap **Send on WhatsApp**. WhatsApp opens to the guardian number with the text prefilled. Back in the app the row badge reads **✓ Report sent** and the sheet shows "Visible on the parent's Progress page · Hide".
19. Remove the guardian contact from the student, reopen preview: amber "No parent number saved…" line shows; Send opens WhatsApp's contact picker.
20. Tap **Hide**: badge returns to **✓ Done**.

### After phase 4 (parent page)
21. In a private (logged-out) window open `https://deploy-preview-N--tuitionpay.netlify.app/pay/<token>?tab=progress` (the WhatsApp link points at production; swap the host for the preview). Expected: Progress tab selected, headline, mastery bars, the report from step 18.
22. Tap each mastery row: the note box changes. Rows with no data read "Not started".
23. Tap **Pay**: the payment summary looks exactly as before.
24. Open `/pay/<token>` for a student with **no** shared reports: no tab bar at all; page identical to today.
25. Open `/pay/<token>?tab=progress` for that student: Progress tab with "No lesson reports yet…".
26. Open `/pay/not-a-real-token?tab=progress`: existing "We couldn't find this payment summary" message; no crash.
27. After step 20's Hide, reload the parent page: that lesson's report is gone.
28. Open the parent link of a second student: only that student's data appears.

### After phase 5 (monthly)
29. Student profile → **📄 Progress Report** → Generate PDF with "Include topic progress" ticked. PDF contains "Topic progress" (5 rows) and "Lesson reports". Untick and regenerate: sections absent, rest unchanged.
30. For a student without topic tracking, the two tick boxes are not shown and the PDF matches today's.
31. **Share via WhatsApp** with the second box ticked: message includes the Progress link; reloading the parent page now shows all rated lessons in the range.

### Data checks (read-only; Claude can run these)

```sql
-- Reports saved for Hanyong's lessons, and which are shared
SELECT l.lesson_date, l.is_completed, r.strengths, r.next_steps, r.shared_at,
       (SELECT count(*) FROM lesson_topics lt WHERE lt.lesson_id = l.id) AS topics,
       (SELECT count(*) FROM lesson_topics lt WHERE lt.lesson_id = l.id AND lt.rating IS NOT NULL) AS rated
FROM lesson_reports r
JOIN lessons l ON l.id = r.lesson_id
WHERE r.tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e'
ORDER BY l.lesson_date DESC
LIMIT 20;

-- Parent view must equal the shared count for one student (replace the id)
SELECT
  (SELECT count(*) FROM lesson_reports r JOIN lessons l ON l.id = r.lesson_id
     WHERE l.student_id = s.id AND r.shared_at IS NOT NULL AND l.is_completed) AS shared_in_db,
  json_array_length(public.get_progress_summary(s.payment_token) -> 'reports') AS shared_in_rpc
FROM students s
WHERE s.id = '<test-student-id>';

-- Billing untouched: no payment_cycles rows changed at the moment a report was saved.
-- Compare this count before and after saving a report (it must not change).
SELECT count(*), max(created_at) FROM payment_cycles
WHERE tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e';
```

---

## 9. Build phases

Each phase is one PR into `claude/charming-cray-new6h0`. Confirm each is live and tested before starting the next.

### Phase 1: schema (propose SQL only)

```text
Read docs/specs/done-to-parent-report.md fully before doing anything (sections 5 and 7 matter most).

Task: propose migration 061 only. Do not write any frontend code.

1. Create branch claude/done-report-061-schema from claude/charming-cray-new6h0.
2. Create supabase/migrations/061_lesson_reports_and_parent_progress.sql containing exactly the SQL in section 5.3 of the spec (BEGIN/COMMIT included). Append the verification queries from section 5.4 as a commented block at the end of the file.
3. Before committing, re-read supabase/migrations/054_lesson_topics.sql and confirm the constraint names lesson_topics_rating_check and syllabus_topics_level_scope_check are the ones the migration drops. If anything in the spec's SQL looks inconsistent with 054, STOP and tell me instead of fixing it silently.

Rules:
- DO NOT run any SQL. Do not use any Supabase tool to apply, execute or test the migration. I will review it and run it by hand in the Supabase SQL Editor.
- Do not touch any file other than the new migration file.
- Commit, push, open a PR into claude/charming-cray-new6h0 titled "Propose migration 061: lesson reports + parent progress (NOT yet run)".
- Do not merge.

Report back: branch name, commit hash, PR link, and the full SQL in a code block so I can review it.
```

### Phase 2: quick-capture sheet

```text
Read docs/specs/done-to-parent-report.md fully first (sections 3.1, 3.2, 4.1, 4.2, 4.3, 6.1 to 6.5, 6.9).
Migration 061 is already live. Do not run any SQL and do not create migration files.

Task: build the Done -> report sheet (step "rate" only; no preview/WhatsApp yet).

1. Create branch claude/done-report-sheet from claude/charming-cray-new6h0.
2. src/lib/lessonTopics.js: change RATING_OPTIONS to four values (1 Needs work, 2 Developing, 3 Secure, 4 Mastered), add SYLLABUS_REGISTRY, topicSetFor(), generate SYLLABUS_OPTIONS from the registry, make loadSyllabusTopics(topicSet = "ib_maa") cache per set. Keep isIbMaa, normalizeSyllabus, resolveLessonSubject, defaultShowAhl, groupByTopic exported and working.
3. New src/hooks/useLessonTopics.js: move the load + optimistic saveChange logic out of src/components/LessonTopicsPanel.jsx without changing behaviour. LessonTopicsPanel becomes a consumer of the hook and must look and behave the same, except it now shows four rating buttons.
4. New src/lib/lessonReport.js: STRENGTH_CHIPS (keys and labels from spec 6.4), strengthLabel(key), and the localStorage helpers for chopeandpay_report_sheet_auto (wrap every localStorage call in try/catch).
5. New src/components/LessonReportSheet.jsx per spec 4.1 step "rate": recent-topic suggestions (query in spec 6.5), today's topics with 1-4 buttons, "+ Other topic" picker with search, strength chips, optional next step, Skip. "Create parent report" exists but for now just closes the sheet with toast "Saved". Saves go to lesson_topics (via the hook) and lesson_reports (upsert on lesson_id, only the changed column). Show a visible error line on any failed save and roll back.
6. src/pages/Dashboard.jsx (minimal edits): add reportLesson state; in handleMarkDone and handleMarkOverdueLessonDone, AFTER the is_completed update has succeeded, open the sheet if the student is topic-tracked and auto-open is not off. Do not change the order or content of the existing update, toast, loadAll or notification code. Rename the "Topics" button on done rows to "Report" and open the new sheet. Render the sheet next to the existing modals at the bottom of the page.

Rules:
- Never write to the lessons table from the sheet. Never touch payment_cycles, collectedBreakdown.js, statement.js, or any agency/practitioner file.
- Mobile first: bottom sheet, tap targets at least 44px.
- Run npm run lint and npm run build; fix what you introduced.
- Commit, push, open a PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and which acceptance tests (spec section 8, tests 3 to 15) I should click through on the deploy preview.
```

### Phase 3: preview and WhatsApp

```text
Read docs/specs/done-to-parent-report.md first (sections 4.1 step "preview", 4.2, 6.7, 6.8).
Phase 2 is merged and live. Do not run any SQL.

Task: add the report preview, WhatsApp send, and the shared state.

1. Create branch claude/done-report-whatsapp from claude/charming-cray-new6h0.
2. src/lib/whatsapp.js: add buildProgressUrl(token) and buildLessonReportMessage({...}) exactly per spec 6.7. Reuse the existing greeting() helper and buildWhatsAppLink. Do not change existing functions.
3. src/components/LessonReportSheet.jsx: "Create parent report" now flushes any unsaved next-step text, then shows step "preview" (bubble with the exact message, Send on WhatsApp, Edit, Copy message instead, no-phone hint). Send and Copy set lesson_reports.shared_at (upsert; do not overwrite an existing value). Show "Visible on the parent's Progress page · Hide"; Hide sets shared_at to null.
4. src/pages/Dashboard.jsx: load shared_at for today's lessons (one query on lesson_reports filtered by tutor_id and the today lesson ids) and show "✓ Report sent" instead of "✓ Done" when set. Refresh it when the sheet closes. Pass the student row (name, guardian_name, guardian_contact, payment_token) and the tutor name the page already uses for payment messages into the sheet.
5. Dates in the message come from the lesson_date string parsed as a local date. Never use toISOString() for display.

Rules: same as phase 2 (no writes to lessons, no money code, no SQL). Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, a sample of the generated message text, and acceptance tests 16 to 20 for me to run.
```

### Phase 4: parent Progress tab

```text
Read docs/specs/done-to-parent-report.md first (sections 3.3, 4.4, 5.3 function output, 6.6, 6.10, 7).
Phases 1 to 3 are live. Do not run any SQL and do not change any database function.

Task: add the Progress tab to the parent page.

1. Create branch claude/parent-progress-tab from claude/charming-cray-new6h0.
2. New src/lib/topicMastery.js: pure functions implementing spec 6.6 (current rating per subtopic, per-group average/pct/level/note, headline, sub-line). No Supabase imports.
3. New src/components/ParentProgress.jsx per spec 4.4, taking the get_progress_summary JSON as a prop. Uses STRENGTH_CHIPS labels from src/lib/lessonReport.js.
4. src/pages/PaymentSummary.jsx: call supabase.rpc("get_progress_summary", { p_token: token }) in parallel with the existing get_payment_summary call, with its own loading and error state. Show the Pay | Progress tab bar only when the progress result has at least one report OR the URL has ?tab=progress. Read the tab from the query string (useSearchParams). The existing payment card must render exactly as before inside the Pay tab, and a progress error must never affect it.
5. src/pages/StudentProfile.jsx: next to the existing payment-link action add a small "Preview parent progress page" link to the relative path /pay/<payment_token>?tab=progress (opens in a new tab), shown only when the student has a tracked subject.
6. src/pages/Dashboard.jsx: update the ANNOUNCEMENT constant (new id "whats-new-2026-11-lesson-reports") to announce the feature in 3 short bullets, including that parents see only reports you send.

Rules:
- The parent page must work logged out (anon key). Do not query any table directly from PaymentSummary or ParentProgress; RPC only.
- Do not edit get_payment_summary usage, agency or practitioner files.
- Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and acceptance tests 21 to 28 with the exact preview URL pattern to open in a private window.
```

### Phase 5: monthly progress report

```text
Read docs/specs/done-to-parent-report.md first (sections 3.4, 4.5, 6.6, 6.8, 6.11).
Phases 1 to 4 are live. Do not run any SQL.

Task: feed topic progress into the existing student Progress Report.

1. Create branch claude/monthly-progress-report from claude/charming-cray-new6h0.
2. src/components/ProgressReportModal.jsx: when the student has a tracked subject, load lesson_topics (joined to syllabus_topics fields via the cached loadSyllabusTopics list) and lesson_reports for this student's lessons in the selected range. Page every query with .range() in steps of 1000. Add the two tick boxes from spec 4.5 and the loading/error lines.
3. src/lib/progressReport.js: downloadProgressReportPdf accepts optional topicProgress and lessonReports and, when present, draws "Topic progress" (one line per syllabus topic group: name, level, covered/total, from src/lib/topicMastery.js) and "Lesson reports" (date, topics with rating labels, Strengths, To work on) before the payment summary. Reuse the existing page-break pattern and stripEmoji. When absent, the PDF must be identical to today's.
4. src/lib/whatsapp.js: buildProgressReportMessage takes an optional progressLink and appends "📈 Progress: <link>" before the sign-off when given.
5. On "Share via WhatsApp" with the second box ticked, bulk-mark lessons in range as shared per spec 6.8 (upsert lesson_id, tutor_id, shared_at in chunks of 200; never overwrite an existing shared_at). Show a visible error if it fails and still open WhatsApp.

Rules: do not change the payment figures or lesson history sections of the PDF. No money logic changes. Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and acceptance tests 29 to 31.
```

---

## 10. Open questions for Hanyong

1. **Is there feedback-report work that is not in this repo?** The brief describes strengths, areas to improve, topic analysis and a per-lesson WhatsApp text as existing. None of it is in `claude/charming-cray-new6h0`, `year-end-report-pr4` or the live database, and `lesson_topics` has 0 rows. *Default: treat it as not built and build it here. If it lives on another branch, tell me before phase 1.*
2. **Rating scale 1–4 or keep 1–3?** The concept uses four (Needs work / Developing / Secure / Mastered); the app uses three (Shaky / Okay / Solid). *Default: move to four with the concept's labels. Zero rows exist, and 1–3 keep their meaning, so this is the cheapest moment to change.*
3. **What parents can see.** *Default: only lessons you sent or copied (per-lesson `shared_at`), and mastery bars built only from those.* Alternative: once you share anything, show all ratings for that student. The default is safer but means bars can look thin if you rate often and send rarely.
4. **Where the parent view lives.** *Default: a Progress tab on `/pay/:token` (one link per family, matches the concept).* Trade-off: the progress link also shows payment status. If you ever want to send progress to someone who should not see payments (e.g. the student), that needs a separate token later.
5. **Re-enabling auto-open.** v1 has an off switch in the sheet but no on switch in Settings. *Default: accept for v1; add a Settings toggle in a later small PR.*
6. **Money in the sheet header** ("$225 earned" in the concept). *Default: leave out, to keep this feature free of money logic.*
7. **Free vs paid.** *Default: available to all tutors, no gating.*
8. **Coordination.** If another spec is redesigning `/pay/:token` (parent portal Pay/Book tabs), phase 4 should land after it and plug `ParentProgress` into that tab bar. *Default: build phase 4 as written if no portal redesign has merged by then.*

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| The sheet interferes with Done and billing. | Done code path is unchanged and runs first; sheet opens only after success; sheet never writes `lessons`; new tables have no triggers. Acceptance tests 4, 11, 12 and the payment_cycles data check. |
| RLS 403s or silent failures on the new table. | Four explicit policies; verification query B; test 7 (save and reload) and test 14 (visible error). |
| Parent sees another student's data or private ratings. | Single SECURITY DEFINER function, token-matched student, `shared_at` gate, no anon table access; tests 24 to 28 and the RPC-vs-DB count check. |
| Anon vs authenticated mismatch on the parent page. | RPC granted to both roles; test 21 is run logged out. |
| Refactoring `LessonTopicsPanel` into a hook breaks the existing panel. | Phase 2 prompt requires identical behaviour; test 13 checks the panel. |
| Tutors find the sheet annoying. | Opens only for topic-tracked students; Skip is one tap; one-tap "don't open automatically". |
| Topic names are long in WhatsApp. | Plain bullet lines; no truncation in the message (truncation only in chips). |
| WhatsApp link points at production while testing on a preview. | Stated in test 21; tutor-side preview link in phase 4 uses a relative path. |
| Mastery percentages over-read thin data. | Level labels plus "n of m subtopics covered" in every note; "Not started" for empty groups; sub-line states how many lessons the picture is based on. |
| Parallel specs touch the same files (`Dashboard.jsx`, `PaymentSummary.jsx`, migration numbers 059/060). | Minimal, located edits; new logic in new files; 061 references neither 059 nor 060 objects; Open question 8. |
| `payment_token` has no unique index. | Live data has 68 distinct tokens of 36 characters; the function uses `LIMIT 1`. A unique index is a sensible future hardening but is left out here to avoid touching `students`. |
