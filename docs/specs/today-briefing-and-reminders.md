# Spec — Today briefing + pre-drafted WhatsApp reminders

Written 16 Nov 2026 against branch `claude/charming-cray-new6h0` (latest migration in repo: 058) and the live schema of Supabase project `cdskiekviymkessedlem`.
Concept reference: `Main.dc.html`, screen **Today** (greeting block, "Needs your attention" cards with the inline draft bubble, navy "Booking request" card, toast).
Assigned migration: **062** (needed — see section 5).

---

## 1. Plain-language summary for Hanyong

- The Dashboard gets a short **briefing card** at the very top: "Good morning, Hanyong. 3 lessons today, first at 3:30pm. 2 families owe $870. 1 booking request is waiting." Every line is tappable and jumps to the right place.
- The numbers in the briefing are **the same numbers** as Pending and the "All outstanding pending" list. They come from one shared function, not a second calculation.
- **Remind** now opens a warm, ready-to-send WhatsApp draft that fits the situation: first request, gentle follow-up, or overdue. You can edit it, and optionally save your own wording.
- The app remembers when you last reminded each family, so the row says "Reminded 3 days ago" and the next draft is a polite follow-up instead of the same message again.
- Nothing is ever sent automatically. The app only opens WhatsApp with the text filled in. You press send yourself.
- Students whose agency collects the fee no longer get a Remind button (you would be chasing the wrong person). Practice students never appear.
- For parents nothing changes except the wording of the message they receive. The `/pay/:token` page is untouched.
- One small new piece of database: a "reminder log" table and a "my templates" table (migration 062).

---

## 2. Scope

**In**
- `TodayBriefing` card at the top of the Dashboard left column (tutors only).
- Shared "owed rows" function used by Pending, the Pending breakdown modal and the briefing.
- Reminder stages (first / follow-up / overdue), default templates, per-mode period wording, combined reminder when a family has several unpaid notices.
- `ReminderSheet` (editable draft, WhatsApp deep link, copy, missing-phone handling).
- Reminder log ("Reminded 3 days ago", "Remind again"), with Undo.
- Agency-collected students: no Remind button, shown as "Agency collects".
- Tutor's own templates (one per stage), editable in Settings and from the sheet.
- Same reminder flow from Payments page and Student profile.

**Out**
- Any automatic sending, scheduled sending, WhatsApp Business API, SMS, email.
- Inline Confirm/Decline of booking requests on the Dashboard. Confirming needs the subject picker, lesson creation and Google Calendar sync that live in `BookingRequests.jsx` (`ConfirmModal`). The briefing links there instead.
- Month-end close itself (see `docs/specs/month-end-close.md`). This spec only defines the hook (section 6.7).
- Practitioner dashboard and agency domain: no change at all.
- Changes to `recompute_payment_cycles`, `get_payment_summary`, `/pay/:token`.
- Changing any amount. Reminders always quote `payment_cycles.amount_due`.

**Later**
- "Worth $X to you today" in the greeting (needs take-home maths per lesson; `buildEarningsBreakdown` is per month).
- Auto-suggest a receipt message right after Mark as paid on the Dashboard.
- Reminder history list on the Student profile.
- Per-student template override; Chinese/Malay templates.
- Inline booking confirm/decline in the briefing.

---

## 3. User stories & flows

### 3.1 Morning check (concept: Today screen, greeting block)
1. Tutor opens `/dashboard` on the phone.
2. Top card shows date, greeting and one summary sentence, then a short list of items (only the ones that are non-zero):
   - Lessons today → scrolls to the TODAY card.
   - Lessons that still need a status update → scrolls to the amber "need a status update" card.
   - Money owed to you → opens the existing "All outstanding pending" modal (`PendingBreakdownModal`).
   - Collected by agencies (if any) → same modal.
   - Not yet billed / stalled cycles → scrolls to "Needs your attention".
   - Booking requests → `/booking-requests`.
   - Month-end prompt (near month end) → see 6.7.
3. If nothing needs doing: "All clear today. No lessons and nothing to chase. Enjoy your day!"
4. Tutor can collapse the card for the rest of the day (chevron). It re-opens the next day.

