# Spec — Month-end close (+ tax-season tie-in)

Written 16 Nov 2026 from Hanyong's planning notes. Grounded in production branch `claude/charming-cray-new6h0` at commit `e260e76`, the unmerged `year-end-report-pr4` branch, and the live Supabase schema (project `cdskiekviymkessedlem`, read-only inspection). Migration number: **060**. The SQL in section 5 was dry-run on a scratch local Postgres with stand-in tables (not on the live database) — see section 5.4.

Concept reference: `Main.dc.html` → **"Month-end close"** screen and **"Tax season"** screen.

---

## 1. Plain-language summary for Hanyong

- Once a month is over, you open **Month-end close**, see that month's recap (lessons, take-home, collected, pending, who earns what) and a short **"Before you close"** checklist: lessons not marked done, unpaid notices, lessons not billed yet, agency statements not sent.
- Every open item must be dealt with **or explicitly carried into next month**. Nothing is silently ignored. Then you tap **Close October** — confetti, done.
- Closing **saves a snapshot** of the month's figures. The figures are worked out by the same JavaScript the recap and year-end report already use, then stored, so a closed month always shows what you signed off.
- After closing you can still edit things, but the app **warns you first** and the database **keeps a change log** (when, what, old → new amount). You can **reopen** a month with a reason and close it again.
- Money that arrives later for a closed month does **not** change what you earned in that month. It shows as "collected since close" and counts as cash in the month it actually arrived.
- The year-end report uses the closed snapshots, flags any month **"Changed after close"**, shows **"12 of 12 months ready"**, and gets a **Copy summary for accountant** button.
- Nothing changes for parents. Practice students are left out of everything; archived and deleted students are included.

---

## 2. Scope

**In**
- New tutor page `/month-close?month=YYYY-MM` (recap, who earns what, checklist, carry forward, close, closed state, reopen with reason, changes since close).
- Saved snapshot per tutor + month; reproducible (section 6.2).
- Server-side change log (database triggers) for lessons and payment notices in closed months.
- Warning before any change that touches a closed month, at every place in the app that edits lessons or payment notices.
- Year-end report tie-in: snapshot figures for closed months, "Changed after close" markers, readiness card, copy summary for accountant, Singapore-time fix for the Collected / Written off columns.
- Entry points: link on Payments, chip + link on the Dashboard recap card, a dismissible "time to close" nudge, What's New bullet.