### 3.2 First reminder (concept: Today → "Needs your attention" card → Remind → draft bubble)
1. In "Needs your attention" a row shows `Student A · $480 · Pending` with **Remind**, **Mark as paid**, **Write off** (existing buttons).
2. Tap **Remind** → `ReminderSheet` slides up. Stage chip "First request" is selected. The draft is filled with greeting, student, period, amount, PayNow and the `/pay/:token` link.
3. Tutor may edit the text.
4. Tap **Send on WhatsApp** → WhatsApp opens in a new tab/app with the text prefilled (and the parent's chat if a valid number is saved). The sheet closes. A row is written to the reminder log. Toast: "WhatsApp opened for Mrs Tan. Marked as reminded today."
5. The row now shows "Reminded today · Undo" and the button reads **Remind again**.

### 3.3 Follow-up
1. Three days later the row shows "Reminded 3 days ago".
2. Tap **Remind again** → the sheet opens on "Gentle follow-up" with the softer follow-up wording.
3. After a second reminder, or one reminder plus 21 days past due, the sheet opens on "Overdue".
4. If the last reminder was less than 3 days ago the sheet shows a soft note: "You reminded Mrs Tan yesterday. Maybe give it another day or two?" Sending is still allowed.

### 3.4 Family with several unpaid notices
1. A per-lesson student has three unpaid lessons. Tap **Remind** on any of them.
2. The sheet is pre-set to "All 3 unpaid notices · $360" with one combined message. A toggle "Only this notice ($120)" switches to the single notice.
3. Sending logs one reminder row per notice included.

### 3.5 Agency collects
1. Student B has an agency set and "Agency collects the fee".
2. Their row shows a grey chip "Agency collects · Agency X" and **no Remind button**. Mark as paid and Write off remain (the tutor still records when the agency pays).
3. In the briefing their amount is on a separate line "$300 is being collected by agencies", not in "families owe you".

### 3.6 No phone number
1. Tap **Remind** for a student without a saved WhatsApp number.
2. The sheet shows an amber note: "No WhatsApp number saved for this parent. WhatsApp will ask you to pick the chat." with a link "Add number" → `/students/:id`.
3. **Send on WhatsApp** still works (opens `https://wa.me/?text=…`, WhatsApp shows its chat picker). **Copy message** is offered as the alternative.

### 3.7 Mark as paid
Unchanged behaviour (`handleCollectPayment`), but the toast becomes specific: "$480 from Student A marked as paid." The reminder log rows stay as history.

### 3.8 Own wording
1. In the sheet, after editing, tap "Save as my follow-up template" → saved for that stage. Or go to Settings → "Reminder messages".
2. From then on that stage starts from the tutor's wording. "Reset to default" removes it.

---

## 4. UI spec

Mobile-first. Existing Tailwind classes and brand colours (`#1b2d4f` navy, `#5ecfaa` mint, `#edf6f3`/`#e6f7f0` pale mint). All tap targets `min-h-11`. Tutor-only: wrap every new element in `!isPractitioner`.

### 4.1 `TodayBriefing` card (new component `src/components/TodayBriefing.jsx`)

**Position:** first child of the LEFT PANEL in `Dashboard.jsx`, above the `past_due` banner and the TODAY section. On desktop it stays in the left column. The existing TODAY card, Upcoming, Needs your attention, recap and the amber booking banner in the right panel are **not removed or reordered**.

**Layout** (match concept greeting block: uppercase mint eyebrow, large heading, grey sentence):
```
MONDAY 16 NOVEMBER                                   [⌃ collapse]
Good morning, Hanyong
3 lessons today, first at 3:30pm. 2 families owe you $870. 1 booking request is waiting.

┌───────────────────────────────────────────────┐
│ 📚 3 lessons today · 1 done                  → │
│ 📝 2 lessons need a status update            → │
│ 💰 2 families owe you $870                   → │
│     1 overdue · last reminded 3 days ago       │
│ 🏢 $300 is being collected by agencies       → │
│ 🧾 $240 not yet billed (1 stalled)           → │
│ 📬 1 booking request waiting · expires in 5h → │
│ 🗓️ November ends in 3 days · 2 notices open  → │
└───────────────────────────────────────────────┘
```
- Card: `rounded-xl border border-gray-100 bg-white p-5 shadow-sm`. Eyebrow: `text-xs font-semibold uppercase tracking-wide text-[#0f7a58]`. Heading: `text-2xl font-bold text-[#1b2d4f]`. Sentence: `text-sm text-gray-600`.
- Each item row is a `<button>` (or `<Link>` for routes): `flex w-full items-center justify-between min-h-11 text-left text-sm`.
- Rows with value zero are not rendered.

**Greeting** (hour in Asia/Singapore): 05:00–11:59 "Good morning", 12:00–17:59 "Good afternoon", otherwise "Good evening". Name = first word of `tutors.full_name`, fallback `user.user_metadata.full_name`, fallback no name ("Good morning").

**Summary sentence** — built from up to three parts, joined with spaces, in this priority order (take the first three that apply):
1. Lessons: `"{n} lesson(s) today, first at {time}."` (time of the first not-yet-done lesson; if all done: `"All {n} lessons done today."`; if n = 0: `"No lessons today."`)
2. Owed to tutor: `"{f} famil(y/ies) owe you {amount}."`
3. Booking: `"{b} booking request(s) waiting."`
4. Status updates: `"{k} lesson(s) need a status update."`
5. Month-end prompt text (6.7).
If only part 1 applies and n = 0 and nothing else: `"All clear today. No lessons and nothing to chase. Enjoy your day!"`
Use `terms.lesson/lessons` from `useTerms()` for the word "lesson".

**States**
- Loading (`loading === true`): eyebrow + greeting render immediately; sentence replaced by two grey skeleton bars (`h-4 animate-pulse rounded bg-gray-100`); no item rows.
- Empty / all clear: sentence as above, no rows.
- Collapsed: only eyebrow, greeting and sentence; rows hidden. Stored in `localStorage` key `chopeandpay_briefing_collapsed` = today's SGT date key. Collapsed only if the stored value equals today. Wrap get/set in try/catch.
- Error: the briefing never blocks the Dashboard. If the reminder-log query fails, omit the "last reminded" sub-line. No red banner.
- New tutor with zero students: the Dashboard returns its existing "Let's get started!" screen before this card; do not render the briefing there.

### 4.2 "Needs your attention" rows (existing section in `Dashboard.jsx`, small additions)

For each unpaid cycle row add, under the name/amount/badge line:
- If reminded: `text-xs text-gray-500` → `"Reminded 3 days ago"`; if more than one reminder day: `"Reminded 3 days ago · 2 reminders"`; if today: `"Reminded today · "` + link-style button `Undo` (Undo only when the newest reminder is from today).
- If not reminded for this notice but the same student was reminded for another notice in the last 30 days: `"Last reminded 5 days ago (another notice)"`.
- Button label: `💬 Remind` → `💬 Remind again` when reminded at least once.
- Agency-collected student: replace the Remind button with a chip `bg-gray-100 text-gray-600 rounded-full px-2.5 py-0.5 text-xs` reading `"Agency collects · {payee name}"` (or `"Agency collects"` if the name is unknown).

Same additions in `PendingBreakdownModal` rows (type `cycle`): reminded line, "Remind again", agency chip instead of Remind.

### 4.3 `ReminderSheet` (new component `src/components/ReminderSheet.jsx`)

Bottom sheet on mobile, centred modal from `sm:` (copy the wrapper of `PendingBreakdownModal`: `fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center`, panel `w-full max-w-lg rounded-2xl bg-white`, `max-h-[90vh] overflow-y-auto`). Tapping the backdrop or ✕ closes without logging.

```
Reminder for Mrs Tan                                  ✕
Student A · $480 · October lessons

[ First request ] [ Gentle follow-up ] [ Overdue ]      ← stage chips
( ) All 3 unpaid notices · $360   ( ) Only this notice · $120   ← only if >1 open notice

Drafted for you. Edit anything before sending.
┌──────────────────────────────────────────────┐
│ (textarea, 9 rows, bubble style)             │
└──────────────────────────────────────────────┘
⚠ notes (0..n, see below)

[ Send on WhatsApp ]            [ Copy ] [ Not now ]
Save as my follow-up template · Reset to default
```
- Title: `Reminder for {guardian_name}`; if no guardian name: `Reminder for {student name}'s family`.
- Stage chips: selected `bg-[#1b2d4f] text-white`, others `border border-gray-300 text-gray-700`. Changing the chip re-renders the draft from that stage's template. If the tutor has typed edits, ask `window.confirm("Replace your edits with the {stage} draft?")` first.
- Textarea: `bg-[#e6f7f0] rounded-[4px_16px_16px_16px] p-3 text-sm leading-relaxed text-[#1b2d4f]` (concept draft bubble), editable.
- Buttons: **Send on WhatsApp** `bg-[#5ecfaa] text-[#1b2d4f] font-bold flex-[2]`; **Copy** and **Not now** `bg-gray-100 text-[#1b2d4f]`.
- "Send on WhatsApp" is disabled while the text is empty, with helper text "Message is empty."

**Notes (amber `bg-amber-50 text-amber-800 rounded-lg px-3 py-2 text-xs`)**, each shown only when true:
| Condition | Text |
|---|---|
| `normalizeWhatsAppNumber(student.guardian_contact)` is null and contact is empty | "No WhatsApp number saved for this parent. WhatsApp will ask you to pick the chat." + link "Add number" → `/students/{id}` |
| contact has text but is not a valid number | "The saved contact "{text}" doesn't look like a phone number. WhatsApp will ask you to pick the chat." + link "Fix number" |
| newest reminder for this notice is 0–2 days old | "You reminded {name} {today/yesterday/2 days ago}. Maybe give it another day or two?" |
| `tutors.paynow_number` empty | "Your PayNow number isn't set, so it's left out." + link "Add it in Settings" → `/settings` |
| placement-fee caution (6.4) | "Part of {student}'s early lessons was a placement fee paid to {agency}. Please check the amount before sending." |
| student archived or deleted | "{student} is archived/deleted. The payment link still works." |

**After actions**
| Action | Result |
|---|---|
| Send on WhatsApp | `window.open(buildWhatsAppLink(text, phone), "_blank")` synchronously in the click handler, then insert log rows (`channel: 'whatsapp'`), close sheet, toast `"WhatsApp opened for {name}. Marked as reminded today."` |
| Log insert fails | Sheet still closes (WhatsApp already opened). Toast (error): `"WhatsApp opened, but the reminder date could not be saved: {error.message}"` |
| Copy | Copies text. Button shows "Copied!" for 1.5s. A link appears: "Sent it yourself? Mark as reminded" → inserts log rows with `channel: 'copy'`, closes, toast `"Marked as reminded today."` |
| Clipboard blocked | Inline red text: "Couldn't copy. Please select the text and copy it manually." |
| Not now / ✕ / backdrop | Close, nothing logged |
| Undo (on the row) | Deletes today's log rows for that notice. Toast `"Reminder mark removed."` |

### 4.4 Default templates (Singapore-friendly, warm, short)

Placeholders: `{greeting}` `{student}` `{period}` `{amount}` `{due_date}` `{paynow}` `{link}` `{tutor}`.

**first** — "First request"
```
{greeting}, hope you're doing well! 😊
Here is the fee summary for {student}: {period}.
Amount: {amount}
PayNow: {paynow}
Details: {link}
Thank you!
— {tutor}
```
**followup** — "Gentle follow-up"
```
{greeting}, just a gentle reminder on {student}'s fees for {period}: {amount}.
If it's already on the way, please ignore this. 🙏
PayNow: {paynow}
Details: {link}
Thank you!
— {tutor}
```
**overdue** — "Overdue"
```
{greeting}, hope all is well. I'm following up on {student}'s fees for {period} ({amount}), outstanding since {due_date}.
Could you let me know when I can expect payment? If anything looks off, happy to go through the lessons together.
PayNow: {paynow}
Details: {link}
Thank you for your understanding.
— {tutor}
```

Placeholder values:
| Placeholder | Value |
|---|---|
| `{greeting}` | `Hi {guardian_name}` if set, else `Hi` |
| `{student}` | `students.name` |
| `{amount}` | `formatSGD(sum of amount_due of included notices)` |
| `{due_date}` | earliest `period_end` among included notices, format `formatDate` (e.g. "31 Oct 2026") |
| `{paynow}` | `tutors.paynow_number` (empty if not set) |
| `{link}` | `buildPaymentSummaryUrl(student.payment_token)` (always production URL; empty if no token) |
| `{tutor}` | `tutors.full_name`, else `"Your tutor"` |
| `{period}` | see below |

`{period}` per notice (uses the notice's completed lesson dates, section 6.3):
- `is_manual_closeout` or mode `lessons`: `"4 lessons (3 Nov, 5 Nov, 10 Nov, 12 Nov)"`
- mode `per_lesson`: `"the lesson on 12 Nov"`
- mode `monthly` or `custom_date`: `"October lessons (4 lessons: 3 Oct, 10 Oct, 17 Oct, 24 Oct)"` using the month of `period_start`
- more than 8 dates: drop the date list → `"9 lessons"` / `"October lessons (9 lessons)"`
- zero lesson dates found: `"lessons up to {period_end}"`
- combined (several notices): per_lesson notices merge into `"3 lessons (5 Nov, 12 Nov, 19 Nov)"`; otherwise join each notice's phrase with `"; "`.

**Rendering rule:** any line containing a placeholder whose value is empty is removed entirely (so no dangling "PayNow:"). Then replace placeholders, collapse 3+ blank lines to one. Unknown `{words}` are left as typed.

### 4.5 Settings → "Reminder messages" (new section in `Settings.jsx`, tutors only, placed after "Payment settings")
- Three collapsible blocks (First request / Gentle follow-up / Overdue), each a textarea (max 1,000 chars, counter), **Save**, **Reset to default**.
- Helper: "Use these tags and we fill them in for you: {greeting} {student} {period} {amount} {due_date} {paynow} {link} {tutor}. A line is skipped automatically if its tag has nothing to show."
- Live preview under each textarea using sample values (Student "Jamie", "Mrs Tan", $480.00).
- Warning (not blocking) when the saved text lacks both `{amount}` and `{link}`: "Tip: include {amount} or {link} so parents know how much to pay."
- States: loading "Loading…"; save success toast "Template saved."; reset toast "Back to the default wording."; error shows `error.message` in red under the block and as toast.

---

## 5. Data model

### 5.1 Existing tables/columns used (verified live, 16 Nov 2026)
- `payment_cycles`: `id, tutor_id, student_id, period_start date, period_end date, amount_due numeric, status text ('pending'|'paid'|'overdue'|'waived'), paid_at, is_manual_closeout, waived_at, waived_from_status`. RLS: four own-row policies (`tutor_id = auth.uid()`).
- `students`: `id, tutor_id, name, subject, guardian_name, guardian_contact, payment_mode, payment_cycle_count, payment_token, archived, deleted_at, payee_id, fee_collected_by ('payee'|'me', default 'payee'), placement_fee_agency, placement_fee_amount, placement_fee_start, agency_placement_id, direct_payer`. (`is_practice` arrives with migration 059; not live at time of writing.)
- `payees`: `id, tutor_id, name, share_percent, archived`.
- `tutors`: `full_name, paynow_number`.
- `lessons`: `id, student_id, lesson_date, lesson_time, is_completed, payment_cycle_id, duration_minutes, rate, rate_type`.
- `booking_requests`: `id, tutor_id, student_id, start_at, end_at, status, expires_at`.

### 5.2 Findings that drive the design
1. **Nothing like a reminder log exists.** No table, column or function mentions reminders (checked `information_schema.tables`, `payment_cycles` columns, `pg_proc`). The only "remind" code is the `Remind` buttons that build a one-size message (`buildPaymentRequestMessage` in `src/lib/whatsapp.js`).
2. **A `last_reminded_at` column on `payment_cycles` would not survive.** `recompute_payment_cycles` (migration 058) runs `DELETE FROM payment_cycles WHERE … status = 'pending' AND is_manual_closeout = FALSE` and re-inserts fresh rows with **new ids** every time a lesson of that student is inserted, deleted or edited. So reminders must live in their own table and be matched to a notice by `(student_id, period_start, period_end)`, with `payment_cycle_id` kept only as a hint.
3. **`status = 'overdue'` is never written.** Live count of `payment_cycles` with status `overdue`: 0. "Overdue" on screen is computed in JS (`computeStudentPaymentStatus`). Reminder stages therefore use reminder count + days past `period_end`, never the status column.
4. **`fee_collected_by` defaults to `'payee'` even when there is no agency.** Live: 13 of Hanyong's 28 students have `payee_id IS NULL` and `fee_collected_by = 'payee'`. The rule "agency collects" must be `payee_id IS NOT NULL AND fee_collected_by <> 'me'`. Checking `fee_collected_by` alone would wrongly hide Remind for most students.
5. **Missing phone numbers are the normal case.** Live: all 8 open notices across all tutors belong to students with no `guardian_contact`. The no-number path must be first-class.
6. Scale today: max 231 lessons and 93 cycles per tutor. Still page anything that grows.

### 5.3 Proposed migration `supabase/migrations/062_payment_reminders.sql`

Independent of 059–061 (touches no existing table, function or policy).

```sql
-- ============================================================
-- 062_payment_reminders.sql
--
-- Today briefing + WhatsApp reminders.
--  * payment_reminders  : log of "tutor opened a reminder for this notice".
--                         One row per notice per send. Tutor-private.
--  * reminder_templates : a tutor's own wording, max one per stage.
--
-- Why a table and not a column on payment_cycles:
--   recompute_payment_cycles() DELETEs and re-INSERTs pending cycles
--   (new ids) on every lesson change, so a column would be wiped.
--   Rows here are matched to a notice by
--   (student_id, period_start, period_end). payment_cycle_id is a
--   hint only and deliberately has NO foreign key, so this migration
--   cannot affect the DELETE inside recompute_payment_cycles().
--
-- Does not touch payment_cycles, lessons, students, any function,
-- trigger, or existing policy.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ── 1. payment_reminders ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id         uuid NOT NULL REFERENCES public.tutors(id)   ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  payment_cycle_id uuid,                       -- hint only, no FK (see header)
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  amount_due       numeric(10, 2) NOT NULL CHECK (amount_due >= 0),
  stage            text NOT NULL CHECK (stage IN ('first', 'followup', 'overdue')),
  channel          text NOT NULL DEFAULT 'whatsapp'
                     CHECK (channel IN ('whatsapp', 'copy')),
  reminded_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

COMMENT ON TABLE public.payment_reminders IS
  'Log of payment reminders a tutor opened in WhatsApp (never auto-sent). Matched to a payment notice by (student_id, period_start, period_end) because pending payment_cycles ids are regenerated by recompute_payment_cycles().';
COMMENT ON COLUMN public.payment_reminders.payment_cycle_id IS
  'payment_cycles.id at the time of the reminder. Hint only; may no longer exist. No FK on purpose.';
COMMENT ON COLUMN public.payment_reminders.amount_due IS
  'Snapshot of the notice amount when the reminder was opened.';

CREATE INDEX IF NOT EXISTS payment_reminders_tutor_time_idx
  ON public.payment_reminders (tutor_id, reminded_at DESC);
CREATE INDEX IF NOT EXISTS payment_reminders_notice_idx
  ON public.payment_reminders (student_id, period_start, period_end);

ALTER TABLE public.payment_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors view own payment reminders"   ON public.payment_reminders;
DROP POLICY IF EXISTS "Tutors insert own payment reminders" ON public.payment_reminders;
DROP POLICY IF EXISTS "Tutors update own payment reminders" ON public.payment_reminders;
DROP POLICY IF EXISTS "Tutors delete own payment reminders" ON public.payment_reminders;

CREATE POLICY "Tutors view own payment reminders"
  ON public.payment_reminders FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors insert own payment reminders"
  ON public.payment_reminders FOR INSERT TO authenticated
  WITH CHECK (
    tutor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = payment_reminders.student_id
        AND s.tutor_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tutors update own payment reminders"
  ON public.payment_reminders FOR UPDATE TO authenticated
  USING (tutor_id = (SELECT auth.uid()))
  WITH CHECK (
    tutor_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = payment_reminders.student_id
        AND s.tutor_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Tutors delete own payment reminders"
  ON public.payment_reminders FOR DELETE TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

REVOKE ALL ON public.payment_reminders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_reminders TO authenticated;

-- ── 2. reminder_templates ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reminder_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id   uuid NOT NULL REFERENCES public.tutors(id) ON DELETE CASCADE,
  stage      text NOT NULL CHECK (stage IN ('first', 'followup', 'overdue')),
  body       text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_templates_tutor_stage_key UNIQUE (tutor_id, stage)
);

COMMENT ON TABLE public.reminder_templates IS
  'A tutor''s own reminder wording, at most one per stage. No row = use the built-in default in src/lib/reminders.js.';

ALTER TABLE public.reminder_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tutors view own reminder templates"   ON public.reminder_templates;
DROP POLICY IF EXISTS "Tutors insert own reminder templates" ON public.reminder_templates;
DROP POLICY IF EXISTS "Tutors update own reminder templates" ON public.reminder_templates;
DROP POLICY IF EXISTS "Tutors delete own reminder templates" ON public.reminder_templates;

CREATE POLICY "Tutors view own reminder templates"
  ON public.reminder_templates FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors insert own reminder templates"
  ON public.reminder_templates FOR INSERT TO authenticated
  WITH CHECK (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors update own reminder templates"
  ON public.reminder_templates FOR UPDATE TO authenticated
  USING (tutor_id = (SELECT auth.uid()))
  WITH CHECK (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors delete own reminder templates"
  ON public.reminder_templates FOR DELETE TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

REVOKE ALL ON public.reminder_templates FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminder_templates TO authenticated;

COMMIT;
```

### 5.4 Post-run verification (read-only; run after Hanyong executes 062)

```sql
-- V1. Both tables exist with RLS on (expect 2 rows, rls = true)
SELECT relname, relrowsecurity AS rls
FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('payment_reminders', 'reminder_templates');

-- V2. Four policies each, all for role authenticated (expect 8 rows)
SELECT tablename, cmd, policyname, roles::text
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('payment_reminders', 'reminder_templates')
ORDER BY tablename, cmd;

-- V3. anon has no privileges; authenticated has the four (expect only 'authenticated' rows)
SELECT table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('payment_reminders', 'reminder_templates')
  AND grantee IN ('anon', 'authenticated')
GROUP BY table_name, grantee;

-- V4. No foreign key from payment_reminders to payment_cycles (expect 0)
SELECT count(*) AS fk_to_cycles
FROM pg_constraint
WHERE conrelid = 'public.payment_reminders'::regclass
  AND contype = 'f'
  AND confrelid = 'public.payment_cycles'::regclass;

-- V5. Indexes and unique constraint present (expect 5 rows incl. the two pkeys)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('payment_reminders', 'reminder_templates')
ORDER BY 1;

-- V6. Nothing else changed: recompute function still exists, cycles untouched
SELECT (SELECT count(*) FROM payment_cycles) AS cycles,
       (SELECT count(*) FROM pg_proc WHERE proname = 'recompute_payment_cycles') AS recompute_fn;
```

---

## 6. Logic & edge cases

### 6.1 One source of truth for "owed" (new `src/lib/owed.js`)

Today `Dashboard.jsx` computes the same thing twice: `allPendingAmount` (lines ~621–660) and the `isCurrentMonth` branch of `pendingBreakdownRows` (lines ~677–734). Extract that logic, unchanged, into one pure function:

```js
// src/lib/owed.js
// cycles/allStudents/allLessons = the "recap" sets (include archived + deleted).
// activeStudents = non-archived, non-deleted (Dashboard `students` state).
export function buildOwedRows({ cycles, allStudents, activeStudents, allLessons, payees })
// returns rows[]: {
//   type: 'cycle' | 'mid_cycle', studentId, studentName, amount, tag,
//   archived, deleted, cycleId, cycleStatus, cycle, student,
//   collector: 'tutor' | 'agency', collectorName: string | null
// }
export function sumOwed(rows)            // cents-safe sum of row.amount
export function isAgencyCollected(student)
```
Rules (must match current behaviour exactly, plus the two marked NEW):
- `cycle` rows: every cycle with status `pending` or `overdue` in the recap set. `waived` and `paid` excluded.
- `mid_cycle` rows ("Not yet billed"): active students in `lessons` mode with no owed cycle, whose unbilled lesson count ≥ `payment_cycle_count − 1`; amount = `lessonAmount` over the last `cycleCount` unbilled lessons (copy the existing code as is).
- NEW: skip any student with `is_practice === true` (both row types). Before migration 059 is live the field is `undefined`, so nothing is skipped.
- NEW: `collector` = `'agency'` when `isAgencyCollected(student)`, else `'tutor'`. `isAgencyCollected(s)` = `Boolean(s?.agency_placement_id) || (Boolean(s?.payee_id) && s?.fee_collected_by !== 'me')`. `collectorName` = payee name from `payees`, else null.
- If migration 059's PR has already added practice filtering inside these Dashboard blocks, keep that filter when moving the code.

Then in `Dashboard.jsx`:
- `allPendingAmount = sumOwed(owedRows)` (still passed to `MonthlyRecapCard` as `currentMonthPendingOverride`).
- `pendingBreakdownRows` (current-month branch) = `owedRows`. The past-month branch stays as is.
- Briefing figures (all from `owedRows`):
  - `owedToTutor` = sum of `cycle` rows with `collector === 'tutor'`; `families` = distinct `studentId` count of those rows.
  - `owedViaAgency` = sum of `cycle` rows with `collector === 'agency'`.
  - `notYetBilled` = sum of `mid_cycle` rows.
- **Invariant (add a dev-only `console.error` if broken):** `owedToTutor + owedViaAgency + notYetBilled === allPendingAmount` (compare in cents).

Note: the "Needs your attention" header (`unpaidTotal`) only counts active students' cycles, as today. It can be lower than the briefing when an archived/deleted student owes money. That is existing, announced behaviour ("Pending now includes archived and deleted students"). The briefing's owed row opens the full Pending breakdown modal where those rows carry `Archived` / `Deleted` tags, and the briefing adds a suffix when relevant: `"3 families owe you $1,250 (incl. 1 archived)"`.

### 6.2 Reminder stage (`src/lib/reminders.js`)

```js
export const noticeKey = (studentId, periodStart, periodEnd) => `${studentId}|${periodStart}|${periodEnd}`;
export function remindersForNotice(reminders, cycle)
// match if r.payment_cycle_id === cycle.id OR noticeKey(r) === noticeKey(cycle)
export function computeReminderStage({ reminderDayKeys, periodEnd, todayKey })
```
- `reminderDayKeys` = distinct Asia/Singapore date keys of the matched reminders (two taps on the same day count once — this is the idempotency rule).
- `count = reminderDayKeys.length`; `daysPastDue = dayDiff(todayKey, periodEnd)`.
- `overdue` if `count >= 2` OR (`count >= 1` AND `daysPastDue >= 21`); else `followup` if `count >= 1`; else `first`.
- A notice that has never been reminded always opens on `first`, however old. The tutor can pick another chip.
- Combined reminders: use the most advanced stage among included notices.
- If a recompute changed a notice's `period_start`/`period_end`, its history no longer matches and it falls back to `first`. That is the safe direction (softer tone). The "Last reminded N days ago (another notice)" line (4.2) still warns the tutor.
- Known limitation: two per-lesson notices for the same student on the same date share a key and show the same reminder history.

### 6.3 Lesson dates for `{period}`
On opening the sheet, fetch per included notice:
`supabase.from("lessons").select("lesson_date").eq("tutor_id", user.id).eq("payment_cycle_id", cycle.id).eq("is_completed", true).order("lesson_date")`.
If that returns zero rows, fall back to the existing date-range query used by `handleRemind` today (`student_id`, `is_completed`, `lesson_date` between `period_start` and `period_end`). Fetch `tutors.full_name, paynow_number` in the same `Promise.all` (as `handleRemind` does now). Show "Preparing…" on the button while loading; on failure toast "Could not prepare the reminder. Please try again."

### 6.4 Money rules
| Case | Behaviour |
|---|---|
| Practice student (`is_practice`) | Never in owed rows, briefing, or reminders. |
| Agency collects (set-up A: `payee_id` set and `fee_collected_by <> 'me'`, or `agency_placement_id` set) | No Remind anywhere. Amount shown under "being collected by agencies". Mark as paid / Write off unchanged. |
| Tutor collects, pays agency (set-up B: `fee_collected_by = 'me'`) | Normal reminder for the full `amount_due`. Commission is not mentioned to the parent. |
| No agency (`payee_id` null) | Normal reminder, whatever `fee_collected_by` says. |
| Placement fee (`placement_fee_amount > 0` and (`placement_fee_start` is null or `cycle.period_end >= placement_fee_start`)) | Reminder allowed, amount unchanged, amber caution note in the sheet (4.3). No new fee maths in this feature. |
| Archived / deleted student with open notice | Included in briefing totals and in the Pending modal with tags. Remind allowed (the `/pay/:token` page still resolves; `get_payment_summary` does not filter on `deleted_at`). |
| Waived | Not owed, not remindable. Existing reminder log rows are kept. Undo write-off brings the notice back with its history (same key). |
| Paid | Not remindable. Log rows kept. |
| `status = 'overdue'` rows | Treated exactly like `pending` (as everywhere else today). |
| `amount_due = 0` | Hide Remind (nothing to ask for). |

### 6.5 Timezone (Asia/Singapore)
- New helper in `src/utils/sgt.js`:
  `export function sgtDateKey(d = new Date())` → `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(d)` (gives `YYYY-MM-DD`), and `export function sgtHour(d = new Date())`.
- "Reminded N days ago" = whole-day difference between `sgtDateKey(now)` and `sgtDateKey(new Date(reminded_at))`. 0 → "today", 1 → "yesterday", else "N days ago". Never use `toISOString()` for day maths.
- `reminded_at` is written by the database default `now()` (do not send a client timestamp).
- **Existing bug to fix in the briefing phase:** `Dashboard.jsx` builds the Upcoming list with `today.toISOString().slice(0, 10)` (UTC). Before 8am Singapore time that is yesterday's date, so today's lessons also appear under "Upcoming". Replace `todayStr`/`sevenDaysOutStr` with `todayKey()` / `toDateKey(sevenDaysOut)`. A morning briefing makes this visible, so fix it here.

### 6.6 Concurrency, idempotency, limits
- Double tap on Send: disable the button after the first tap; stage counting is per distinct SGT day, so a duplicate row cannot escalate the tone.
- Two devices: both may log; harmless for the same reason.
- `window.open` must run before any `await` in the click handler, or mobile browsers block it.
- Reminder log load (Dashboard, Payments, StudentProfile): `select("id, student_id, payment_cycle_id, period_start, period_end, stage, reminded_at").eq("tutor_id", user.id).gte("reminded_at", <180 days ago ISO>).order("reminded_at", { ascending: false })`, paged with `.range()` in blocks of 1,000 until a short page returns. Put this in `src/lib/reminders.js` as `loadReminders(supabase, tutorId)`.
- Template body max 1,000 chars (DB check). A full message stays far below WhatsApp link limits.
- Templates: save with `upsert({ tutor_id, stage, body, updated_at: new Date().toISOString() }, { onConflict: "tutor_id,stage" })`; reset with `delete().eq("tutor_id", …).eq("stage", …)`.
- The existing unpaged queries in `loadAll` are not changed by this feature (out of scope; current max is 231 lessons).

### 6.7 Month-end close hook
In `src/lib/briefing.js`:
```js
export const MONTH_END_CLOSE_ROUTE = null; // set by the month-end-close feature
export function getMonthEndPrompt({ todayKey, openNoticeCount, isMonthClosed })
```
- Returns a prompt when today (SGT) is in the last 3 days of a month: `"{Month} ends in {n} days · {k} notices still open"` (n = 0 → "ends today").
- Returns a prompt on days 1–5 of a month for the previous month: `"{Previous month} is ready to close"`, unless `isMonthClosed?.(previousMonthKey)` is true.
- Link target: `MONTH_END_CLOSE_ROUTE` if set, otherwise `/payments`. Until `docs/specs/month-end-close.md` ships, `isMonthClosed` is not passed and the row simply links to Payments. That feature only needs to set the constant and pass `isMonthClosed`.

### 6.8 Booking requests in the briefing
Extend the existing count query in `loadAll` to also fetch the earliest-expiring pending request: `select("id, student_id, start_at, expires_at").eq("status","pending").gt("expires_at", now).order("expires_at").limit(1)` (keep the count query). Row text: `"1 booking request waiting · expires in 5h"`; link `/booking-requests`. Expired requests are not counted (same filter as today).

### 6.9 Stalled cycles
Use the existing `stalledItems` (lessons mode, unbilled completed lessons, last lesson > 21 days ago, nothing scheduled). The briefing row shows `notYetBilled` and `"(N stalled)"` where N = `visibleStalledItems.length`, excluding practice students. No Remind for stalled items: there is no notice yet. The row scrolls to "Needs your attention" where **Bill now** lives.

---

## 7. Security / RLS review checklist

- [ ] `payment_reminders` and `reminder_templates` have RLS enabled and exactly four policies each (S/I/U/D), all `TO authenticated`, all scoped `tutor_id = (SELECT auth.uid())`.
- [ ] `anon` has no table privileges on either table (V3). No anon/parent page reads them. `/pay/:token` and `get_payment_summary` are untouched.
- [ ] INSERT policy on `payment_reminders` also checks the student belongs to the tutor. That sub-select reads `students`, whose own policies do not reference the new tables → no circular policy.
- [ ] No SECURITY DEFINER function is added. No existing function, trigger or policy is altered.
- [ ] No FK to `payment_cycles`, so the DELETE inside `recompute_payment_cycles` cannot be blocked or slowed.
- [ ] Every frontend write includes `tutor_id: user.id`; every read/delete filters `.eq("tutor_id", user.id)`.
- [ ] No message text is stored (only stage, amount snapshot, dates), so parent names/phones are not duplicated into a new table.
- [ ] Payment link is always built by `buildPaymentSummaryUrl` (production domain), never from `window.location` (previews would leak preview URLs to parents).
- [ ] Domain isolation: all new UI is behind `!isPractitioner`; `AgencyDashboard.jsx` and agency tables are untouched; agency owners gain no access (the agency SELECT policies on `students`/`tutors` do not extend to the new tables).
- [ ] The wa.me link is opened only from a user click. No timers, effects or background code call `window.open`.

---

## 8. Acceptance tests (run on the Netlify deploy preview; previews use the LIVE database)

Set-up: use a **practice/test student** you create for this ("Test Reminder", per-lesson, your own number as WhatsApp number). Clean up at the end (T19).

**Schema (after Phase 1 is run)**
- T1. Run V1–V6 from 5.4. Results match the expectations in the comments.

**Refactor (Phase 2)**
- T2. Before merging, note the Dashboard Pending figure and the rows/total in "All outstanding pending" on production. On the preview they are identical (same names, amounts, tags, total).
- T3. Data check (Claude can run, read-only). Sum of `owed` must equal the cycle rows in the modal; modal total minus this = the "Not yet billed" rows:
```sql
SELECT
  count(*)                                             AS open_notices,
  coalesce(sum(pc.amount_due), 0)                      AS owed_total,
  coalesce(sum(pc.amount_due) FILTER (
    WHERE s.agency_placement_id IS NOT NULL
       OR (s.payee_id IS NOT NULL AND s.fee_collected_by <> 'me')), 0) AS via_agency,
  coalesce(sum(pc.amount_due) FILTER (
    WHERE NOT (s.agency_placement_id IS NOT NULL
       OR (s.payee_id IS NOT NULL AND s.fee_collected_by <> 'me'))), 0) AS owed_to_tutor,
  count(DISTINCT pc.student_id) FILTER (
    WHERE NOT (s.agency_placement_id IS NOT NULL
       OR (s.payee_id IS NOT NULL AND s.fee_collected_by <> 'me')))     AS families
FROM payment_cycles pc
JOIN students s ON s.id = pc.student_id
WHERE pc.tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e'
  AND pc.status IN ('pending', 'overdue');
-- After migration 059 is live, add:  AND coalesce(s.is_practice, false) = false
```

**Briefing (Phase 3)**
- T4. Open the Dashboard. Top card shows today's date, "Good morning/afternoon/evening, {first name}" matching the time, and a sentence. `owed_to_tutor` and `families` from T3 match the "families owe you" row; `via_agency` matches the agencies row.
- T5. Tap each row: lessons → page scrolls to TODAY; owed → "All outstanding pending" modal opens with the same total as the Pending tile; booking → `/booking-requests`.
- T6. Conditional rows: a row whose value is zero is absent (e.g. no booking row when there are no pending requests). Create a booking request from a student's booking link → refresh → the row appears with "expires in …".
- T7. Collapse the card → rows hide. Refresh → still collapsed. (Tomorrow it is open again; to test now, delete `chopeandpay_briefing_collapsed` in DevTools → Application → Local Storage.)
- T8. Loading state: throttle the network to "Slow 3G" in DevTools and refresh → greeting shows at once with grey skeleton bars, then fills in.
- T9. All-clear state: log in as a test tutor account with one student, no lessons today and nothing owed → sentence reads "All clear today…", no rows.
- T10. Upcoming list no longer contains a lesson dated today (check before 8am, or set the device clock to 7am).
- T11. Log in as a practitioner test account → no briefing card; dashboard unchanged.

**Reminders (Phase 4)**
- T12. Mark a lesson Done for "Test Reminder" so a notice appears in Needs your attention. Tap **Remind** → sheet opens on "First request" with name, period "the lesson on {date}", amount, PayNow, `https://chopeandpay.com/pay/…` link. Edit a word → tap **Send on WhatsApp** → WhatsApp opens to your own number with the edited text. Back in the app: toast "WhatsApp opened for … Marked as reminded today.", row shows "Reminded today · Undo", button says "Remind again".
- T13. Data check (read-only):
```sql
SELECT stage, channel, amount_due, period_start, period_end,
       (reminded_at AT TIME ZONE 'Asia/Singapore')::date AS sgt_day
FROM payment_reminders
WHERE tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e'
ORDER BY reminded_at DESC LIMIT 5;
```
  Expect one new row, stage `first`, channel `whatsapp`, amount equal to the notice.
- T14. Tap **Remind again** → opens on "Gentle follow-up" with the amber "You reminded … today" note. Tap **Not now** → nothing new in T13.
- T15. Tap **Undo** on the row → "Reminded today" disappears, button back to "Remind"; T13 shows the row gone.
- T16. Survives recompute: remind again (row shows "Reminded today"), then mark a second lesson Done for the same student (this rebuilds the pending notices with new ids). The first notice still shows "Reminded today".
- T17. Conditional notes:
  - Remove the student's WhatsApp number → sheet shows "No WhatsApp number saved…" with "Add number"; Send opens WhatsApp's chat picker.
  - Set the number to "Mrs Tan" → sheet shows "doesn't look like a phone number".
  - Clear PayNow in Settings → note "Your PayNow number isn't set" and no "PayNow:" line in the draft. Restore it after.
  - Student with a placement fee → amber caution appears.
  - Two unpaid notices for the same student → "All 2 unpaid notices · $X" is pre-selected; toggling "Only this notice" changes amount and period.
  - Copy → "Copied!" then "Sent it yourself? Mark as reminded" → tap → row shows "Reminded today" (T13: channel `copy`).
- T18. Agency: for an agency-collected student with an open notice, the row shows "Agency collects · {name}" and no Remind (Dashboard and Pending modal). Switch a test student to "I collect" → Remind appears.
- T19. Clean up: write off or delete the test lessons/notices; delete the test student. Optional read-only check that no test rows remain in T13.

**Other pages (Phase 5)**
- T20. Payments page and Student profile: Remind/Request payment opens the same sheet, shows "Reminded N days ago", hides Remind for agency-collected students. Practitioner account still gets the old message preview.

**Templates (Phase 6)**
- T21. Settings → Reminder messages → edit "Gentle follow-up", Save → toast. Open a follow-up reminder → your wording, placeholders filled. Reset to default → default wording returns. From the sheet, "Save as my … template" does the same. Try saving an empty template → visible error, nothing saved.

---

## 9. Build phases (one PR each, into `claude/charming-cray-new6h0`)

### Phase 1 — Schema (propose SQL only)
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 5 and 7 matter most).

Task: PROPOSE SQL ONLY. Create branch `feature/reminders-062-schema` from claude/charming-cray-new6h0.
Add ONE file: supabase/migrations/062_payment_reminders.sql containing exactly the migration in section 5.3 of the spec (BEGIN/COMMIT, both tables, indexes, comments, 4 RLS policies per table, revoke anon, grant authenticated).
Also add the verification queries from section 5.4 as a commented block at the bottom of the same file.

Rules:
- Do NOT run any SQL. Do NOT use any Supabase tool to change the database. Hanyong runs the migration by hand in the Supabase SQL Editor after review.
- Do NOT touch any file under src/. No frontend changes in this PR.
- Do NOT modify any earlier migration.
- If you believe the SQL in the spec is wrong, do not silently change it: keep it, and list your concern in the PR description.

When done: open a PR into claude/charming-cray-new6h0 titled "Migration 062: payment_reminders + reminder_templates (SQL proposal only)". Report back: branch name, commit hash, PR number/link, and the full SQL for review. Do not merge.
```

### Phase 2 — Shared owed rows (refactor, no visible change)
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 6.1, 6.4, 6.5).

Task: pure refactor, no visible change. Create branch `feature/owed-rows-refactor` from claude/charming-cray-new6h0.

1. Create src/lib/owed.js exporting buildOwedRows, sumOwed, isAgencyCollected exactly as specified in section 6.1. Move (do not rewrite) the logic from src/pages/Dashboard.jsx: the `allPendingAmount` block and the `isCurrentMonth` branch of `pendingBreakdownRows`. Keep every existing rule. Add only the two NEW rules in 6.1 (skip is_practice === true; add collector/collectorName).
2. In Dashboard.jsx: load payees (`supabase.from("payees").select("id, name").eq("tutor_id", user.id)`) inside loadAll; compute `owedRows` once; set `allPendingAmount = sumOwed(owedRows)`; make the current-month `pendingBreakdownRows` return `owedRows`. Leave the past-month branch, MonthlyRecapCard, and "Needs your attention" untouched.
3. Add sgtDateKey and sgtHour to src/utils/sgt.js (section 6.5).
4. Add a dev-only check (`import.meta.env.DEV`) that logs console.error if the invariant in 6.1 fails.

Files: src/lib/owed.js (new), src/pages/Dashboard.jsx, src/utils/sgt.js. Nothing else.
Rules: Do NOT run SQL or change the database. Do NOT change any amount calculation. Do NOT touch practitioner or agency code. Run `npm run lint` and `npm run build` and fix errors.

When done: open a PR into claude/charming-cray-new6h0. Report: branch, commit hash, PR number, deploy preview URL, and a short note confirming the Pending tile and the "All outstanding pending" modal are unchanged. Do not merge.
```

### Phase 3 — Today briefing card
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 3.1, 4.1, 6.1, 6.5, 6.7, 6.8, 6.9). Look at the "Today" greeting block in the concept file for look and feel (Main.dc.html, heading "Good morning, …").

Precondition: Phase 2 is merged. Create branch `feature/today-briefing` from claude/charming-cray-new6h0.

1. Create src/lib/briefing.js: buildBriefing(...) returning { dateLabel, greeting, sentence, items[] } per section 4.1, MONTH_END_CLOSE_ROUTE (null) and getMonthEndPrompt per 6.7. Pure functions, no Supabase calls.
2. Create src/components/TodayBriefing.jsx per 4.1 (loading skeleton, all-clear state, collapse stored in localStorage key `chopeandpay_briefing_collapsed` inside try/catch, rows hidden when zero).
3. In src/pages/Dashboard.jsx: render <TodayBriefing/> as the first child of the left panel, only when !isPractitioner. Feed it from existing state (todayLessons, overdueLessons, owedRows, visibleStalledItems, pendingBookingCount). Add ids/refs so rows can scroll to the TODAY card, the status-update card and "Needs your attention". The owed rows call the existing handlePendingTap(new Date(), true). Add the earliest-expiring booking request query (6.8). Fetch the tutor's full_name in the existing tutors select.
4. Fix the UTC date bug described in 6.5 (todayStr / sevenDaysOutStr in the Upcoming list).
Do not use the reminder tables in this phase (no "last reminded" sub-line yet).

Files: src/lib/briefing.js (new), src/components/TodayBriefing.jsx (new), src/pages/Dashboard.jsx.
Rules: Do NOT run SQL or change the database. Do NOT remove or reorder existing Dashboard sections. Do NOT touch practitioner/agency code. All localStorage in try/catch. Run `npm run lint` and `npm run build`.