**Out**
- Expense tracking (the concept's "Less allowable expenses" line is not built).
- Any change to `recompute_payment_cycles`, `handle_lesson_change`, `get_payment_summary`, `/pay/:token`, parent pages, practitioner screens, agency-domain screens (`AgencyDashboard`, `agency_*` tables).
- Hard-locking a closed month (edits stay possible — warn + log only).
- Restyling the year-end report to the concept's "Tax season" look (only the listed additions).

**Later**
- Warning when a *setting* change (student default rate, payee share %, placement fee, "fee collected by") shifts a closed month. In v1 these are caught by the snapshot-vs-live comparison (section 6.6) but there is no pop-up at the moment of the edit.
- A "why did you change this?" note on each log entry.
- Auto-reminder / push notification on the 1st of the month.
- Snapshot-based per-student record cards in the year-end report (they stay live in v1).
- Month-end close for practitioners.

---

## 3. User stories & flows

Placeholders used below: **Student A / Parent A**, **Agency X** (a payee with a share %), **Agency Y** (placement fee only).

### 3.1 Close a month (happy path) — concept "Month-end close", open state
1. On 1–10 Nov the Dashboard shows a nudge: "October's done. Close the month — takes 2 minutes." Tap **Close October**. (Also reachable from Payments, and from the recap card when viewing a past month.)
2. The page opens on October 2026. Intro line: "One thing left to decide, then you can close the month." (or "3 things left…", or "Everything is in order. Ready when you are.").
3. Four tiles: Lessons taught · My take-home · Collected · Pending. Below: "Who earns what" (stacked bar + rows: My take-home, each agency, Total billed) — same numbers as the Dashboard recap card for that month.
4. "Before you close" checklist. Done lines show a green tick ("All 31 lessons marked done", "Agency X statement sent, $576", "Nothing to write off"). Open lines show an amber ring and action buttons.
5. Tutor resolves each open line (Mark as paid / Write off / Bill now / Mark done / Open statement) **or** taps **Carry into November**. A carried line turns green with "…, carried into November" and the Pending tile label becomes "Pending, carried".
6. The button at the bottom reads "Resolve 2 items to close" (disabled, grey) until zero open lines remain, then **Close October** (mint).
7. Tap **Close October** → snapshot is built, checked, saved → confetti → closed state.

### 3.2 Closed state — concept "October closed" card
- Card at top: tick, "October closed", "$6,650 take-home, locked. That is $630 more than September, and your tax report is already updated." The comparison sentence appears only when the previous month is also closed.
- Intro line: "Closed on 16 Nov. Figures are locked."
- Tiles and "Who earns what" now come **from the snapshot**.
- "Since close" strip (only if anything happened): "Parent A paid $480 on 12 Nov. Still outstanding: $0."
- "Changes since close" list (only if the log has lesson/billing entries) + a Closed vs Now comparison (section 4.6).
- Text link **Reopen October**.

### 3.3 Carry forward
- Carry is a per-item, explicit decision, stored in the snapshot at close (`carried[]`).
- A carried item that is still open shows up in the **next** month's checklist labelled "Carried from October". It must be resolved or carried again there. It is never dropped.
- **Carry all (n)** button appears when 3 or more items are open.

### 3.4 Reopen
1. Tap **Reopen October** → modal asks "Why are you reopening October?" (required, 3+ characters).
2. Confirm → month status becomes *reopened*. The page shows live figures again with a banner "Reopened on 20 Nov — 'Forgot a lesson'. Last closed figures are kept below for comparison."
3. While reopened, edits to that month are **not** warned or logged (it is open). The year-end report treats it as not closed.
4. Tutor fixes things and taps **Close October again** → new snapshot, revision 2. Both the reopen (with reason) and the re-close (old → new revenue) are in the log.

### 3.5 Editing something in a closed month
1. Tutor edits / adds / deletes a completed lesson dated in closed October (or marks done / undoes done), or pays / writes off / undoes / bills a notice that belongs to October.
2. Before saving, a confirm appears (copy in 4.7). Cancel → nothing changes.
3. OK → the change is saved as normal; the database trigger writes the log row.
4. October's close page and the year-end report now show the marker (section 6.6).

### 3.6 Tax season — concept "Tax season"
1. Year-end report shows a readiness card: "10 of 12 months ready" with the list of months to close (links, oldest first).
2. Month rows show a lock for closed months and an amber "Changed after close" tag where live records no longer match the snapshot.
3. When all months are ready: "All 12 months closed and unchanged. Ready to share."
4. **Copy summary for accountant** copies a short text block (section 4.8).

### 3.7 Catching up on past months (first use)
The tutor can close any past month. Recommended order is oldest first; the page says so but does not force it (section 6.9). For old months the checklist only shows what is *still* open today, so catching up is quick.

---
## 4. UI spec

Mobile-first, single column, max width `max-w-lg` centred on desktop, inside `AppShell`. Reuse existing colours: navy `#1b2d4f`, mint `#5ecfaa`, pale mint `#edf6f3` / border `#b8e8d9`, amber `text-amber-700`, green text `#0f7a58`. Buttons `min-h-11`. Tutor-only: practitioners (`user.user_metadata.user_type === "practitioner"`) see "Month-end close is for tutors only." (same pattern as `YearEndReport.jsx`).

### 4.1 Route and month picker
- Route `/month-close` (protected, same wrapper as `/payments` in `src/App.jsx`). Query `?month=YYYY-MM`.
- Default month = the **oldest month that has activity and is not closed**, limited to the previous 12 months; if none, the previous month (Singapore time).
- Header: small caps label "Month-end close", `h1` "October 2026", intro line, and ← → buttons (same style as `MonthlyRecapCard`). → is disabled once the next month is not over yet.
- Invalid or future `month` param → fall back to the default and show nothing scary.
- A month that is not over yet (Singapore time): tiles + checklist are shown as a preview, the button reads "You can close November from 1 Dec" (disabled).

### 4.2 States
| State | What shows |
|---|---|
| Loading | Centred mint spinner (same as `YearEndReport.jsx`), text "Adding up October…" |
| Load error | Red box: "Couldn't load this month. Check your connection and try again." + **Try again** button. Never show partial numbers. |
| Nothing happened | No completed lessons, no notices, no cash: "Nothing happened in January 2026 — no lessons, no payments. Nothing to close." No close button. (Counts as ready for tax season, 6.8.) |
| Open, items unresolved | 4.3–4.5, close button disabled "Resolve n item(s) to close" |
| Open, all resolved | Close button enabled "Close October" |
| Closing | Button shows "Closing…" and is disabled (prevents double tap) |
| Close failed | Red box above the button with the reason (4.9). Month stays open. |
| Just closed | Closed card with pop animation + confetti (once) |
| Closed (revisit) | Closed card, no confetti |
| Closed, changed | Closed card + amber "Changed after close" panel (4.6) |
| Reopened | Amber banner with date + reason, live figures, "Close October again" |

### 4.3 Tiles (2 × 2 grid, concept "Month-end close")
| Tile | Value | Note |
|---|---|---|
| Lessons taught | completed lessons dated in the month | |
| My take-home | `mine` from `buildEarningsBreakdown` | green |
| Collected | paid notices whose `period_end` is in the month (same rule as `MonthlyRecapCard`) | |
| Pending / "Pending, carried" | pending + overdue notices whose `period_end` is in the month | amber; label becomes "Pending, carried" when every such notice is carried or the month is closed |

Muted line under the tiles: "Cash received in October (any month's notices): $X · Written off in October: $Y" (by payment / write-off date, Singapore time — these are the year-end report's Collected / Written off figures).

### 4.4 Who earns what
Card titled "Who earns what": a stacked bar (take-home mint, agencies navy shades) then rows — "My take-home", one row per agency ("Agency X, 20% share" or "Agency Y, placement fees"), and "Total billed". Rows expand to per-student lines exactly like the existing recap card (reuse its markup; do not change `MonthlyRecapCard` in this phase). If there are no agencies, show only "My take-home" and "Total billed".

### 4.5 "Before you close" checklist
One card, one row per line. Done = filled mint circle with tick. Open = white circle with 2px amber border. Carried = mint circle with tick + text "…, carried into November".

Line types, in this order (rules in 6.4):

| # | Type | Done text | Open text | Buttons on open rows |
|---|---|---|---|---|
| 1 | Lessons not marked done | "All 31 lessons marked done" | "Student A · 14 Oct · not marked done" | **Mark done** · **Didn't happen — delete** · Carry |
| 2 | Lessons with no fee | (hidden when none) | "Student A · 14 Oct · no rate set ($0)" | **Fix in Lessons** (link) · Carry |
| 3 | Unpaid notices | "Every October notice is paid" | "Parent A still owes $480" + tag Overdue/Pending | **Mark as paid** · **Write off** · Carry |
| 4 | Not billed yet | "Every completed lesson is billed" | "Student A · 2 lessons not billed yet ($240)" (+ "no upcoming lessons" if stalled) | **Bill now** · Carry |
| 5 | Agency statements | "Agency X statement sent, $576" | "Agency X statement not sent yet ($576)" | **Open statement** (link to `/statements?payee=<id>&month=YYYY-MM`) · Carry |
| 6 | Write-offs (info only) | "Nothing to write off" or "Written off in October: $90" | — | — |

- Items that come from an earlier month show a grey chip: "Carried from September" (if September's snapshot carried it) or "From September" (if not).
- More than 5 open rows of one type → show 5 + "Show n more".
- **Carry all (n)** text button at the top of the card when 3+ rows are open.
- Carry button label: "Carry into November". Tapping a carried row's "Undo" link un-carries it (only while the month is open).
- Archived / deleted students show the same grey "Archived" / red "Deleted" chips as `PendingBreakdownModal`.
- Each action shows a toast on success and a visible red error on failure. After any action the page reloads its data.
- Confirm texts:
  - Write off: reuse the existing sentence — "Write off $480 from Student A? This removes it from Pending. It won't count as Collected."
  - Bill now: "Bill Student A now? This creates one notice for all 3 unbilled lessons ($360)." and, when some are dated after the month, add "1 of them is dated after October."
  - Delete lesson: "Delete this lesson on 14 Oct? It won't be counted or billed."

### 4.6 Closed state extras
- **Closed card** (concept "October closed"): pale mint card, navy tick circle, "October closed", sentence from 3.2, text link "Reopen October".
- **Confetti**: 26 small falling rectangles, colours `#5ecfaa`, `#1b2d4f`, `#f3c98b`, `#9fb0cc`, pure CSS keyframes, `pointer-events: none`, removed after 3 s, shown only right after a successful close in this session, skipped when `prefers-reduced-motion: reduce`. No new npm package.
- **Since close strip** (grey card): one line per payment-status log row — "Parent A paid $480 on 12 Nov", "Wrote off $90 for Student B on 14 Nov", "Undid write-off…". Last line: "Still outstanding from October now: $0".
- **Changed after close panel** (amber card), shown when the comparison in 6.6 finds a difference or lesson/billing log rows exist:
  - Title "Changed after close".
  - Table "Closed · Now · Difference" for: Lessons, Total billed, Agencies earn, My take-home, Cash received, Written off (only rows that differ).
  - List "What changed" from the log, newest first: "18 Nov, 9:42 pm · Student A · lesson on 14 Oct edited · $120 → $160". Wording per action in 6.7.
  - If figures differ but the log has no lesson/billing rows: "No lesson edits were logged — a rate, agency share or placement-fee setting was probably changed."
  - If log rows exist but figures match: grey text "Edited after close, no net change."
  - Button **Reopen to update figures** (opens the reopen modal).
- **Reopen modal**: title "Reopen October?", body "Closed figures will be kept for comparison until you close it again.", textarea label "Why are you reopening it?" (required), buttons **Reopen** / Cancel. Inline red error if under 3 characters: "Please add a short reason."

### 4.7 Warning before a change in a closed month
A blocking confirm (use `window.confirm`, like the existing write-off confirm) from one shared helper. Copy:

- Lesson add / edit / delete / mark done / undo done:
  "October 2026 is closed.\n\nThis changes a lesson in a closed month. Your closed figures stay as they are, the change is logged, and the month will be marked 'Changed after close'.\n\nContinue?"
- Adding a lesson to a closed month, extra line: "A new payment notice may be created for it."
- Mark a closed-month notice as paid:
  "October 2026 is closed.\n\nThis payment counts as collected today. What you earned in October doesn't change. It will be logged.\n\nRecord payment?"
- Write off / undo write-off / bill now / undo a manual notice:
  "October 2026 is closed.\n\nThis changes a payment notice from a closed month. What you earned in October doesn't change. It will be logged.\n\nContinue?"
- When two closed months are touched (moving a lesson from one to another), name both: "September 2026 and October 2026 are closed."

If the list of closed months could not be loaded, do **not** block the action (fail open); the database still logs it.

### 4.8 Year-end report additions (after PR #4 is merged)
- **Readiness card** at the top (above the stat tiles):
  - Year still running: "2026 so far: 9 of 10 finished months ready. October isn't closed yet." + link "Close October →".
  - Year over, not all ready: "10 of 12 months ready. Close or review: November, December." (each a link to `/month-close?month=…`).
  - Year over, all ready: mint card "All 12 months closed and unchanged. Ready to share with your accountant."
  - Sub-line when some months had nothing: "Jan–Mar: no lessons or payments, nothing to close."
- **Monthly table**: a narrow first column with 🔒 for closed months. Amber tag "Changed after close" under the month name where 6.6 finds a difference; tapping it opens that month's close page. Grey tag "Reopened" for reopened months. Footnote under the table: "🔒 = closed figures. Other months are live and can still change."
- **Banner** (amber) when any closed month has changed: "2 closed months have changed since you closed them. Review them before you file." with links.
- **Copy summary for accountant** button under the 2-line statement (concept "Tax season" bottom button). Label switches to "Summary copied" for 3 s + toast "Summary copied, ready to paste into an email". If the clipboard is blocked, show the text in a read-only textarea with "Select all and copy". Text:

```
Income summary 2026 (Year of Assessment 2027), earned basis
Prepared from ChopeAndPay on 16 Nov 2026
Status: all 12 months closed and unchanged   |  or: DRAFT — 2 months not closed (Nov, Dec)

Revenue: $61,720.00
Commission paid to agencies: $1,240.00        (line omitted when zero)
Adjusted profit before expenses: $60,480.00    (exactly the figure shown in the 2-line statement)
Bad debts written off in 2026: $390.00
Collected in 2026: $58,900.00
Lessons taught: 412

Expenses are not tracked in ChopeAndPay. Not tax advice.
```

### 4.9 Error messages (close / reopen)
Map the error text returned by the RPCs:
| Contains | Show |
|---|---|
| `MONTH_ALREADY_CLOSED` | Treat as success: reload and show the closed state. |
| `MONTH_NOT_OVER` | "October isn't over yet (Singapore time). Try again from 1 Nov." |
| `BAD_SNAPSHOT` | "Something didn't add up, so the month was not closed. Please reload and try again." |
| `REASON_REQUIRED` | "Please add a short reason." |
| `MONTH_NOT_CLOSED` | Reload the page (it was already reopened elsewhere). |
| anything else | "Couldn't close October: <message>. Nothing was changed." |

### 4.10 Entry points
- **Payments page**: next to the year-end link added by PR #4, a second link "Month-end close". (If PR #4 is not merged yet, add the link block in the same place: bottom of `Payments.jsx`, tutors only.)
- **Dashboard recap card** (`MonthlyRecapCard`): when the month on screen is closed → chip "🔒 Closed 3 Nov" beside the title and the four tiles read from the snapshot: Lessons = `lessons`, Collected = `notices_paid_cents`, Pending = `notices_pending_cents` (label "Pending at close"), Projected earnings = paid + pending (the card's existing rule for past months). The "who earns what" block reads `mine_cents`, `agency_cents`, `agencies[]`, `gross_cents`. When the month is past and not closed → text link at the bottom "Close October →". Current month: unchanged.
- **Dashboard nudge**: from the 1st to the 10th (Singapore time), if last month has activity and is not closed: pale mint banner "October's done. Close the month — takes 2 minutes." + button **Close October** + ✕. Dismiss is remembered per month in `localStorage` (`cnp_close_nudge_dismissed_YYYY-MM`, wrapped in try/catch). For testing, `?showCloseNudge=1` on the Dashboard URL skips the 1st–10th date rule only.
- **What's New**: new `ANNOUNCEMENT.id` (`whats-new-2026-12-month-close`) with one bullet about month-end close.

---
## 5. Data model

### 5.1 Existing tables and columns used (checked against the live schema on 16 Nov 2026)

| Table | Columns used | Notes |
|---|---|---|
| `lessons` | `id, tutor_id, student_id, lesson_date (date), lesson_time, duration_minutes, rate, rate_type ('hourly'/'per_session'), is_completed, payment_cycle_id, student_name_snapshot, created_at` | `is_completed` is the truth. `lesson_date` is a plain date (already Singapore-local). FK `payment_cycle_id → payment_cycles ON DELETE SET NULL`. |
| `payment_cycles` | `id, tutor_id, student_id, period_start, period_end (date), amount_due, status ('pending','paid','overdue','waived'), paid_at, waived_at (timestamptz, stored in UTC), waived_from_status, is_manual_closeout` | Live today, all tutors: 104 paid, 8 pending, 1 waived, 0 rows with status `overdue` ("overdue" is worked out in `paymentStatus.js`, but treat `overdue` as unpaid everywhere anyway). 36 of the paid notices were paid in a different Singapore month from their `period_end` — which is why "Collected" needs the two separate meanings in 6.10. |
| `students` | `id, tutor_id, name, hourly_rate, payment_mode, payment_cycle_count, payment_custom_day, payee_id, fee_collected_by ('payee'/'me'), placement_fee_agency, placement_fee_amount, placement_fee_start, archived, deleted_at` and **`is_practice`** | `is_practice` is added by migration 059 and is **not live yet** (checked). 060 refuses to run without it. |
| `payees` | `id, tutor_id, name, share_percent, archived` | |
| `payee_statements` | `payee_id, month (first of month), status ('sent','reimbursed'), claimed_total, sent_at, share_percent` | 0 rows live. Unique `(payee_id, month)`. |
| `tutors` | `id` | FK target. |

Existing triggers on `lessons` (unchanged): `on_lesson_insert` → `handle_lesson_insert()`, `on_lesson_update` / `on_lesson_delete` → `handle_lesson_change()`. `payment_cycles` has no triggers today. The database time zone is **UTC** (`current_setting('TimeZone')`), so every "today" or "which month" decision in SQL must convert with `AT TIME ZONE 'Asia/Singapore'`.

Existing functions called from the new page (unchanged): `recompute_payment_cycles(p_student_id, p_tutor_id)`, `create_manual_closeout_cycle(p_student_id)`.

### 5.2 New objects (migration 060)

| Object | Purpose |
|---|---|
| `month_closes` | One row per tutor + month. Holds the snapshot, status (`closed` / `reopened`), revision, reopen reason. |
| `closed_month_changes` | Append-only change log. |
| `close_month(p_month date, p_snapshot jsonb)` | Saves / replaces the snapshot, logs it. Only callable by signed-in users, for their own months, once the month is over in Singapore time. |
| `reopen_month(p_month date, p_reason text)` | Reopens with a required reason, logs it. |
| `log_closed_month_lesson_change()` + trigger `trg_log_closed_month_lesson` on `lessons` | Logs money-relevant lesson changes in closed months. |
| `log_closed_month_cycle_change()` + trigger `trg_log_closed_month_cycle` on `payment_cycles` | Logs status / amount changes and manual-notice create / undo in closed months. |

No new columns on existing tables. No carry-forward table: carries are drafted in the browser and saved inside the snapshot at close (section 6.5).

### 5.3 Proposed migration — `supabase/migrations/060_month_end_close.sql`

```sql
-- ============================================================
-- 060_month_end_close.sql
--
-- Month-end close.
--   1. month_closes          one row per tutor + month: the saved SNAPSHOT
--                            of that month's figures (computed in JS by
--                            src/lib/monthClose.js, never in SQL).
--   2. closed_month_changes  append-only change log: every money-relevant
--                            change to a lesson / payment notice that
--                            belongs to a CLOSED month, plus every
--                            close / reopen.
--   3. close_month() / reopen_month() RPCs — the ONLY way to write to
--      month_closes (no client INSERT/UPDATE/DELETE policies on purpose).
--   4. Two AFTER triggers (lessons, payment_cycles) that write the log.
--      They never block or change the original write.
--
-- Does NOT touch: recompute_payment_cycles, handle_lesson_change,
-- handle_lesson_insert, get_payment_summary, any agency_* table.
--
-- Requires migration 059 (students.is_practice) to be live.
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ── 0. Precondition: 059 must be live ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'students'
      AND column_name  = 'is_practice'
  ) THEN
    RAISE EXCEPTION 'Stop: run migration 059 (students.is_practice) before 060.';
  END IF;
END $$;

-- ── 1. month_closes ──────────────────────────────────────────────────────────
CREATE TABLE public.month_closes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id      uuid NOT NULL REFERENCES public.tutors (id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  status        text NOT NULL DEFAULT 'closed'
                CHECK (status IN ('closed', 'reopened')),
  revision      integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  calc_version  integer NOT NULL,
  snapshot      jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  closed_at     timestamptz NOT NULL DEFAULT now(),
  reopened_at   timestamptz,
  reopen_reason text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, month)
);

COMMENT ON TABLE public.month_closes IS
  'Month-end close. One row per tutor + month. snapshot = figures saved at close (built by src/lib/monthClose.js). Written only via close_month()/reopen_month().';
COMMENT ON COLUMN public.month_closes.month IS
  'First day of the month closed (Asia/Singapore calendar month).';
COMMENT ON COLUMN public.month_closes.status IS
  'closed = figures locked, changes are logged. reopened = tutor reopened it; snapshot kept for comparison until it is closed again.';
COMMENT ON COLUMN public.month_closes.revision IS
  '1 on first close, +1 every time the month is closed again after a reopen.';
COMMENT ON COLUMN public.month_closes.calc_version IS
  'CALC_VERSION of src/lib/monthClose.js that built the snapshot.';

-- ── 2. closed_month_changes (append-only log) ────────────────────────────────
CREATE TABLE public.closed_month_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id      uuid NOT NULL REFERENCES public.tutors (id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (EXTRACT(day FROM month) = 1),
  entity_type   text NOT NULL
                CHECK (entity_type IN ('lesson', 'payment_cycle', 'month_close')),
  entity_id     uuid,
  action        text NOT NULL
                CHECK (action IN ('insert', 'update', 'delete', 'closed', 'reopened')),
  student_id    uuid,          -- no FK on purpose: the log must outlive edits
  student_name  text,          -- name at the time of the change
  old_values    jsonb,
  new_values    jsonb,
  amount_before numeric(10, 2),
  amount_after  numeric(10, 2),
  note          text,          -- reopen reason
  changed_by    uuid,          -- auth.uid(); NULL when run from the SQL editor
  changed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX closed_month_changes_lookup_idx
  ON public.closed_month_changes (tutor_id, month, changed_at DESC);

COMMENT ON TABLE public.closed_month_changes IS
  'Append-only log of changes made to a closed month (lessons, payment notices) and of every close/reopen. Written only by triggers and the close/reopen RPCs.';
COMMENT ON COLUMN public.closed_month_changes.amount_before IS
  'lesson: the lesson''s gross fee counted in this month before the change (0 if it was not counted). payment_cycle: amount_due before. month_close: revenue in the previous snapshot.';
COMMENT ON COLUMN public.closed_month_changes.amount_after IS
  'Same meaning as amount_before, after the change.';

-- ── 3. RLS: read-only for the owning tutor; no client writes ─────────────────
ALTER TABLE public.month_closes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closed_month_changes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.month_closes         FROM anon, authenticated;
REVOKE ALL ON public.closed_month_changes FROM anon, authenticated;
GRANT SELECT ON public.month_closes         TO authenticated;
GRANT SELECT ON public.closed_month_changes TO authenticated;

CREATE POLICY "Tutors can view own month closes"
  ON public.month_closes FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

CREATE POLICY "Tutors can view own closed month changes"
  ON public.closed_month_changes FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

-- Deliberately NO INSERT / UPDATE / DELETE policies on either table.
-- All writes go through the SECURITY DEFINER functions below, so a
-- snapshot or a log row cannot be edited or removed from the browser.

-- ── 4. close_month ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.close_month(p_month date, p_snapshot jsonb)
RETURNS public.month_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today_sgt date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_row       public.month_closes;
  v_old       jsonb;
  v_calc      integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF p_month IS NULL OR EXTRACT(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Month must be the first day of a month.';
  END IF;
  IF (p_month + INTERVAL '1 month')::date > v_today_sgt THEN
    RAISE EXCEPTION 'MONTH_NOT_OVER: this month is not over yet (Singapore time).';
  END IF;
  IF p_snapshot IS NULL
     OR jsonb_typeof(p_snapshot) <> 'object'
     OR jsonb_typeof(p_snapshot -> 'totals') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot -> 'calc_version') IS DISTINCT FROM 'number'
     OR (p_snapshot ->> 'month') IS DISTINCT FROM to_char(p_month, 'YYYY-MM') THEN
    RAISE EXCEPTION 'BAD_SNAPSHOT: snapshot is missing or does not match the month.';
  END IF;
  IF octet_length(p_snapshot::text) > 2000000 THEN
    RAISE EXCEPTION 'BAD_SNAPSHOT: snapshot is too large.';
  END IF;
  v_calc := (p_snapshot ->> 'calc_version')::integer;

  SELECT * INTO v_row
  FROM month_closes
  WHERE tutor_id = v_uid AND month = p_month
  FOR UPDATE;

  IF FOUND THEN
    IF v_row.status = 'closed' THEN
      RAISE EXCEPTION 'MONTH_ALREADY_CLOSED: this month is already closed.';
    END IF;
    v_old := v_row.snapshot -> 'totals';
    UPDATE month_closes
    SET status       = 'closed',
        revision     = revision + 1,
        calc_version = v_calc,
        snapshot     = p_snapshot,
        closed_at    = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    BEGIN
      INSERT INTO month_closes (tutor_id, month, status, revision, calc_version, snapshot)
      VALUES (v_uid, p_month, 'closed', 1, v_calc, p_snapshot)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'MONTH_ALREADY_CLOSED: this month is already closed.';
    END;
  END IF;

  INSERT INTO closed_month_changes
    (tutor_id, month, entity_type, entity_id, action,
     old_values, new_values, amount_before, amount_after, changed_by)
  VALUES
    (v_uid, p_month, 'month_close', v_row.id, 'closed',
     v_old, p_snapshot -> 'totals',
     ROUND(COALESCE((v_old ->> 'revenue_cents')::numeric, 0) / 100, 2),
     ROUND(COALESCE((p_snapshot -> 'totals' ->> 'revenue_cents')::numeric, 0) / 100, 2),
     v_uid);

  RETURN v_row;
END;
$$;

-- ── 5. reopen_month ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reopen_month(p_month date, p_reason text)
RETURNS public.month_closes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_row    public.month_closes;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: please say why you are reopening this month.';
  END IF;
  IF char_length(v_reason) > 500 THEN
    v_reason := left(v_reason, 500);
  END IF;

  SELECT * INTO v_row
  FROM month_closes
  WHERE tutor_id = v_uid AND month = p_month
  FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'closed' THEN
    RAISE EXCEPTION 'MONTH_NOT_CLOSED: this month is not closed.';
  END IF;

  UPDATE month_closes
  SET status        = 'reopened',
      reopened_at   = now(),
      reopen_reason = v_reason
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  INSERT INTO closed_month_changes
    (tutor_id, month, entity_type, entity_id, action,
     old_values, amount_before, amount_after, note, changed_by)
  VALUES
    (v_uid, p_month, 'month_close', v_row.id, 'reopened',
     v_row.snapshot -> 'totals',
     ROUND(COALESCE((v_row.snapshot -> 'totals' ->> 'revenue_cents')::numeric, 0) / 100, 2),
     NULL, v_reason, v_uid);

  RETURN v_row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_month(date, jsonb)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_month(date, text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.close_month(date, jsonb)  TO authenticated;
GRANT  EXECUTE ON FUNCTION public.reopen_month(date, text)  TO authenticated;

-- ── 6. Trigger: log lesson changes in a closed month ─────────────────────────
-- Fires only for money-relevant columns. payment_cycle_id re-linking done by
-- recompute_payment_cycles is NOT logged (it is not in the column list).
-- A lesson counts in a month only while is_completed is true; its amount uses
-- the same expression as recompute_payment_cycles.
-- Moving a lesson between months writes one row per closed month affected.
-- Practice students are skipped. The whole body is wrapped so a logging
-- problem can never block the tutor's lesson change.
CREATE OR REPLACE FUNCTION public.log_closed_month_lesson_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tutor      uuid;
  v_lesson     uuid;
  v_action     text := lower(TG_OP);
  v_old_month  date;
  v_new_month  date;
  v_old_amt    numeric(10, 2) := 0;
  v_new_amt    numeric(10, 2) := 0;
  v_old_vals   jsonb;
  v_new_vals   jsonb;
  v_old_sid    uuid;
  v_new_sid    uuid;
  v_old_name   text;
  v_new_name   text;
  v_rate       numeric;
  v_practice   boolean;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.lesson_date      IS NOT DISTINCT FROM OLD.lesson_date
         AND NEW.is_completed     IS NOT DISTINCT FROM OLD.is_completed
         AND NEW.student_id       IS NOT DISTINCT FROM OLD.student_id
         AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
         AND NEW.rate             IS NOT DISTINCT FROM OLD.rate
         AND NEW.rate_type        IS NOT DISTINCT FROM OLD.rate_type THEN
        RETURN NULL;
      END IF;
    END IF;

    -- Old side (UPDATE / DELETE)
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_tutor   := OLD.tutor_id;
      v_lesson  := OLD.id;
      v_old_sid := OLD.student_id;
      v_old_vals := jsonb_build_object(
        'lesson_date', OLD.lesson_date, 'is_completed', OLD.is_completed,
        'student_id', OLD.student_id, 'duration_minutes', OLD.duration_minutes,
        'rate', OLD.rate, 'rate_type', OLD.rate_type);
      IF COALESCE(OLD.is_completed, FALSE) THEN
        SELECT name, hourly_rate, COALESCE(is_practice, FALSE)
        INTO v_old_name, v_rate, v_practice
        FROM students WHERE id = OLD.student_id;
        IF NOT COALESCE(v_practice, FALSE) THEN
          v_old_month := date_trunc('month', OLD.lesson_date)::date;
          v_old_amt := ROUND((CASE
            WHEN OLD.rate_type = 'per_session' THEN COALESCE(OLD.rate, v_rate, 0)
            ELSE (OLD.duration_minutes / 60.0) * COALESCE(OLD.rate, v_rate, 0)
          END)::numeric, 2);
        END IF;
      END IF;
    END IF;

    -- New side (INSERT / UPDATE)
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_tutor   := NEW.tutor_id;
      v_lesson  := NEW.id;
      v_new_sid := NEW.student_id;
      v_new_vals := jsonb_build_object(
        'lesson_date', NEW.lesson_date, 'is_completed', NEW.is_completed,
        'student_id', NEW.student_id, 'duration_minutes', NEW.duration_minutes,
        'rate', NEW.rate, 'rate_type', NEW.rate_type);
      IF COALESCE(NEW.is_completed, FALSE) THEN
        v_rate := NULL; v_practice := NULL;
        SELECT name, hourly_rate, COALESCE(is_practice, FALSE)
        INTO v_new_name, v_rate, v_practice
        FROM students WHERE id = NEW.student_id;
        IF NOT COALESCE(v_practice, FALSE) THEN
          v_new_month := date_trunc('month', NEW.lesson_date)::date;
          v_new_amt := ROUND((CASE
            WHEN NEW.rate_type = 'per_session' THEN COALESCE(NEW.rate, v_rate, 0)
            ELSE (NEW.duration_minutes / 60.0) * COALESCE(NEW.rate, v_rate, 0)
          END)::numeric, 2);
        END IF;
      END IF;
    END IF;

    -- Not counted before and not counted after: nothing to log.
    IF v_old_month IS NULL AND v_new_month IS NULL THEN
      RETURN NULL;
    END IF;

    -- Tutor row gone (account being deleted): do not write log rows.
    IF NOT EXISTS (SELECT 1 FROM tutors WHERE id = v_tutor) THEN
      RETURN NULL;
    END IF;

    IF v_old_month IS NOT NULL AND v_new_month IS NOT NULL
       AND v_old_month = v_new_month THEN
      IF EXISTS (SELECT 1 FROM month_closes
                 WHERE tutor_id = v_tutor AND month = v_old_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_old_month, 'lesson', v_lesson, v_action, v_new_sid, v_new_name,
           v_old_vals, v_new_vals, v_old_amt, v_new_amt, auth.uid());
      END IF;
    ELSE
      IF v_old_month IS NOT NULL AND EXISTS (
           SELECT 1 FROM month_closes
           WHERE tutor_id = v_tutor AND month = v_old_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_old_month, 'lesson', v_lesson, v_action, v_old_sid, v_old_name,
           v_old_vals, v_new_vals, v_old_amt, 0, auth.uid());
      END IF;
      IF v_new_month IS NOT NULL AND EXISTS (
           SELECT 1 FROM month_closes
           WHERE tutor_id = v_tutor AND month = v_new_month AND status = 'closed') THEN
        INSERT INTO closed_month_changes
          (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
           old_values, new_values, amount_before, amount_after, changed_by)
        VALUES
          (v_tutor, v_new_month, 'lesson', v_lesson, v_action, v_new_sid, v_new_name,
           v_old_vals, v_new_vals, 0, v_new_amt, auth.uid());
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_closed_month_lesson_change skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_closed_month_lesson ON public.lessons;
CREATE TRIGGER trg_log_closed_month_lesson
  AFTER INSERT OR DELETE
     OR UPDATE OF lesson_date, is_completed, student_id, duration_minutes, rate, rate_type
  ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.log_closed_month_lesson_change();

-- ── 7. Trigger: log payment-notice changes in a closed month ─────────────────
-- A notice belongs to the month of its period_end (same rule as the recap).
-- Logged: status or amount_due changes on any notice; creating or undoing a
-- MANUAL ("Bill now") notice. NOT logged: automatic notices being deleted and
-- re-created by recompute_payment_cycles (that is routine regrouping; the
-- lesson change that caused it is already logged by the trigger above).
CREATE OR REPLACE FUNCTION public.log_closed_month_cycle_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tutor    uuid;
  v_cycle    uuid;
  v_sid      uuid;
  v_month    date;
  v_before   numeric(10, 2);
  v_after    numeric(10, 2);
  v_old_vals jsonb;
  v_new_vals jsonb;
  v_name     text;
  v_practice boolean;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT NEW.is_manual_closeout THEN RETURN NULL; END IF;
      v_tutor := NEW.tutor_id; v_cycle := NEW.id; v_sid := NEW.student_id;
      v_month := date_trunc('month', NEW.period_end)::date;
      v_before := 0; v_after := NEW.amount_due;
    ELSIF TG_OP = 'DELETE' THEN
      IF NOT OLD.is_manual_closeout THEN RETURN NULL; END IF;
      v_tutor := OLD.tutor_id; v_cycle := OLD.id; v_sid := OLD.student_id;
      v_month := date_trunc('month', OLD.period_end)::date;
      v_before := OLD.amount_due; v_after := 0;
    ELSE
      IF NEW.status IS NOT DISTINCT FROM OLD.status
         AND NEW.amount_due IS NOT DISTINCT FROM OLD.amount_due THEN
        RETURN NULL;
      END IF;
      v_tutor := OLD.tutor_id; v_cycle := OLD.id; v_sid := OLD.student_id;
      v_month := date_trunc('month', OLD.period_end)::date;
      v_before := OLD.amount_due; v_after := NEW.amount_due;
    END IF;

    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_old_vals := jsonb_build_object(
        'status', OLD.status, 'amount_due', OLD.amount_due,
        'paid_at', OLD.paid_at, 'waived_at', OLD.waived_at,
        'period_start', OLD.period_start, 'period_end', OLD.period_end,
        'is_manual_closeout', OLD.is_manual_closeout);
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_new_vals := jsonb_build_object(
        'status', NEW.status, 'amount_due', NEW.amount_due,
        'paid_at', NEW.paid_at, 'waived_at', NEW.waived_at,
        'period_start', NEW.period_start, 'period_end', NEW.period_end,
        'is_manual_closeout', NEW.is_manual_closeout);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM month_closes
                   WHERE tutor_id = v_tutor AND month = v_month AND status = 'closed') THEN
      RETURN NULL;
    END IF;

    SELECT name, COALESCE(is_practice, FALSE) INTO v_name, v_practice
    FROM students WHERE id = v_sid;
    IF COALESCE(v_practice, FALSE) THEN
      RETURN NULL;
    END IF;

    INSERT INTO closed_month_changes
      (tutor_id, month, entity_type, entity_id, action, student_id, student_name,
       old_values, new_values, amount_before, amount_after, changed_by)
    VALUES
      (v_tutor, v_month, 'payment_cycle', v_cycle, lower(TG_OP), v_sid, v_name,
       v_old_vals, v_new_vals, v_before, v_after, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log_closed_month_cycle_change skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_closed_month_cycle ON public.payment_cycles;
CREATE TRIGGER trg_log_closed_month_cycle
  AFTER INSERT OR DELETE OR UPDATE OF status, amount_due
  ON public.payment_cycles
  FOR EACH ROW EXECUTE FUNCTION public.log_closed_month_cycle_change();

REVOKE EXECUTE ON FUNCTION public.log_closed_month_lesson_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_closed_month_cycle_change()  FROM PUBLIC, anon, authenticated;

COMMIT;
```

### 5.4 What was dry-run, and what was not
The SQL above was applied to a scratch Postgres 16 with stand-in `tutors / students / lessons / payment_cycles` tables, `anon` / `authenticated` roles and a stub `auth.uid()`. Confirmed there: the browser role is refused a direct insert into `month_closes` and a direct update / delete on `closed_month_changes` (all write privileges are revoked on both); `close_month` rejects a month that is not over, a mismatched snapshot and a second close; duration change, date move out and back, undo-done, insert and delete of a completed lesson each write the expected `amount_before → amount_after`; notes-only and `payment_cycle_id`-only updates, uncompleted lessons, practice students, automatic notice insert / delete and edits while reopened write nothing; marking paid writes one row; another tutor sees zero rows and cannot reopen; `anon` cannot read or call; deleting a tutor cascades cleanly.
**Not tested**: the live database (Postgres 17.6), the real `handle_lesson_change` / `recompute_payment_cycles` running alongside, and real Supabase grants. The verification queries and acceptance tests below cover those.

### 5.5 Verification queries (run after the migration; all read-only)

```sql
-- V1. Tables exist with RLS on. Expect 2 rows, relrowsecurity = true.
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('month_closes', 'closed_month_changes');

-- V2. Policies. Expect exactly 2 rows, both cmd = SELECT, roles = {authenticated}.
SELECT tablename, policyname, cmd, roles, qual FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('month_closes', 'closed_month_changes');

-- V3. Table grants. Expect ONLY authenticated:SELECT for each table (no anon rows,
--     no INSERT/UPDATE/DELETE for authenticated).
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN ('month_closes', 'closed_month_changes')
  AND grantee IN ('anon', 'authenticated') ORDER BY 1, 2, 3;

-- V4. Function security. Expect 4 rows, prosecdef = true, proconfig contains search_path.
SELECT proname, prosecdef, proconfig FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('close_month', 'reopen_month',
                  'log_closed_month_lesson_change', 'log_closed_month_cycle_change');

-- V5. Who may call the RPCs. Expect anon = false, authenticated = true for both.
SELECT f, has_function_privilege('anon', f, 'execute') AS anon,
          has_function_privilege('authenticated', f, 'execute') AS authenticated
FROM (VALUES ('public.close_month(date, jsonb)'), ('public.reopen_month(date, text)')) v(f);

-- V6. Triggers. Expect the 3 old lesson triggers (on_lesson_insert, on_lesson_update,
--     on_lesson_delete) PLUS trg_log_closed_month_lesson, and trg_log_closed_month_cycle.
SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
  AND c.relname IN ('lessons', 'payment_cycles') ORDER BY 1, 2;

-- V7. Nothing written yet. Expect 0 and 0.
SELECT (SELECT count(*) FROM month_closes) AS closes,
       (SELECT count(*) FROM closed_month_changes) AS log_rows;
```

After V1–V7 pass, do one normal thing in the live app (mark any lesson done, then undo) to confirm lesson saving still works with the new trigger in place **before** any frontend is built.

### 5.6 Rollback (only if something goes wrong; Hanyong runs it manually)

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_log_closed_month_lesson ON public.lessons;
DROP TRIGGER IF EXISTS trg_log_closed_month_cycle  ON public.payment_cycles;
DROP FUNCTION IF EXISTS public.log_closed_month_lesson_change();
DROP FUNCTION IF EXISTS public.log_closed_month_cycle_change();
DROP FUNCTION IF EXISTS public.close_month(date, jsonb);
DROP FUNCTION IF EXISTS public.reopen_month(date, text);
DROP TABLE IF EXISTS public.closed_month_changes;
DROP TABLE IF EXISTS public.month_closes;
COMMIT;
```

### 5.7 Snapshot shape (`month_closes.snapshot`)
All money is in **whole cents** (integers). Built by `buildMonthSnapshot` (6.2).

```json
{
  "month": "2026-10",
  "calc_version": 1,
  "taken_at": "2026-11-16T21:05:12+08:00",
  "tz": "Asia/Singapore",
  "totals": {
    "lessons": 31,
    "gross_cents": 731000,
    "agency_cents": 66000,
    "mine_cents": 665000,
    "commission_b_cents": 0,
    "revenue_cents": 665000,
    "notices_paid_cents": 617000,
    "notices_pending_cents": 48000,
    "notices_waived_cents": 0,
    "cash_collected_cents": 590000,
    "cash_written_off_cents": 0
  },
  "agencies": [
    { "name": "Agency X", "payee_id": "uuid-or-null", "share_percent": 80, "cents": 14400,
      "lines": [ { "kind": "share", "student": "Student A", "collected_by": "agency", "billed_cents": 72000, "cents": 14400 } ] }
  ],
  "students": [
    { "student_id": "uuid", "name": "Student A", "archived": false, "deleted": false,
      "lessons": 4, "gross_cents": 72000, "placement_cents": 0, "agency_share_cents": 14400,
      "commission_b_cents": 0, "mine_cents": 57600,
      "payee_id": "uuid-or-null", "share_percent": 80, "fee_collected_by": "payee",
      "hourly_rate": 120, "placement_fee_amount": null, "placement_fee_start": null }
  ],
  "lessons": [
    { "id": "uuid", "student_id": "uuid", "date": "2026-10-05", "minutes": 90,
      "rate": 120, "rate_type": "hourly", "amount_cents": 18000 }
  ],
  "statements": [
    { "payee_id": "uuid", "name": "Agency X", "status": "sent", "claimed_total_cents": 57600, "sent_at": "2026-11-03T02:10:00Z" }
  ],
  "carried": [
    { "type": "unpaid_notice", "ref_id": "cycle-uuid", "student_id": "uuid", "label": "Parent A still owes $480", "amount_cents": 48000, "origin_month": "2026-10" }
  ],
  "counts": { "students_loaded": 28, "lessons_loaded": 231, "cycles_loaded": 93 }
}
```

`revenue_cents = mine_cents + commission_b_cents` (same definition as `YearEndReport.jsx` `computeMonthlyBreakdowns`: set-up B commission is revenue first, then a separate deduction).

---
## 6. Logic & edge cases

### 6.1 Months and time zones (Asia/Singapore)
- A **month** is a Singapore calendar month, written `YYYY-MM`. Stored as its first day (`date`).
- `lessons.lesson_date`, `payment_cycles.period_start/period_end` are plain dates: month = first 7 characters. No conversion.
- `paid_at`, `waived_at`, `closed_at`, `changed_at` are timestamps stored in UTC. Their month/day must be taken in Singapore time. New helpers in `src/lib/monthClose.js` (Singapore is a fixed UTC+8, no daylight saving):

```js
const SGT_MS = 8 * 60 * 60 * 1000;
export const sgtDateKey  = (ts) => new Date(new Date(ts).getTime() + SGT_MS).toISOString().slice(0, 10);
export const sgtMonthKey = (ts) => sgtDateKey(ts).slice(0, 7);
export const sgtTodayKey = () => sgtDateKey(Date.now());
export const sgtStamp    = () => new Date(Date.now() + SGT_MS).toISOString().slice(0, 19) + "+08:00";
```
  (This is the one place `toISOString()` is correct: the time was shifted by +8h first, and only the text is used. Do not copy this pattern into Google Calendar code.)
- A month can be closed only when it is over: `sgtTodayKey() >= first day of next month`. The server repeats this check with `(now() AT TIME ZONE 'Asia/Singapore')::date`. A tutor closing at 00:30 on 1 Nov Singapore time (16:30 UTC on 31 Oct) is allowed; the UTC date is never used.
- Never use `new Date().getMonth()` / device time to decide which month is closable or which month a payment belongs to.
- **Existing bug to fix in Phase 5 (year-end report, PR #4):** it buckets payments with `c.paid_at.startsWith("2026-10")` on the UTC string, so a payment marked at 1 Nov 07:30 Singapore time (31 Oct 23:30 UTC) lands in October. Use `sgtMonthKey`.

### 6.2 Building the snapshot (reproducible)
New pure module `src/lib/monthClose.js`. **No Supabase calls, no `new Date()` / `Date.now()` inside `buildMonthSnapshot`** — everything comes in as arguments, so the same inputs always give the same snapshot.

```js
export const CALC_VERSION = 1; // bump whenever buildEarningsBreakdown / lessonAmount / this file changes a figure
export function buildMonthSnapshot({ monthStr, students, payees, lessons, cycles, statements, carried, takenAt })
```

Steps:
1. `real = students.filter(s => !s.is_practice)` (keep archived and deleted). Drop lessons and cycles whose `student_id` is not in `real`.
2. `completed = lessons.filter(l => l.is_completed && l.lesson_date < nextMonthStart)`.
3. `bd = buildEarningsBreakdown({ monthDate: new Date(y, m - 1, 1), students: real, payees, lessons: completed })` — the existing function in `collectedBreakdown.js`, **unchanged**. `gross = bd.total`, `mine = bd.mine`, `agency = bd.agencyTotal`.
4. `commissionB` = sum of `line.amount` over `bd.agencies[].lines` where `line.collectedBy === "me"` (identical to `computeMonthlyBreakdowns` in `YearEndReport.jsx`). `revenue = mine + commissionB`.
5. Per-student lines: call `buildEarningsBreakdown` again **once per student** with `students: [thatStudent]` and that student's completed lessons. From each result take gross / agency / mine; split agency into `placement_cents` (lines with `kind === "placement"`) and `agency_share_cents` (`kind === "share"`). (The function rounds per student, so per-student results add up exactly to the combined result.) Only students with at least one completed lesson in the month get a line.
6. Lesson lines: every completed lesson dated in the month: `amount_cents = Math.round(lessonAmount(l, student) * 100)`.
7. Notices (cycles with `period_end` in the month): `notices_paid` = status `paid`; `notices_pending` = `pending` or `overdue`; `notices_waived` = `waived`. These reproduce the recap card's Collected / Pending for a past month.
8. Cash: `cash_collected` = paid cycles with `sgtMonthKey(paid_at) === monthStr`; `cash_written_off` = waived cycles with `sgtMonthKey(waived_at) === monthStr`. (Any `period_end`.)
9. Convert every dollar figure to cents with `Math.round(x * 100)`.
10. Statements: one entry per agency in `bd.agencies` that has a `payeeId`: status `none` / `sent` / `reimbursed` from `payee_statements` for that payee + month.
11. `carried`, `taken_at`, `counts` passed through.

**Self-checks before saving (all must hold, else do not call `close_month`, show the `BAD_SNAPSHOT` message and `console.error` the details):**
- `mine_cents + agency_cents === gross_cents`
- sum of `students[].gross_cents === gross_cents`; sum of `students[].mine_cents === mine_cents`
- sum of `lessons[].amount_cents === gross_cents` (the breakdown rounds each lesson to cents the same way); `lessons.length === totals.lessons`
- every number is a finite integer

**After saving:** re-read the row and check `snapshot.totals` equals what was sent. If not, show the generic error (the month is closed with whatever was stored; tell the tutor to reopen).

Why this is reproducible: fixed inputs → pure function → integer cents; the snapshot carries its own lesson lines, per-student settings and `calc_version`, so anyone can re-add it up later and see exactly which lesson or setting differs from today.

`CALC_VERSION` rule: if a future PR changes how any figure is worked out, bump it. A snapshot with an older `calc_version` is never compared number-by-number with live figures; it shows "Closed with an older calculation — reopen to refresh" instead of a false "Changed after close".

### 6.3 Loading data for the close page
All queries filter `tutor_id = user.id`. **Page every list with `.range()` in blocks of 900 until a short page comes back** (same helper pattern as `fetchAllLessons` in `YearEndReport.jsx`). Order by a stable key (`lesson_date, created_at, id` / `created_at, id`) so pages do not overlap.

1. `students` — all rows (no archived / deleted filter): `id, name, hourly_rate, payment_mode, payment_cycle_count, payment_custom_day, payee_id, fee_collected_by, placement_fee_agency, placement_fee_amount, placement_fee_start, archived, deleted_at, is_practice`.
2. `payees` — `id, name, share_percent, archived`.
3. `lessons` with `lesson_date < nextMonthStart` — completed **and** not completed: `id, student_id, lesson_date, lesson_time, is_completed, duration_minutes, rate, rate_type, payment_cycle_id, student_name_snapshot, created_at`. All history is needed so placement fees drain correctly.
4. Student ids that have any lesson dated today or later (for the "no upcoming lessons" tag): `lessons` select `student_id` where `lesson_date >= sgtTodayKey()`.
5. `payment_cycles` — all: `id, student_id, period_start, period_end, amount_due, status, paid_at, waived_at, waived_from_status, is_manual_closeout`.
6. `payee_statements` — all rows for the tutor (`payee_id, month, status, claimed_total, sent_at`); small table.
7. `month_closes` — all rows for the tutor (at most 12 a year).
8. `closed_month_changes` for the month, newest first, first 200 rows.

**Backfill before computing** (same job the Dashboard and Payments pages already do — `Dashboard.jsx` ~lines 296–334): for each non-deleted, non-practice student in `monthly` / `custom_date` mode with a completed lesson that has no `payment_cycle_id` and is dated before the current Singapore month, call `supabase.rpc("recompute_payment_cycles", { p_student_id, p_tutor_id })`, then reload lessons and cycles once. Without this, monthly students show as "not billed yet" just because nobody opened the Dashboard.

If any query fails: show the load error state. Never compute from partial data.

### 6.4 Checklist rules
"Month end" = last day of the month being closed. Practice students are excluded from every rule. Archived and deleted students are included. An item belongs to the checklist if it is **still open today** and dated **on or before month end** (so anything left over from earlier months shows up too — nothing can hide by being old).

| Type (`type` in `carried[]`) | Open item = | `ref_id` | Resolved when |
|---|---|---|---|
| `undone_lesson` | lesson with `is_completed = false` and `lesson_date <= monthEnd` | lesson id | marked done or deleted |
| `zero_rate_lesson` | completed lesson dated **in the month** with `lessonAmount(...) === 0` | lesson id | rate fixed |
| `unpaid_notice` | cycle with status `pending` / `overdue` and `period_end <= monthEnd` | cycle id | paid or written off |
| `unbilled_student` | student with ≥ 1 completed lesson, `payment_cycle_id IS NULL`, `lesson_date <= monthEnd`. One item per student; amount = sum of those lessons. Tag "no upcoming lessons" when the student has no lesson dated today or later (this is how stalled cycles surface; the Dashboard's 21-day rule is not needed here). | student id | billed (`create_manual_closeout_cycle`) or the cycle completes naturally |
| `statement` | agency in this month's breakdown with a `payeeId` and **no** `payee_statements` row for the month; **plus** any `statement` entry in an earlier closed month's `snapshot.carried` whose payee + `origin_month` still has no `payee_statements` row | payee id (with `origin_month`) | statement marked as sent (`sent` or `reimbursed` both count as done) |

- `origin_month` of an item = month of its `lesson_date` / `period_end` / (for `unbilled_student`) its earliest unbilled lesson / the statement month.
- "Carried from September" chip: `origin_month` is earlier than the month on screen **and** some earlier closed month's `snapshot.carried` contains the same `type` + `ref_id`. Otherwise "From September".
- Info line "Written off in October: $X" uses `cash_written_off`.
- "Bill now" calls the existing RPC, which bills **all** of the student's unbilled completed lessons (including later ones) into one manual notice — hence the confirm text in 4.5.
- "Mark as paid" / "Write off" use exactly the updates in `Payments.jsx` `handleMarkPaid` / `handleWaiveCycle` (status, `paid_at` / `waived_at` = `new Date().toISOString()`, `waived_from_status`, always `.eq("tutor_id", user.id)`).
- A mid-cycle student with upcoming lessons is expected to be **carried** — the cycle will finish on its own. That is the normal answer, not a problem.

### 6.5 Carry forward
- While a month is open, carried items are a **draft kept in the browser**: React state mirrored to `localStorage` key `cnp_close_draft_<tutorId>_<YYYY-MM>` as `[{ type, ref_id }]` (try/catch around every access; if storage is unavailable the draft simply lives in memory).
- On every load, drop draft entries whose item no longer exists (resolved, or a pending notice got a new id after a regroup). An item that reappears with a new id is open again and must be carried again — safe by design.
- At close, the resolved-as-carried items are written into `snapshot.carried` with label, amount and origin month. That server copy is the record.
- Close is blocked (button disabled, and re-checked on tap) while any open item is neither resolved nor carried.
- After close, the draft key is removed.
- No server-side check of the checklist: the rules live in JS only (one source of truth). The server guarantees who / when / which month; the browser guarantees the checklist.

### 6.6 Snapshot vs live ("Changed after close")
For a closed month, build a **live** snapshot with the same `buildMonthSnapshot` and current data, then compare these `totals` keys exactly (integer cents):

`lessons, gross_cents, agency_cents, revenue_cents, commission_b_cents, cash_collected_cents, cash_written_off_cents`

- `notices_paid_cents` / `notices_pending_cents` are **not** compared: they are meant to move when a carried notice is paid later (6.10).
- **Changed after close** = any compared key differs. This catches direct edits *and* indirect ones the log cannot see: a student's default rate, a payee's share %, "fee collected by", a placement fee, or a backdated lesson in an earlier month that shifts how a placement fee drains.
- If `snapshot.calc_version !== CALC_VERSION`: do not compare; show the "older calculation" notice (counts as not ready in 6.8).
- Log rows with no difference in totals → "Edited after close, no net change" (grey, does not block readiness).

### 6.7 Change log — server-side (recommended) vs client-side
**Recommendation: log in the database with triggers; warn in the browser.**

Why triggers:
- Lessons and notices are written from **about 30 places in 9 files** (list in 6.12) plus two RPCs and `recompute_payment_cycles`. A client-side log needs every one of them — and every future one — to remember to write it.
- Deploy previews and installed PWAs with an old cached bundle all write to the **same live database**. Old code would skip a client-side log; a trigger cannot be skipped.
- The log is append-only for the browser (no write policies), so it is a trustworthy record.
- The trigger sees the true old and new values in the same transaction.

What the browser still does: the **warning** (a trigger cannot ask a question). If a screen forgets the warning, the change is still logged and still flagged.

Cost / trade-off: triggers add code on the hot path of every lesson save. Mitigation: they fire only on money columns, exit early when the month is not closed, and are wrapped so an error becomes a warning in the Postgres log instead of blocking the save (open question 2).

What is logged (month must have `status = 'closed'`; practice students skipped):

| Event | Logged? | `amount_before → amount_after` |
|---|---|---|
| Completed lesson added / deleted | yes | `0 → fee` / `fee → 0` |
| Lesson marked done / undone | yes | `0 → fee` / `fee → 0` |
| Completed lesson: duration, rate, rate type, student changed | yes | old fee → new fee |
| Completed lesson moved to another month | one row per closed month | old month `fee → 0`; new month `0 → fee` |
| Lesson notes, topics, calendar id, `payment_cycle_id` relink | no | |
| Lesson that is not done before or after | no | |
| Notice marked paid, written off, write-off undone, `amount_due` changed | yes | `amount_due` before → after (status in `old_values` / `new_values`) |
| Manual ("Bill now") notice created / undone | yes | `0 → amount` / `amount → 0` |
| Automatic notices deleted and re-created by `recompute_payment_cycles` | **no** — routine regrouping; the lesson change that caused it is logged | |
| Month closed / reopened | yes (by the RPCs) | revenue in old snapshot → new snapshot; reopen reason in `note` |
| Student / payee settings changed | no (v1) — caught by 6.6 | |

A notice belongs to the month of its `period_end` (same rule as the recap card), using the value before the change.

Wording for the "What changed" list (`entity_type` / `action` → text):
- lesson insert → "lesson on {date} added"; delete → "lesson on {date} deleted"; update with `is_completed` false→true → "lesson on {date} marked done"; true→false → "…marked not done"; date changed → "lesson moved from {old date} to {new date}"; otherwise → "lesson on {date} edited". Then " · $120 → $160".
- payment_cycle update to `paid` → "paid ${amount}" (goes in the Since close strip, not the amber panel); to `waived` → "wrote off ${amount}"; from `waived` back → "undid write-off of ${amount}"; amount change → "notice changed $X → $Y"; insert → "billed ${amount} (Bill now)"; delete → "undid a manual notice of ${amount}".
- month_close closed (revision > 1) → "closed again · revenue $X → $Y"; reopened → "reopened — '{note}'".
- Name shown: `student_name` from the log row. Time shown in Singapore time.

### 6.8 Year-end report — exactly how snapshots are used
(Phase 5; needs PR #4 merged. File `src/pages/YearEndReport.jsx`.)

1. **Load** additionally: `month_closes` for the tutor where `month` is in the year; `closed_month_changes` for those months (`month, entity_type, action`), paged.
2. **Practice**: add `is_practice` to the students select; drop practice students, their lessons and their cycles right after loading (if the 059 work already did this, keep it).
3. **Singapore time**: replace every `paid_at` / `waived_at` string comparison with `sgtMonthKey(...)` / `sgtDateKey(...)`. Widen the cycles query lower bound by one day (`${year - 1}-12-31`) so a payment made between 00:00 and 08:00 on 1 Jan Singapore time is not missed, and page that query with `.range()`.
4. **Placement fee history**: if any student has `placement_fee_amount > 0` and no `placement_fee_start`, load lessons from `2000-01-01` instead of 1 Jan (today such a student's earlier lessons are not loaded, so the fee drains wrongly). Also add `lesson_time` to the lessons select.
5. **For each of the 12 months** compute `live = buildMonthSnapshot(...)` (live data) and decide the row:

| Month state | Condition | Row figures | Marker |
|---|---|---|---|
| Closed | `month_closes.status = 'closed'`, same `calc_version`, no difference (6.6) | **snapshot** | 🔒 |
| Closed, changed | closed, and 6.6 finds a difference | **snapshot** (what was signed off) | 🔒 + amber "Changed after close" (+ difference in revenue, e.g. "+$120 live") |
| Closed, old calculation | closed, `calc_version` differs | snapshot | 🔒 + amber "Older calculation — review" |
| Reopened | status `reopened` | live | grey "Reopened" |
| Open | over, has activity, no close row | live | none |
| Nothing to close | over, and live `lessons = 0`, `cash_collected = 0`, `cash_written_off = 0`, no notices with `period_end` in the month | live (all dashes) | none |
| Not over yet | month not finished in Singapore time | live | grey "In progress" |

   Row columns from a snapshot: Lessons = `lessons`; Gross fees = `gross_cents`; Agency's share = `agency_cents`; Your revenue = `revenue_cents`; Collected = `cash_collected_cents`; Written off = `cash_written_off_cents` (÷ 100).
6. **Totals and headline**: every annual figure that the page shows from months (Revenue, Commission, Lessons, Gross, Agency share, Collected, Written off, the 2-line statement, the reconciliation lines) = **sum of the 12 rows as displayed**. So closed months contribute their snapshot, open months their live figure, and the table always foots.
7. When any month is "Closed, changed": show the amber banner (4.8) and, under the Revenue tile, "Live records differ by +$120". The tutor fixes it by reopening and closing that month again (then the snapshot equals live).
8. **Ready** month = "Closed" (unchanged) or "Nothing to close". Readiness card counts ready months out of 12 (or out of finished months while the year is still running). "Ready to share" needs the year to be over **and** 12 of 12 ready.
9. **Per-student record cards and "Outstanding at year end"**: stay live in v1 (unchanged code). When any month is "Closed, changed", show a one-line note above the cards: "Record cards show live records and may differ from closed months until you review them."
10. Copy summary (4.8) uses the same displayed figures and the readiness status line.

### 6.9 Order of closing
- Any finished month may be closed in any order. If an earlier month in the last 12 has activity and is not closed, show a grey hint: "September isn't closed yet. Closing oldest first keeps carried items tidy." Not blocking.
- Reopening an early month while later months are closed is allowed. If the fix shifts later months (placement fee drain), 6.6 flags them.

### 6.10 Money that arrives after close (Pending in a closed month)
Three different ideas, kept separate:

| Figure | Basis | After October is closed and Parent A pays $480 on 12 Nov |
|---|---|---|
| **Earned** (lessons, total billed, take-home, agencies, revenue) | lessons taught in the month | **No change.** |
| **Collected / Pending tiles** | status of notices whose `period_end` is in October | Snapshot keeps "Collected $6,170 · Pending, carried $480" (as at close). The close page adds "Since close: Parent A paid $480 on 12 Nov. Still outstanding: $0". The Dashboard recap card for October shows the snapshot too ("Pending at close"). |
| **Cash received** (year-end "Collected" column) | `paid_at` in Singapore time | Counts in **November**. October's cash figure does not move, so no "Changed after close". |

- Paying is logged (so there is a record) but is **not** a "Changed after close".
- Writing off a carried October notice in November: earned unchanged; "Written off" counts in November (`waived_at`), matching the year-end spec's rule that bad debts are dated by write-off date.
- Undoing a write-off that was made inside a closed month changes that month's Written off figure → flagged by 6.6. Correct: a signed-off figure really changed.
- "Still outstanding from October now" = live pending + overdue notices with `period_end` in the month.

### 6.11 Backdated lessons and `recompute_payment_cycles` (migration 058 behaviour)
Adding a completed lesson dated in closed October:
1. The browser warns (4.7).
2. Insert → existing `on_lesson_insert` runs `recompute_payment_cycles` → for a monthly student whose October notice is already paid / written off, **058 creates a new pending notice** (`period_start` 1 Oct, `period_end` 31 Oct) for just that lesson. For an "every N lessons" student the lesson joins the unbilled pool and pending notices are regrouped; paid / waived notices are never touched.
3. `trg_log_closed_month_lesson` logs `0 → fee` for October.
4. The new automatic notice is **not** logged separately (it is a consequence). It is an open `unpaid_notice` with `period_end` in October, so it appears in the **current open month's checklist** ("From October") and in October's "Still outstanding now". It cannot be missed.
5. October shows "Changed after close" (lessons +1, gross + fee) until reopened and closed again.

Deleting a completed lesson whose notice is already paid: the paid notice keeps its amount (existing behaviour). The log shows `fee → 0`; October is flagged. The tutor settles any refund with the parent outside the app.

Regrouping can give a carried pending notice a **new id**. Harmless after close (the snapshot keeps label and amount); before close the item simply needs carrying again (6.5).

The backfill in 6.3 may create automatic notices in a closed month (e.g. step 2 above for a monthly student). That is expected and not logged as a notice change.

### 6.12 Money rules recap
- **Agency set-up A** (`fee_collected_by = 'payee'`): agency keeps `100 − share_percent`; tutor revenue = share. **Set-up B** (`'me'`): tutor revenue = full fee, agency cut reported as `commission_b`. All of this comes from `buildEarningsBreakdown`; nothing is re-derived.
- **Placement fees** drain from the student's earliest lessons on/after `placement_fee_start`; needs full lesson history (6.3).
- **Share % used**: the payee's current `share_percent`, same as the recap card (open question 4).
- **Archived / deleted students**: included everywhere (students are loaded with no filter). Note `Statements.jsx` hides deleted students, so a statement can show less than the recap for a deleted agency student — existing behaviour, not changed here.
- **Practice students**: excluded from snapshot, checklist, comparison, log and warnings.
- **Waived**: not Collected, not Pending; counted in Written off by `waived_at`.
- **Overdue**: treated as unpaid everywhere (`status IN ('pending','overdue')`).
- **Lessons taught**: counts **completed** lessons only. The Dashboard recap card counts every past lesson in the month, done or not (`monthLessons.length`), so the two can differ by the number of not-done lessons. Once the checklist's "not marked done" items are resolved they agree (open question 6).
- **`agency_placements` platform**: no records; ignored (the year-end report's existing notice stays).

### 6.13 Concurrency, idempotency, row limits
- **Double tap / two devices**: `close_month` locks the row and the table has `UNIQUE (tutor_id, month)`; the second call gets `MONTH_ALREADY_CLOSED`, which the page treats as success.
- **Stale page**: on tap Close, reload everything, rebuild checklist and snapshot, and abort with "Something changed since you opened this page. Please check the list again." if a new unresolved item appeared.
- **Row limits**: every list is paged (6.3). The snapshot is one JSON value (a busy month ≈ 80 lessons ≈ 15 KB; the RPC refuses anything over 2 MB).
- **Closed-months cache** (for warnings): loaded once per page visit; cleared after close / reopen. A tab opened before a close on another device may miss one warning — the trigger still logs.
- **Where warnings go** (found with `git grep` on `e260e76`; line numbers are approximate — re-grep before editing):
  - Lessons: `Lessons.jsx` save edit (~949) and add (~1028), `handleToggleComplete` (~1122), `confirmDelete` (~1150); `Calendar.jsx` deletes (~318, ~330), `handleMarkDone` (~343); `Dashboard.jsx` `handleMarkDone` (~872), `handleUndoDone` (~909), `handleMarkOverdueLessonDone` (~1134), `handleDeleteOverdueLesson` (~1156); `Settings.jsx` bulk rate-type change (~333, ~341); `ScheduleLessonsModal.jsx` replace-delete (~292) only when a deleted lesson is completed.
  - Notices: `Payments.jsx` `handleMarkPaid` (~349), `handleUndoCycle` (~394), `handleWaiveCycle` (~419), `handleUndoWaive` (~446); `Dashboard.jsx` `handleCollectPayment` (~976), `handleWaiveCycle` (~1005), `handleBillNowMidCycle` (~1026), `handleBillNowStalled` (~1053), `handleWriteOffStalled` (~1065); `Calendar.jsx` `handleMarkPaid` (~357); `SettlementBoard.jsx` `markPayerPaid` (~172); `Students.jsx` bill now / write off (~812–870); `StudentProfile.jsx` bill now / write off / undo (~99–128, ~366, ~386); and the new close page's own buttons.
  - Not needed: inserts of future, not-done lessons (`BookingRequests.jsx`, `Onboarding.jsx`, `ScheduleLessonsModal.jsx` inserts), notes-only updates, archive / delete student.
- **Which months a change touches**: lesson → month of old `lesson_date` and month of new `lesson_date`, only if the lesson is done before or after, and the student is not practice. Notice → month of `period_end`. Bill now → month of the student's latest unbilled completed lesson. Bulk actions → all months of all affected rows, one confirm.

---
## 7. Security / RLS review checklist

- [ ] RLS enabled on `month_closes` and `closed_month_changes` (V1).
- [ ] Each table has exactly one policy: `SELECT` for `authenticated` with `tutor_id = (SELECT auth.uid())` (V2). No policy references another table → no circular policy risk.
- [ ] **Deliberate exception to the "four policies per table" habit:** there are no INSERT / UPDATE / DELETE policies and the table privileges are revoked, because the browser must never write these tables directly. All writes go through `close_month` / `reopen_month` and the two triggers (all `SECURITY DEFINER`). The frontend must **never** call `.from("month_closes").insert/update/delete` or `.from("closed_month_changes").insert/...` — that would 403. (Open question 3.)
- [ ] `anon` has no table privileges and cannot execute either RPC (V3, V5). Nothing here is reachable from `/pay/:token` or `/book/:token`.
- [ ] Both RPCs take the tutor from `auth.uid()` only — there is no tutor-id parameter to spoof — and raise "Not signed in." when it is null.
- [ ] All four functions: `SECURITY DEFINER`, `SET search_path = public, pg_temp` (V4), same hardening pattern as migrations 043 / 046.
- [ ] Trigger functions: execute revoked from `PUBLIC`, `anon`, `authenticated`.
- [ ] Triggers only read `students`, `tutors`, `month_closes` and insert into the log; they never modify `lessons` or `payment_cycles`, so they cannot loop with `handle_lesson_change` / `recompute_payment_cycles`.
- [ ] A trigger error cannot block a save (inner `EXCEPTION WHEN OTHERS` → warning). Check the Postgres logs for "log_closed_month" warnings after Phase 4 testing.
- [ ] Agency-owner read policies (migration 037) are **not** extended to the new tables: agencies cannot see a tutor's closes or log.
- [ ] Domain isolation: no change to practitioner screens, `AgencyDashboard.jsx`, `agency_*` tables, `get_payment_summary`, `PaymentSummary.jsx`, `BookingPage.jsx`. Practitioners are turned away at the page level; their lessons would still be logged if they ever had a closed month, which they cannot create from the UI.
- [ ] The snapshot contains student names and fees. It is tutor-private (SELECT policy) and is deleted with the tutor (`ON DELETE CASCADE`).
- [ ] `closed_month_changes.student_id` has no FK on purpose; students are soft-deleted only, so there is nothing to orphan.
- [ ] `localStorage` (carry draft, nudge dismissal) is wrapped in try/catch and holds only ids, never amounts or names.
- [ ] Deploy previews hit the live database: closing a month on a preview **really closes it**. Tests below say when to reopen afterwards.

---

## 8. Acceptance tests

Use the Netlify deploy preview of each phase, signed in as Hanyong. "Test month" below = a finished month with lessons (e.g. October 2026). Because previews use live data, the script ends by leaving months in the state you actually want.

### After migration 060 (before any frontend)
1. Run V1–V7 (5.5). All match the expected results.
2. In the live app: mark a lesson done, undo it, edit a lesson's duration and put it back. Everything behaves as before. `SELECT count(*) FROM closed_month_changes;` → still 0 (no month is closed).

### Phase 2 — read-only page
3. Open Payments → tap **Month-end close**. Page opens on the oldest unclosed month with activity.
4. Open the Dashboard recap card on the same month in another tab. **My take-home, Agencies earn, each agency amount, Total billed, Collected and Pending match** the close page. (Lessons taught may differ only by lessons not marked done.)
5. ← → change month; → is disabled at the current month; the current month shows "You can close November from 1 Dec".
6. Type `/month-close?month=2031-01` and `/month-close?month=banana` → falls back to the default month, no crash.
7. A month before your first lesson → "Nothing happened in …" state, no close button.
8. Turn on airplane mode and reload → load error with **Try again**; turn it off, tap Try again → loads.
9. Checklist shows the right open items: compare unpaid notices with the Payments page; unbilled students with the Dashboard "Not yet billed" rows.
10. Sign in as a practitioner test account → "Month-end close is for tutors only."
11. Data check (Claude runs, read-only) — gross billed for the month must equal `Total billed` on the page:
```sql
SELECT count(*) AS lessons,
       round(sum(CASE WHEN l.rate_type = 'per_session' THEN COALESCE(l.rate, s.hourly_rate, 0)
                      ELSE (l.duration_minutes / 60.0) * COALESCE(l.rate, s.hourly_rate, 0) END), 2) AS gross
FROM lessons l JOIN students s ON s.id = l.student_id
WHERE l.tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e'
  AND l.is_completed AND NOT COALESCE(s.is_practice, false)
  AND l.lesson_date >= DATE '2026-10-01' AND l.lesson_date < DATE '2026-11-01';
```
   (This is a cross-check of the gross total only; shares and placement fees stay in JS. A 1–2 cent difference is possible when lessons have fractional-cent fees.)

### Phase 3 — checklist actions, carry, close, reopen
12. With an open item: the button reads "Resolve 1 item to close" and is disabled.
13. Tap **Carry into November** → row turns green "…, carried into November"; Pending tile label becomes "Pending, carried"; button becomes **Close October**. Reload the page → the carry is still ticked. Tap Undo → it is open again.
14. With 3+ open items, **Carry all (n)** appears and carries them all.
15. On a different test month: **Mark as paid**, **Write off** (confirm appears), **Bill now** (confirm shows lesson count and amount), **Mark done**, **Open statement** (lands on the right payee + month) each work and the list refreshes. Cancel on a confirm changes nothing.
16. Tap **Close October** → "Closing…" → confetti once → "October closed" card; intro "Closed on <today>. Figures are locked." Reload → closed card, no confetti.
17. Double-tap Close quickly on another month → one close only, no error shown.
18. Data check: `SELECT month, status, revision, calc_version, snapshot->'totals' AS totals, jsonb_array_length(snapshot->'lessons') AS lesson_lines, snapshot->'carried' AS carried, closed_at FROM month_closes WHERE tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e' ORDER BY month;` → totals equal the tiles; `lesson_lines` = Lessons taught; carried items listed. And `SELECT action, amount_before, amount_after FROM closed_month_changes WHERE entity_type = 'month_close' ORDER BY changed_at;` → one `closed` row.
19. **Reopen**: tap Reopen October → modal. Empty reason → "Please add a short reason." Type "testing" → Reopen → amber banner with date and reason; button "Close October again". Close again → revision 2 (re-run the first query in step 18).
20. Close the month before it (September) too; reopen the later one's page → the comparison sentence "That is $X more than September" appears.
21. With device time zone changed to e.g. New York, the closable months and all dates on the page are the same as before (Singapore time).

### Phase 4 — warnings and change log
With October closed:
22. Lessons page → edit an October lesson's duration → confirm "October 2026 is closed…" appears. **Cancel** → nothing saved. Repeat and **OK** → saved.
23. Close page for October → amber **Changed after close** panel: Closed vs Now table shows the difference; "What changed" shows the edit with old → new amount.
24. Edit the lesson back to the original duration → panel changes to "Edited after close, no net change."
25. Mark an October notice as paid from Payments → confirm (payment wording) → OK. October's close page shows "Since close: … paid $X". **No** "Changed after close" from this alone.
26. Add a completed lesson dated in October for a **monthly** student whose October notice is paid → warning mentions a new notice → OK. A new pending notice appears on Payments; November's checklist shows it "From October"; October shows "Changed after close" (lessons +1).
27. Repeat a warning test from each screen: Calendar (mark done, delete), Dashboard (mark paid, write off), Student profile (bill now / write off). Each shows the confirm; Cancel changes nothing.
28. Edit a lesson in a month that is **not** closed → no confirm. Edit an October lesson's **notes only** → no confirm.
29. Data check: `SELECT changed_at AT TIME ZONE 'Asia/Singapore' AS sgt, entity_type, action, student_name, amount_before, amount_after, old_values, new_values FROM closed_month_changes WHERE tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e' ORDER BY changed_at DESC LIMIT 20;` → one row per change above, none for steps 28.
30. A practice student's lesson in October edited → no confirm, no log row.
31. Clean up: delete the test lesson from step 26 (confirm appears), then **Reopen to update figures** → reason "clean-up after testing" → close again → panel gone.

### Phase 5 — year-end report
32. Year-end report for 2026: readiness card "2026 so far: n of m finished months ready" with links for unclosed months. Links open the right month.
33. Closed months show 🔒; their row equals the close page's figures (Lessons, Total billed → Gross fees, Agencies → Agency's share, revenue, Cash received → Collected).
34. Make an edit in a closed month (as step 22) → that row shows amber "Changed after close", the banner appears, and "Live records differ by …" shows under Revenue. Tap the tag → lands on that month's close page. Revert the edit → marker disappears.
35. Table total row = sum of the 12 rows shown; the 2-line statement Revenue equals the table's revenue total.
36. A month with no lessons and no payments counts as ready ("nothing to close" sub-line).
37. **Copy summary for accountant** → label "Summary copied", toast; paste into Notes: figures match the page; status line says DRAFT while the year is running.
38. Time-zone check (Claude runs): `SELECT id, paid_at, (paid_at AT TIME ZONE 'Asia/Singapore')::date AS sgt_date FROM payment_cycles WHERE tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e' AND status = 'paid' AND to_char(paid_at, 'YYYY-MM') <> to_char(paid_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM');` → any rows listed must be counted in the **Singapore** month on the report.
39. Select a past year with no data → readiness card does not crash; rows are dashes.

### Phase 6 — entry points
40. Dashboard recap card, go back to a closed month → chip "🔒 Closed <date>", tiles equal the snapshot, Pending label "Pending at close". A past unclosed month shows "Close <month> →". Current month looks exactly as before.
41. Nudge: shows between the 1st and 10th when last month is unclosed. To test on other dates open `/dashboard?showCloseNudge=1` (forces the date rule only; it still needs an unclosed last month). ✕ hides it; reload → still hidden. After closing last month → gone even with the test flag.
42. What's New banner shows the new bullet once; dismiss → stays dismissed.

---
## 9. Build phases

Each phase = one branch + one PR into `claude/charming-cray-new6h0`, tested on its deploy preview, merged before the next starts.

**Before starting**
- Migration **059** (`students.is_practice`) must be live. 060 stops with a clear message if it is not.
- Phase 5 needs **PR #4 (year-end report) merged**. Phases 1–4 and 6 do not.
- There is no test runner in this repo. Do not add one.

| Phase | Branch | What | Schema? |
|---|---|---|---|
| 1 | `claude/month-close-1-schema` | Migration file 060 only | propose SQL only |
| 2 | `claude/month-close-2-page` | `monthClose.js`, read-only close page, Payments link | no |
| 3 | `claude/month-close-3-close` | Checklist actions, carry, close, closed state, confetti, reopen | no |
| 4 | `claude/month-close-4-warnings` | Closed-month warnings everywhere, Since close strip, Changed after close panel | no |
| 5 | `claude/month-close-5-year-end` | Year-end report tie-in | no |
| 6 | `claude/month-close-6-entry-points` | Recap card chip + snapshot tiles, Dashboard nudge, What's New | no |

### Phase 1 — schema (propose only)
```text
Create branch claude/month-close-1-schema from claude/charming-cray-new6h0.

Read docs/specs/month-end-close.md first, fully. This phase is section 5 only.

Task: add ONE new file, supabase/migrations/060_month_end_close.sql, containing
exactly the SQL in section 5.3 of the spec (copy it; do not redesign it). If you
believe something in it is wrong, do NOT change it silently — keep the SQL as
written and list your concerns in your report.

Rules:
- PROPOSE SQL ONLY. Do not run any SQL. Do not use any Supabase tool to apply or
  execute anything. Hanyong reviews the file and runs it manually in the Supabase
  SQL Editor.
- Do not touch any other file. No frontend changes in this phase.
- Do not edit earlier migration files.

Then open a PR into claude/charming-cray-new6h0 titled
"Migration 060: month-end close (propose only)". In the PR description paste the
verification queries V1–V7 and the rollback SQL from sections 5.5 and 5.6, and
state clearly that migration 059 must be live first.

Report back: branch name, commit hash, PR number/link, and any concerns.
Do not merge.
```

### Phase 2 — snapshot maths + read-only page
```text
Create branch claude/month-close-2-page from the latest claude/charming-cray-new6h0.

Read docs/specs/month-end-close.md first, fully. Migration 060 is already live
(Hanyong ran it). This phase builds sections 4.1–4.5 as READ-ONLY and sections
6.1–6.4. No buttons that change data yet.

Build:
1. src/lib/monthClose.js (new, pure — no Supabase, no Date.now()/new Date() inside
   buildMonthSnapshot):
   - CALC_VERSION = 1, sgtDateKey, sgtMonthKey, sgtTodayKey, sgtStamp (6.1)
   - monthBounds(monthStr), canCloseMonth(monthStr, todayKey)
   - buildMonthSnapshot(...) exactly as 6.2, output shape exactly as 5.7
   - checkSnapshot(snapshot) returning a list of failed self-checks (6.2)
   - buildChecklist(...) exactly as 6.4 (items with type, ref_id, student, label,
     amount_cents, origin_month, tag)
   It must call the existing buildEarningsBreakdown (src/lib/collectedBreakdown.js)
   and lessonAmount (src/lib/paymentMode.js). Do NOT modify those two files and do
   NOT re-implement their arithmetic.
2. src/lib/monthCloseData.js (new): loadMonthCloseData(tutorId, monthStr) doing the
   queries in 6.3, every list paged with .range() in blocks of 900, plus the
   monthly/custom_date backfill described there. Throw on any query error.
3. src/pages/MonthClose.jsx (new): route /month-close?month=YYYY-MM. Header, month
   arrows, tiles, cash line, "Who earns what", checklist rows WITHOUT action
   buttons (only the "Open statement" and "Fix in Lessons" links), and a disabled
   bottom button reading "Closing comes in the next update". States from 4.2:
   loading, load error with Try again, nothing happened, month not over,
   practitioner blocked.
4. src/App.jsx: add the protected route (copy the /payments route wrapper).
5. src/pages/Payments.jsx: add a tutors-only text link "Month-end close" near the
   bottom of the page.

Rules:
- Do not run SQL. Do not change the schema. Do not write to month_closes or
  closed_month_changes.
- Do not change MonthlyRecapCard.jsx, Dashboard.jsx, Statements.jsx or anything
  under practitioner/agency screens.
- Students are loaded with NO archived/deleted filter; practice students
  (is_practice) are excluded from every figure.
- All month/date decisions use the Singapore-time helpers, never device time.
- Wrap localStorage in try/catch. Show visible errors; never fail silently.
- Run npm run lint and npm run build; fix what you introduced.

Open a PR into claude/charming-cray-new6h0. In the PR description list how you
checked acceptance tests 3–11 of the spec.
Report back: branch name, commit hash, PR number/link, deploy-preview URL if
known, and anything in the spec you could not follow exactly.
Do not merge.
```

### Phase 3 — actions, carry, close, reopen
```text
Create branch claude/month-close-3-close from the latest claude/charming-cray-new6h0
(Phase 2 is merged).

Read docs/specs/month-end-close.md first, fully. This phase: sections 3.1–3.4,
4.2, 4.5, 4.6 (closed card, confetti, reopen modal only), 4.9, 6.5, 6.13.

Build in src/pages/MonthClose.jsx (+ small new components under src/components/
if it gets long, e.g. MonthCloseChecklist.jsx, ReopenMonthModal.jsx):
1. Checklist action buttons per 4.5, using the same Supabase calls as
   src/pages/Payments.jsx (handleMarkPaid, handleWaiveCycle) and
   supabase.rpc("create_manual_closeout_cycle", { p_student_id }) for Bill now;
   Mark done = update is_completed true; Didn't happen = delete the lesson (also
   remove its Google Calendar event the way Lessons.jsx confirmDelete does).
   Confirm texts from 4.5. Always .eq("tutor_id", user.id). Toast on success,
   visible red error on failure, then reload the page data.
2. Carry / Undo carry / Carry all, drafted in state + localStorage as in 6.5
   (try/catch). "Pending, carried" label rule from 4.3.
3. Close: on tap, reload data, rebuild checklist + snapshot, run checkSnapshot;
   abort with the messages in 6.13 / 4.9 if anything is unresolved or a check
   fails. Then call supabase.rpc("close_month", { p_month: "YYYY-MM-01",
   p_snapshot }). Handle errors with the table in 4.9 (MONTH_ALREADY_CLOSED =
   success). Re-read the row and compare totals (6.2 "After saving").
4. Closed state: figures from the stored snapshot, closed card, previous-month
   comparison sentence only if the previous month is closed, CSS-only confetti
   once (4.6), "Reopen <month>" link.
5. Reopen modal → supabase.rpc("reopen_month", { p_month, p_reason }); reopened
   banner; "Close <month> again".
6. Hint from 6.9 when an earlier month is not closed.

Rules:
- NEVER write to month_closes or closed_month_changes with .from(...).insert/
  update/delete — those tables are read-only for the browser. Only the two RPCs.
- Do not run SQL. No schema changes. No new npm packages.
- Do not change MonthlyRecapCard.jsx, Dashboard.jsx, collectedBreakdown.js,
  paymentMode.js, or practitioner/agency screens.
- Disable buttons while a request is running (no double submits).
- Run npm run lint and npm run build.

Open a PR into claude/charming-cray-new6h0. In the description list how you
checked acceptance tests 12–21, and warn that closing a month on the preview
closes it in the live database.
Report back: branch name, commit hash, PR number/link, and deviations from the spec.
Do not merge.
```

### Phase 4 — warnings + change log display
```text
Create branch claude/month-close-4-warnings from the latest
claude/charming-cray-new6h0 (Phase 3 is merged).

Read docs/specs/month-end-close.md first, fully. This phase: sections 3.5, 4.6
("Since close" strip and "Changed after close" panel), 4.7, 6.6, 6.7, 6.10, 6.13.

Build:
1. src/lib/closedMonths.js (new):
   - loadClosedMonths(tutorId): Set of "YYYY-MM" with status 'closed' from
     month_closes; cached in memory per page load; returns null on error.
   - clearClosedMonthsCache() — call it after close_month / reopen_month succeed.
   - confirmClosedMonthChange({ tutorId, dateKeys, kind }) → Promise<boolean>.
     kind is 'lesson' | 'lesson_add' | 'paid' | 'notice'. Shows window.confirm
     with the exact copy in 4.7 when any dateKey's month is closed; returns true
     immediately when none is, or when the closed list could not be loaded.
2. Call confirmClosedMonthChange BEFORE the write at every site listed in 6.13
   ("Where warnings go"). Line numbers there are approximate: run
   git grep -n 'from("lessons")' and git grep -n 'payment_cycles' and
   git grep -n 'manual_closeout' in src/ and cover every insert/update/delete/rpc
   that matches the rules in 6.13. If the user cancels, do nothing (and undo any
   optimistic UI update). Skip practice students and lessons that are not done
   before and after. For Bill now use the student's latest unbilled completed
   lesson date.
   Make the smallest possible edit at each site: one awaited guard line. Do not
   refactor the surrounding code.
3. MonthClose.jsx closed state: "Since close" strip and "Changed after close"
   panel (4.6), driven by compareSnapshotToLive (add it to monthClose.js, keys in
   6.6, calc_version rule in 6.2) and by closed_month_changes rows, worded per 6.7.
   Button "Reopen to update figures" opens the existing reopen modal.

Rules:
- The log is written by database triggers. Do NOT write log rows from the
  frontend. Do not run SQL. No schema changes.
- Do not change the behaviour of any existing handler other than adding the
  guard. Practitioner flows must behave exactly as before (they never have closed
  months, so the guard returns true).
- Run npm run lint and npm run build.

Open a PR into claude/charming-cray-new6h0. In the description include a table of
EVERY file + function where you added the guard, and every lessons/payment_cycles
write you decided NOT to guard, with the reason. List how you checked acceptance
tests 22–31.
Report back: branch name, commit hash, PR number/link, deviations.
Do not merge.
```

### Phase 5 — year-end report tie-in
```text
Create branch claude/month-close-5-year-end from the latest
claude/charming-cray-new6h0. PRECONDITION: src/pages/YearEndReport.jsx exists on
that branch (PR #4 merged). If it does not, stop and report.

Read docs/specs/month-end-close.md first, fully (and
docs/specs/year-end-income-report.md). This phase: sections 3.6, 4.8, 6.8.

Edit src/pages/YearEndReport.jsx (and add small components if needed):
1. Loading changes in 6.8 items 1–4 (month_closes, change-log rows, practice
   filter, Singapore-time helpers from src/lib/monthClose.js, widened + paged
   cycles query, placement-fee history rule, lesson_time in the lessons select).
2. For each month build the live snapshot with buildMonthSnapshot and pick the
   row figures and marker using the table in 6.8 item 5. Annual totals, headline
   tiles, 2-line statement and reconciliation = sums of the rows AS DISPLAYED
   (6.8 item 6).
3. Readiness card, lock column, "Changed after close" / "Reopened" / "In
   progress" tags, amber banner, "Live records differ by" line, note above the
   record cards (4.8, 6.8 items 7–9).
4. "Copy summary for accountant" button with the exact text layout in 4.8,
   clipboard fallback textarea, toast.

Rules:
- Do not change computePerStudentRows or the CSV columns. Do not add expenses.
- Do not modify collectedBreakdown.js or paymentMode.js.
- Do not run SQL. No schema changes. Read-only use of month_closes and
  closed_month_changes.
- Keep the practitioner block and the existing "Not tax advice" footer.
- Run npm run lint and npm run build.

Open a PR into claude/charming-cray-new6h0. In the description list how you
checked acceptance tests 32–39.
Report back: branch name, commit hash, PR number/link, deviations.
Do not merge.
```

### Phase 6 — entry points
```text
Create branch claude/month-close-6-entry-points from the latest
claude/charming-cray-new6h0.

Read docs/specs/month-end-close.md first, fully. This phase: section 4.10.

Build:
1. src/components/MonthlyRecapCard.jsx: accept a new optional prop
   closedMonths (Map "YYYY-MM" → month_closes row). When the month on screen is
   closed: chip "🔒 Closed <date>", tiles and "who earns what" from the snapshot
   as listed in 4.10, Pending label "Pending at close". Past + not closed: link
   "Close <month> →" to /month-close?month=YYYY-MM. Current month and the
   no-prop case: render EXACTLY as today. Do not touch computeForMonth.
2. src/pages/Dashboard.jsx: load month_closes once (id, month, status, closed_at,
   snapshot) and pass closedMonths to both MonthlyRecapCard usages; add the
   dismissible nudge (dates, copy, localStorage key and ?showCloseNudge=1 test
   flag in 4.10); update ANNOUNCEMENT (new id whats-new-2026-12-month-close, one
   new bullet about Month-end close at the top of the list).
   Tutors only; practitioners see no change.

Rules:
- Smallest possible edits to Dashboard.jsx; do not restructure loadAll().
- localStorage in try/catch. Singapore-time helpers for the date rule.
- Do not run SQL. No schema changes.
- Run npm run lint and npm run build.

Open a PR into claude/charming-cray-new6h0. In the description list how you
checked acceptance tests 40–42.
Report back: branch name, commit hash, PR number/link, deviations.
Do not merge.
```

---

## 10. Open questions for Hanyong

1. **Warning when marking a closed-month notice as paid.** Your note says every change must warn first, so the spec builds a confirm for "Mark as paid" too. But paying a carried notice is the normal, expected thing — a pop-up every time may train people to click through the warnings that matter. **Default built: confirm (as you asked).** My suggestion after a couple of weeks of use: switch paid to a toast-only notice ("Recorded. October stays closed.") — it is still logged either way.
2. **If the logging trigger ever errors, should the lesson save still go through?** **Default: yes** — the save succeeds and the problem lands in the Postgres log. The alternative (block the save) protects the log but could stop you recording lessons because of a logging bug.
3. **Read-only tables.** `month_closes` and `closed_month_changes` have a SELECT policy only; all writes go through functions. This departs from the usual "four policies per table" habit on purpose, so snapshots and the log cannot be edited from a browser. **Default: keep as designed.** Side effect: you cannot delete a test close from the app — only reopen it (or remove it in the SQL Editor).
4. **Agency share % in the snapshot.** The recap uses the payee's current %. A sent statement freezes its own % (`payee_statements.share_percent`). If you ever change an agency's % after sending a statement, the two could differ. **Default: use the current %, same as the recap** (no statements exist yet, so no effect today).
5. **Closing order.** **Default: any order, with a gentle "oldest first" hint.** Forcing strict order would make first-time catch-up (Apr–Oct 2026) more rigid than it needs to be.
6. **"Lessons taught" counts completed lessons only** in the snapshot, while today's Dashboard recap counts every past lesson, done or not. **Default: completed only** (matches the money). Say if you would rather I also spec a small fix to the recap card.
7. **Months with nothing in them** count as ready without being closed. **Default: yes** (otherwise a tutor who started in April must "close" three empty months).
8. **Bad debts in "Adjusted profit".** The concept's Tax season screen subtracts bad debts; the year-end report in PR #4 does not (it subtracts agency commission only). This spec does not change that — the copy summary lists bad debts on their own line. **Default: leave as PR #4 has it; worth a quick check with your accountant.**
9. **Carry ticks are saved on the device until you close** (then stored in the snapshot). Starting a close on your phone and finishing on your laptop means re-ticking. **Default: accept** (saves a table and four policies).

---

## 11. Risks and how the spec handles them

| Risk | Mitigation |
|---|---|
| New triggers on `lessons` break or slow lesson saving | Fire only on money columns; early exit when the month is not closed; errors swallowed into warnings; rollback SQL ready (5.6); "do one normal thing in the live app" step straight after the migration. Dry-run evidence in 5.4. |
| Migration run before 059 → trigger would fail silently on `is_practice` | 060 checks for the column first and stops with a clear message. |
| Snapshot differs from the recap / year-end because the maths was re-implemented | One pure function wraps the existing `buildEarningsBreakdown`; self-checks before saving; acceptance test 4 compares with the recap card; the year-end report compares using the *same* function on both sides. |
| False "Changed after close" after a future code change to the earnings logic | `calc_version` stored per snapshot; mismatches show "older calculation" instead of a wrong difference. Builders must bump `CALC_VERSION`. |
| Stale snapshot used for tax when a real correction was made after close | Marker + banner + "Live records differ by"; "Ready to share" is impossible until every changed month is reopened and closed again. |
| Changes the log cannot see (rates, share %, placement fees, earlier-month backdating) | Snapshot-vs-live comparison flags them (6.6) and says a setting probably changed. |
| A warning is missed at one of ~30 write sites | Logging is server-side, so the record and the marker still appear. Phase 4 PR must list every guarded and unguarded site. |
| Recompute regrouping floods the log | Automatic notice insert / delete is deliberately not logged; `payment_cycle_id` relinks are not in the trigger's column list (checked in the dry run). |
| Time-zone slips at month boundaries (DB is UTC) | All SQL uses `AT TIME ZONE 'Asia/Singapore'`; all JS uses the `sgt*` helpers; acceptance tests 21 and 38. |
| More than 1,000 rows silently cut off | Every list paged with `.range()`; load errors stop the page. (The Dashboard's own unpaged queries are an existing risk, outside this spec.) |
| RLS surprises (403 on write) | The browser never writes the new tables; the prompts forbid it; V2/V3/V5 verify grants and policies. |
| Testing on previews closes real months | Tests end with explicit clean-up; reopen always available; a mistaken test close can be removed by Hanyong in the SQL Editor. |
| Tutor deletes their account while log rows are being written | Triggers skip when the tutor row is gone; both tables cascade on tutor delete (checked in the dry run, not on live). |
| Year-end per-student cards disagree with closed months | Cards stay live in v1 with a note when any month has changed; snapshot-based cards listed under "Later". |
| Phase 5 blocked because PR #4 is not merged | Phases 1–4 and 6 are independent of PR #4; Phase 5's prompt stops if the file is missing. |