When done: open a PR into claude/charming-cray-new6h0. Report: branch, commit hash, PR number, deploy preview URL, and which acceptance tests T4–T11 you could verify yourself. Do not merge.
```

### Phase 4 — Reminder sheet + reminder log on the Dashboard
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 3.2–3.7, 4.2, 4.3, 4.4, 6.2–6.6).

Precondition: Hanyong has confirmed migration 062 is LIVE (ask him if unsure; do not check by writing to the database). Phases 2 and 3 are merged. Create branch `feature/reminder-sheet` from claude/charming-cray-new6h0.

1. Create src/lib/reminders.js: DEFAULT_TEMPLATES (the three texts in 4.4, verbatim), STAGE_LABELS, renderTemplate (line-drop rule in 4.4), buildPeriodPhrase, noticeKey, remindersForNotice, computeReminderStage, describeReminded ("Reminded 3 days ago · 2 reminders"), loadReminders (paged with .range, 6.6), logReminders, undoTodayReminders.
2. Create src/components/ReminderSheet.jsx per 4.3: stage chips, combined/only-this toggle, editable bubble textarea, all notes in the table, Send on WhatsApp (window.open BEFORE any await, using buildWhatsAppLink from src/lib/whatsapp.js), Copy + "Mark as reminded", Not now. Custom templates are NOT in this phase: always use DEFAULT_TEMPLATES and hide the "Save as my template / Reset" links.
3. src/pages/Dashboard.jsx: load reminders in loadAll; replace the body of handleRemind so it opens ReminderSheet (keep the "Preparing…" state and error toast); show the reminded line, "Remind again", Undo and the "Agency collects" chip in "Needs your attention" (4.2); hide Remind when isAgencyCollected(student) or amount is 0; make the Mark as paid toast specific (3.7); add the "last reminded" sub-line to the briefing owed row.
4. src/components/PendingBreakdownModal.jsx: same reminded line / Remind again / agency chip for cycle rows (pass what it needs via props).
Leave MessagePreviewModal in place (still used for receipts and by practitioners).

Files: src/lib/reminders.js (new), src/components/ReminderSheet.jsx (new), src/pages/Dashboard.jsx, src/components/PendingBreakdownModal.jsx.
Rules: Do NOT run SQL. Do NOT create or alter tables. Never call window.open outside a click handler. Never send anything automatically. Every insert includes tutor_id: user.id; every select/delete filters by tutor_id. Show a visible error for every failure (no silent failures). Do NOT touch practitioner/agency code. Run `npm run lint` and `npm run build`.

When done: open a PR into claude/charming-cray-new6h0. Report: branch, commit hash, PR number, deploy preview URL, and which of T12–T19 you verified. Do not merge.
```

### Phase 5 — Same flow on Payments and Student profile
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 4.2, 4.3, 6.2, 6.4).

Precondition: Phase 4 is merged and confirmed live. Create branch `feature/reminder-sheet-payments-profile` from claude/charming-cray-new6h0.

1. src/pages/Payments.jsx: for tutors (not practitioners), handleRequestPayment opens ReminderSheet instead of MessagePreviewModal; load reminders with loadReminders; show the reminded line and "Remind again"; hide the request/remind button and show the "Agency collects" chip when isAgencyCollected(student). Practitioners keep the existing MessagePreviewModal flow unchanged. Receipts (handleSendReceipt) unchanged.
2. src/pages/StudentProfile.jsx: same changes for its handleRequestPayment.
Make sure the students select on both pages includes payee_id, fee_collected_by, agency_placement_id, placement_fee_amount, placement_fee_start, placement_fee_agency, payment_token, guardian_name, guardian_contact, archived, deleted_at (and is_practice if the column exists — select("*") is fine).

Files: src/pages/Payments.jsx, src/pages/StudentProfile.jsx (and src/components/ReminderSheet.jsx only if a prop is missing).
Rules: Do NOT run SQL. Do NOT change any amount or cycle logic on these pages. Do NOT touch practitioner/agency behaviour. Run `npm run lint` and `npm run build`.

When done: open a PR into claude/charming-cray-new6h0. Report: branch, commit hash, PR number, deploy preview URL, result of T20. Do not merge.
```

### Phase 6 — Own templates + What's New
```text
Read docs/specs/today-briefing-and-reminders.md fully first (sections 3.8, 4.4, 4.5, 6.6).

Precondition: Phase 5 is merged and confirmed live; migration 062 is live. Create branch `feature/reminder-templates` from claude/charming-cray-new6h0.

1. src/lib/reminders.js: add loadTemplates, saveTemplate (upsert onConflict "tutor_id,stage"), resetTemplate (delete), and getTemplate(stage, customTemplates) → custom body or default.
2. src/components/ReminderSheet.jsx: use getTemplate; show "Save as my {stage} template" (saves the current textarea text exactly as typed — warn with window.confirm that names and amounts in it will be reused for every family unless they use the {tags}) and "Reset to default".
3. src/pages/Settings.jsx: add the "Reminder messages" section (4.5) after "Payment settings", tutors only, with tag helper text, live preview, 1,000-char counter, Save / Reset, visible errors.
4. src/pages/Dashboard.jsx: update ANNOUNCEMENT (new id `whats-new-2026-11-briefing`) with two bullets: the Today briefing, and smarter reminders ("Reminded 3 days ago", your own wording in Settings).

Files: src/lib/reminders.js, src/components/ReminderSheet.jsx, src/pages/Settings.jsx, src/pages/Dashboard.jsx.
Rules: Do NOT run SQL. Empty templates must be rejected in the UI with a visible message before calling Supabase. Do NOT touch practitioner/agency code. Run `npm run lint` and `npm run build`.

When done: open a PR into claude/charming-cray-new6h0. Report: branch, commit hash, PR number, deploy preview URL, result of T21. Do not merge.
```

---

## 10. Open questions for Hanyong

1. **Agency-collected students: hide Remind completely?** Recommended: yes, hide it and show "Agency collects · {name}". Alternative: keep a secondary "Remind anyway" link. (2 of the 8 open notices in the database today are agency-collected.)
2. **Placement fees:** should the reminder amount be reduced by the placement fee automatically? Recommended: no for now. Keep `amount_due` and show the caution note; correct amounts need the fee-drain maths wired into notices, which is a separate money change.
3. **Combined reminder as default** when a family has several unpaid notices? Recommended: yes (one message, total amount), with "Only this notice" as the toggle.
4. **Stage thresholds:** follow-up after 1 reminder; overdue after 2 reminders or 1 reminder + 21 days past due; "give it another day" hint under 3 days. Recommended as written; say if you prefer different numbers.
5. **Store the message text in the log?** Recommended: no (keeps parent details out of a new table). Trade-off: you cannot look up exactly what you sent.
6. **"Needs your attention" list** stays active-students-only (as today), with archived/deleted amounts reachable through the briefing → Pending modal. Recommended: keep. Alternative: also list archived/deleted rows there with tags.
7. **Booking requests in the briefing** link to the Booking requests page rather than Confirm/Decline inline. Recommended for now; inline confirm is listed under Later.
8. **Emoji in default templates** (😊 🙏): keep or remove? Recommended: keep these two only; they match the current messages.
9. **Briefing for practitioners:** recommended none (tutor-only), to keep the domains separate.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Briefing shows a different number from Pending | One function (`buildOwedRows`) feeds Pending, the modal and the briefing; dev-time invariant check; T2–T4 compare against SQL. |
| Refactoring money code breaks Pending | Phase 2 is a move-only PR with no visible change, tested alone before anything is stacked on it. |
| Reminder history lost when notices are rebuilt | Log lives in its own table, matched by student + period, not by cycle id; T16 tests exactly this. |
| Migration interferes with billing | No FK to `payment_cycles`, no function/trigger/policy changes; V4 and V6 verify. |
| RLS mistakes (403 on insert, silent empty reads) | Four explicit policies per table for `authenticated`, explicit grants, anon revoked; V1–V3; T12–T15 exercise insert, select and delete. |
| Tutor chases a parent whose agency collects | `isAgencyCollected` hides Remind everywhere; rule accounts for the `fee_collected_by` default (finding 4). |
| Wrong amount sent where a placement fee applies | Caution note in the sheet; amount is editable; open question 2. |
| Message sent to the wrong chat / no number | Notes explain what will happen; invalid numbers fall back to WhatsApp's chat picker (existing `normalizeWhatsAppNumber` behaviour). |
| Something gets sent without the tutor | Only a user click opens `wa.me`; WhatsApp itself still requires pressing send; security checklist item. |
| "Marked as reminded" when the tutor did not actually send | Wording says "WhatsApp opened … marked as reminded", and Undo is one tap. |
| Popup blocked on mobile | `window.open` runs before any `await`. |
| Day counts off by one around midnight / before 8am | All day maths through `sgtDateKey`; existing UTC bug in Upcoming fixed in Phase 3. |
| Saved template contains a specific family's name or amount | Confirm dialog when saving from the sheet; Settings preview with sample values. |
| Depends on migration 059 (`is_practice`) landing | Filter is written as `is_practice === true`, a no-op until the column exists; no ordering constraint between 059 and 062. |
| Preview deployments write to the live database | Tests use a dedicated test student and end with clean-up (T19). |
