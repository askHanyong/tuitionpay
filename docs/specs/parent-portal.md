# Spec: Parent portal (Pay, Progress, Book in one place)

Status: draft for review · Written 16 Nov 2026 · Migration assigned: **064**
Base branch for all PRs: `claude/charming-cray-new6h0`
Concept reference: `/home/claude/cnp/project/Parent.dc.html` (header with avatar + three tabs; **Pay** tab: big amount, "Scan with your banking app to pay by PayNow" card, Reference row with Copy, "I've paid $480" button, "Thank you" card, "What this covers" list; **Progress** tab; **Book** tab: "Next lesson" card, slot list, "Request sent" card).
Related spec: `docs/specs/done-to-parent-report.md` (migration 061) owns how progress is captured and the `get_progress_summary` function. This spec only hosts its Progress tab.

---

## 1. Plain-language summary for Hanyong

- Today a parent can receive up to three different things from you: a `/pay/...` link (a plain table of notices), a `/book/...` link, and progress by WhatsApp/PDF. This spec turns the existing `/pay/<token>` link into **one parent page per student** with three tabs: **Pay**, **Progress**, **Book**. Every pay link you have already sent keeps working and simply shows the new page.
- **Pay** shows what is owed, a real PayNow QR code with the amount locked and the reference filled in, copy buttons for number / amount / reference (because a parent reading WhatsApp on their phone cannot scan their own screen), the lessons the amount covers, and an **"I've paid"** button.
- "I've paid" **never marks anything paid**. It leaves a message for you ("Parent says paid $480, 16 Nov 8:14 pm"). You still tap **Mark as paid** after checking your bank, exactly as now. Marking paid clears the message automatically.
- Students whose fees an agency collects never see your PayNow or any amounts. They see "Fees are collected by {agency}" instead.
- **Book** is the booking page you already have, shown inside the tab. **Progress** is the tab defined in the done-to-parent-report spec; it appears once that feature is live and you have shared a report.
- You get one **Parent link** card on each student's profile: copy, share on WhatsApp, and **Reset link** (kills the old link at once if it went to the wrong person).
- Parents never log in. The page can only ever show the one student its link belongs to.
- Three things I found while reading the code that you should know about, all fixed by this work: the current `/pay` page shows a **waived** notice as "Pending" and adds it to "Outstanding"; the pay token column has no uniqueness index; and the tutor-only Feedback button and "Install app" banner appear on parent pages.

---

## 2. Scope

**In**
- One parent page at `/pay/:token` (and alias `/parent/:token`), tabs chosen with `?tab=pay|progress|book`.
- Pay tab: PayNow QR (EMVCo/SGQR payload built in the browser), copyable PayNow number / amount / reference, lesson breakdown, receipts for recent paid notices, "I've paid" and "I haven't paid yet".
- `payment_claims` table + four database functions + one trigger (migration 064).
- Tutor side: open claims panel on Payments, chip on the matching notice rows, alert card on Dashboard, "Not received" action.
- Tutor side: **Parent link** card on the student profile (copy, WhatsApp, reset link, Pay tab display setting, booking on/off).
- Agency-collected students: note instead of PayNow, no amounts.
- Practice students: page works, clearly marked.
- Book tab: the existing booking flow embedded (same Netlify functions, same rules).
- Progress tab: host the `ParentProgress` component from the other spec.

**Out**
- Any change to how notices are calculated (`recompute_payment_cycles`, `handle_lesson_change` are untouched).
- Any change to booking rules, `booking-page.js` or `booking-request.js`.
- Capturing progress (topics, ratings, strengths). See the other spec.
- Online card/PayNow gateway payments, automatic bank matching, receipts by email.
- Parent accounts or logins.
- The agency platform tables (`agencies`, `agency_placements`; 0 placements live). Only read defensively, as `/pay` does today.
- Practitioner accounts (`tutors.user_type = 'practitioner'`): no Parent link card for them (they already get `paymentLink: null` in `StudentProfile.jsx` line ~330).

**Later**
- Push or email to the tutor when a parent claims payment (v1 is in-app only).
- Parent cancels a pending booking request from the page (concept shows "Cancel request"; there is no parent cancel endpoint today).
- Slot-card booking UI exactly as the concept (v1 reuses today's start-time/length form).
- One page for siblings (several students behind one link).
- Remove `get_payment_summary` and `PaymentSummary.jsx` leftovers one release after the switch.
- Make `/book/:token` refuse archived/deleted students (see Risks R9).
- Topic names under each lesson in "What this covers" (concept shows them).

---

## 3. User stories and flows

### 3.1 Parent pays (tutor collects) — concept: Pay tab
1. Parent taps the link in your WhatsApp payment request (`https://chopeandpay.com/pay/<token>`, unchanged).
2. Header: avatar initials, "{Student}'s lessons", "{subject} with {tutor name}". Tabs: Pay · Progress · Book (only the ones that apply).
3. "Hello {guardian name}. October's lessons come to" **$480**.
4. QR card. On a laptop/second device they scan it. On the same phone they tap **Save QR** (or press and hold the image) and import it in the banking app, or use the three **Copy** rows.
5. After paying they tap **I've paid $480**. Card changes to "Thank you, {guardian name}. {Tutor} has been told…". An "I haven't paid yet" link undoes it.
6. You open ChopeAndPay: Dashboard shows "1 parent says they've paid"; Payments shows the claim. You check your bank and tap **Mark as paid** (existing button). The claim closes by itself. If the money is not there, tap **Not received**.
7. Parent reopens the link later: "All paid up. Thank you!" and the receipt line "October · $480 · Paid 17 Nov".

### 3.2 Parent of an agency-collected student
1. Opens the link. Pay tab shows: "Fees for {Student}'s lessons are collected by {agency name}. Please pay them the usual way." plus the dates of lessons in the open period. No amounts, no QR, no "I've paid".

### 3.3 Parent books an extra lesson — concept: Book tab
1. Taps **Book**. Sees "Next lesson" card, then the existing booking list ("Available times", form, "Request sent"). Tutor confirms in Booking Requests as today.
2. If you have not switched booking on for this student: "Next lesson" card and "To change or add a lesson, message {tutor}."

### 3.4 Parent checks progress — concept: Progress tab
1. Taps **Progress** (or arrives with `?tab=progress` from a lesson report message). Content is `ParentProgress` from the other spec. Tab is hidden until at least one report has been shared.

### 3.5 Tutor shares or resets the link
1. Student profile → **Parent link** card → **Copy link** / **Share via WhatsApp**.
2. Link went to the wrong chat: **Reset link** → confirm → new link shown. The old `/pay` link and the old `/book` link for that student stop working immediately.

---

## 4. UI spec

General rules for the parent page:
- Mobile-first, single column, `max-w-md mx-auto`, page background `#f2f6f4`, text navy `#1b2d4f`, muted `#56627a`, accent mint `#5ecfaa`, dark green `#0b6e4f`, cards white with `rounded-[20px]` and a faint shadow, primary buttons `min-h-14 rounded-[18px] bg-[#5ecfaa] text-[#1b2d4f] font-bold text-lg`. All tap targets at least 44px high. Match `Parent.dc.html`.
- Font: use the app's existing Inter (700 for headings). Do **not** add the concept's Bricolage Grotesque font (see Open question 8).
- No `position: fixed` elements except the toast (WhatsApp's in-app browser handles them badly). No hover-only behaviour. No pop-up windows.
- Never render `FeedbackButton` or `InstallPromptBanner` on `/pay/*`, `/parent/*`, `/book/*` (both are mounted globally in `App.jsx` today).
- Every `localStorage` use wrapped in try/catch (only used for nothing essential; the page must work with storage blocked).
- All money via `formatSGD` (`src/lib/paymentNotice.js`). In the hero and on the button, drop ".00" when the amount is whole (`$480`, but `$480.50`).
- Date-only strings (`YYYY-MM-DD`) are formatted by splitting the string, never by `new Date("YYYY-MM-DD")`. Add helper `fmtDay("2026-10-06") → "Tue 6 Oct"` and `fmtMonth("2026-10-01") → "October"` in the new `src/lib/parentPortal.js`.
- `claimed_at` is a timestamp: format with `toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })`.

### 4.1 Page shell — new `src/pages/ParentPortal.jsx`

| State | What shows |
|---|---|
| Loading | Navy header block with grey placeholder bars, one white skeleton card. Text for screen readers: "Loading…" |
| Not found (`get_parent_portal` returned `null`) | Centered card: 🔒 "This link isn't active any more. Please ask your tutor for a new one." No other detail (same message for wrong, reset and deleted-student tokens). |
| Error (RPC error / offline) | Card: "We couldn't load this page just now. Please check your connection and try again." + **Try again** button (re-runs the load). |
| Ready | Header + tabs + active tab content + footer "Powered by ChopeAndPay" (plain text, no link). |

Header (concept: navy block): avatar circle with initials (first letter of the first two words of `student.name`, upper-case), title `{student.name}'s lessons`, sub-line `{subject} with {tutor_name}` (omit "{subject} " if null; if `tutor_name` is null use "your tutor").

Practice banner (only when `student.is_practice`), directly under the header, amber `bg-[#fdf0dc] text-[#8a4b08]`: **"Practice link. This is test data, not a real bill. Please don't pay."**

Tabs (concept: three buttons attached to the header):
- **Pay**: shown unless `pay.mode === "hidden"`.
- **Progress**: shown only when the progress call returned at least one report, or the URL has `?tab=progress` (rule from the other spec). Not shown at all until phase 5.
- **Book**: always shown.
- If only one tab would show, hide the tab bar.
- Active tab comes from `?tab=` (`useSearchParams`); default is Pay, or Book when Pay is hidden. Tapping a tab updates the query string with `replace: true`.

On mount set `document.title = "{student.name}'s lessons · ChopeAndPay"` and add `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">` to `document.head` (remove on unmount).

### 4.2 Pay tab — new `src/components/portal/PayTab.jsx`

Inputs: the `pay` object, `guardian_name`, `tutor_name`, `student.name`, plus `onChanged()` to reload.

Definitions used below:
- `covered` = unpaid notices with `period_end <= claim.covers_through` (when a claim exists); `fresh` = the other unpaid notices. With no claim, all unpaid notices are `fresh`.
- `freshTotal` = sum of `amount` over `fresh`.

**State A: tutor collects, something to pay, no claim** (`mode === "paynow"`, `claim === null`, `unpaid.length > 0`)
1. Greeting + hero (concept: "Hello Mrs Lim. October's lessons come to $480"):
   - Greeting prefix: `Hello {guardian_name}. ` (omit when null).
   - One notice, `payment_mode` monthly or custom_date: `{fmtMonth(period_start)}'s lessons come to`
   - One notice, other modes: `Lessons from {fmtDay(period_start)} to {fmtDay(period_end)} come to` (if both dates are equal: `The lesson on {fmtDay(period_end)} comes to`)
   - More than one notice: `{n} payment notices are outstanding. Together they come to`
   - Amount in 52px bold. Chip beside it only for monthly/custom_date with one notice: `Due {fmtDay(period_end)}` (amber chip as concept). Never use the word "overdue" on the parent page.
2. PayNow card:
   - Title: "Scan with your banking app to pay by PayNow".
   - QR image (see 6.2), 232px wide, navy 2px border, `alt="PayNow QR code for {amount}"`.
   - Under it: "The amount and reference are filled in for you."
   - Button (secondary, full width): **Save QR to photos**. Helper text below: "On this phone? Save the QR, then open your banking app → Scan & Pay → choose it from your photos. Or copy the details below."
   - Three copy rows (concept's Reference row, repeated): `PayNow to` · `{display number}`; `Amount` · `{amount with 2 decimals, no $}`; `Reference` · `{reference}`. Each has a **Copy** button that turns to "Copied" for 2 seconds and shows the toast "{label} copied".
   - If there is a PayNow number but it cannot be turned into a QR (6.2 returns null): no QR, no Save button; show the rows only and the line "Pay by PayNow to the number below."
   - If the tutor has no PayNow number at all: replace the whole card body with "Please pay {tutor_name} the usual way (PayNow or bank transfer)." and keep the Amount and Reference rows.
3. Primary button: **I've paid {amount}**. While sending: "Sending…", disabled.
4. Small line under the button: "This lets {tutor_name} know to check. Your payment is confirmed once they've seen it arrive."
5. Card **What this covers** (concept): one row per lesson of every unpaid notice, oldest first: left `{fmtDay(date)}, {time as h:mm am/pm}` (omit time when null) with a muted second line `{subject}` when present; right `{amount}`. Footer row bold: `{k} lesson(s)` · `{total}`.
   - If, for a notice, the lesson amounts do not add up to the notice amount (within 1 cent), hide the per-lesson amounts for that notice and show only its total row. (Manual edits can cause this; never show sums that do not match.)
   - More than one notice: a small muted sub-heading before each group: `{fmtDay(period_start)} – {fmtDay(period_end)} · {amount}`.

**State B: claim open** (`claim !== null`)
- Card (concept "paid" state): mint tick circle, **"Thank you, {guardian_name}"** (or "Thank you" when null), text "{tutor_name} has been told. This page will show it as paid once they confirm the {claim.amount} has arrived." Muted line: "Sent {claimed_at}". Link button: **I haven't paid yet** (calls withdraw; on success reload).
- If `fresh.length > 0`: below it, heading "New since then", then State A's hero amount (using `freshTotal`), PayNow card and copy rows for `freshTotal` , but **no** "I've paid" button; instead the line "You can let {tutor_name} know about this one after the earlier payment is confirmed."
- "What this covers" as in State A.

**State C: nothing to pay** (`mode === "paynow"`, `unpaid.length === 0`)
- Card: mint tick, **"All paid up. Thank you!"**, muted "Nothing is due right now."

**Receipts** (states A, B, C, when `history.length > 0`): card "Recent payments", one row each: `{fmtDay(period_start)} – {fmtDay(period_end)}` · `{amount}` · muted "Paid {fmtDay(paid_on)}" (omit when `paid_on` is null).

**State D: note mode** (`mode === "note"`)
- Card: **"How to pay"**. Text, first match wins:
  1. `pay.note` (tutor's own words), shown as plain text with line breaks preserved;
  2. `Fees for {student.name}'s lessons are collected by {collected_by}. Please pay them the usual way.`
  3. `Fees for {student.name}'s lessons aren't paid through this page. Please check with {tutor_name}.`
- If `unpaid.length > 0`: card "Lessons in this period" listing lesson dates/times only. No amounts anywhere.
- No QR, no copy rows, no "I've paid", no receipts.

**Claim button results** (`claim_parent_payment` returns `{ok, code}`):

| code | What the parent sees |
|---|---|
| `claimed`, `already` | Reload → State B. |
| `changed` | Reload, then toast: "The amount has just been updated. Please check it and tap again." |
| `nothing_due` | Reload → State C. |
| `too_many` | Red inline text under the button: "That's been tapped a few times today. Please message {tutor_name} directly." |
| `not_allowed`, `not_found` | Reload (page will show the right state). |
| network/RPC error | Red inline text: "Couldn't send that. Please check your connection and try again." Button re-enabled. |

Toast: one navy pill at the bottom (concept), `role="status"`, 2.4 s.

Copy behaviour (must work in WhatsApp's in-app browser): try `navigator.clipboard.writeText`; if it is missing or rejects, fall back to a temporary off-screen `<textarea>` + `document.execCommand("copy")`; if that also fails show the toast "Press and hold the text to copy it" (the value text has `user-select: all`).

Save QR behaviour: create an `<a download="paynow-{reference}.png" href="{dataUrl}">` and click it. Always keep the QR as a real `<img>` so press-and-hold → "Save image" works where downloads are blocked.

### 4.3 Book tab — new `src/components/portal/BookTab.jsx`
1. **Next lesson** card (concept): date tile (weekday + day number) and "Next lesson" / `{fmtDay(date)}, {time}` / muted `{duration} min`. From `book.next_lesson`. When null: "No lesson scheduled yet."
2. `book.enabled === true`: render the existing booking UI via `<BookingPanel token={book.token} embedded />` (see 6.6). Heading above it (concept): **"Need an extra or make-up lesson?"** / muted "Pick a time {tutor_name} has opened. They'll confirm each request."
3. `book.enabled === false`: muted card "To change or add a lesson, message {tutor_name}."
4. If `student.archived`: only item 1's empty text is replaced by "Lessons with {tutor_name} have ended." and nothing else shows.

### 4.4 Progress tab
`<ParentProgress data={progress} />` from `docs/specs/done-to-parent-report.md` section 4.4, unchanged. Its own loading / empty / error states apply. A progress error must never break Pay or Book.

### 4.5 Tutor: Parent link card — `src/pages/StudentProfile.jsx`
Replaces the current "Booking link" section (line ~720, which still says "Parent booking page coming soon.") and the "🔗 Share payment summary" header button. Hidden for practitioners (`isPractitioner`).

```
Parent link
One private page for {guardian or "the parent"}: pay, progress and booking.   [Practice] (chip if is_practice)
https://chopeandpay.com/pay/<token>                       (mono, break-all)
[Copy link] [💬 Share via WhatsApp] [Preview] [Reset link]

Pay tab shows:   (•) PayNow QR and amounts  ( ) A note only  ( ) Hide the Pay tab
                 [note textarea, max 300, shown when "A note only"]  [Save]
Booking:         Off — [Turn on booking]      /   On — [Turn off booking]
```
- **Preview** opens `/pay/<token>` (relative path, new tab) so it works on deploy previews.
- **Share via WhatsApp** message: `Hi {guardian_name}! Here is {student}'s lesson page. You can see payments, progress and book lessons here: {url}` → `buildWhatsAppLink(message, student.guardian_contact)`.
- "Pay tab shows" maps to `students.portal_pay_mode`: `auto` / `note` / `hidden`. When the student is agency-collected (`payee_id` set and `fee_collected_by === "payee"`) the first option reads "PayNow QR and amounts (not available: {payee name} collects this student's fees)" and is disabled; show muted text "Parents see: Fees are collected by {payee name}."
- If `placement_fee_amount > 0` show an amber hint: "This student has a placement fee. If the agency collects the first lessons directly from the parent, choose 'A note only' until that is cleared."
- If the tutor has no PayNow number: amber hint "Add your PayNow number in Settings so parents get a QR code." If it is set but `parsePayNowProxy` returns null: "Your PayNow number doesn't look like a Singapore mobile or UEN, so parents will see it as text without a QR code. Check it in Settings."
- Booking on/off reuses `handleCreateBookingLink` / `handleToggleBookingLink` (existing). The separate `/book/...` URL is no longer displayed.
- **Reset link** opens a confirm modal: title "Reset this parent link?", body "The current link will stop working straight away, including any payment or booking links you've already sent for {student}. You'll need to send the new link.", buttons **Cancel** / **Reset link** (red). On success: toast "New link ready. The old one no longer works." and the URL updates. On error: red text inside the modal with the error message; modal stays open.
- Every save shows a visible error on failure (no silent failures).

### 4.6 Tutor: claims — `src/pages/Payments.jsx`, `src/pages/Dashboard.jsx`
- **Payments**, top of page, only when there are open claims: card "Parents say they've paid" with one row per claim: `{student name}` (+ "Practice" chip) · `{amount_claimed}` · muted `Ref {reference} · {claimed_at}`; if the student's current unpaid total (notices with `period_end <= covers_through`) differs from `amount_claimed`: amber "Notice is now {current}". Buttons: **Not received** (sets `dismissed`). Helper line under the card title: "Check your bank, then tap Mark as paid on the notice below. That clears the message."
- **Payments**, on each pending/overdue notice row whose student has an open claim and `period_end <= covers_through`: chip `🙋 Parent says paid · {claimed_at}` next to the status chip. The existing **Mark as paid** button is unchanged; after it succeeds, reload claims.
- **Dashboard**, right panel, directly under the "Booking requests alert" block (line ~1786), same visual pattern: `💸 {n} parent(s) say they've paid` / "Tap to check and confirm" → links to `/payments`.
- Empty state: no card, no alert (test this explicitly).

---

## 5. Data model

### 5.1 What exists today (verified 16 Nov 2026 against the repo and the live database `cdskiekviymkessedlem`)

| Thing | Where | Facts that matter |
|---|---|---|
| Pay link | `App.jsx` route `/pay/:token` → `PaymentSummary.jsx` → RPC `get_payment_summary(p_token)` (migrations 027, 035, 036) | SECURITY DEFINER, `LANGUAGE sql`, **no pinned search_path**, executable by anon. Looks up `students.payment_token`. Returns student name, subjects, tutor first name, PayNow number, and **all** cycles. Does not filter `deleted_at`. |
| `students.payment_token` | live | `text`, default `gen_random_uuid()::text` (36 chars, 122 random bits). 68 students, 0 nulls, 0 duplicates. **No unique constraint, no index.** Nothing rotates it today. |
| Agency branch on `/pay` | migration 036 | If `students.agency_placement_id` is set, returns `agencies.paynow_number` and `collected_by = agencies.name`. 0 students have a placement. A `handoff_after_n` switch back to the tutor was noted as deferred and never built. `PaymentSummary.jsx` never reads `collected_by`. |
| Payees (the agency set-up actually in use) | `payees` (migration 049): `id, tutor_id, name, share_percent, notes, archived` | **No payment details** (no PayNow/bank). `students.payee_id` + `students.fee_collected_by` (`'payee'`/`'me'`). Live: 13 students have a payee and `'payee'`; 2 have a payee and `'me'`. **`fee_collected_by` defaults to `'payee'` for every student (66 of 68), so it only means "agency collects" when `payee_id IS NOT NULL`** (`collectedBreakdown.js` line 93–96 uses the same rule). |
| Notices | `payment_cycles`: `id, tutor_id, student_id, period_start, period_end, amount_due, status (pending/paid/overdue/waived), paid_at, is_manual_closeout, waived_at, waived_from_status` | Live: 104 paid, 8 pending, 1 waived, 0 overdue. **`recompute_payment_cycles` (058) deletes and re-inserts pending non-manual cycles, so a pending cycle's `id` is not stable.** Anything attached to a pending cycle id would be lost. |
| Lessons in a notice | `lessons.payment_cycle_id`; amount per lesson = `rate` (per_session) or `duration_minutes/60 × rate`, falling back to `students.hourly_rate` (058 lines 104–107) | `lessons.notes` is tutor-private. `lessons.parent_summary` is AI text for parents (1 row live). |
| Waived bug | `PaymentSummary.jsx` lines 41–45, 112 | `status !== "paid"` treats **waived** as pending and counts it in "Outstanding". |
| Booking | `/book/:token` → `BookingPage.jsx` → Netlify functions `booking-page.js` (GET) and `booking-request.js` (POST) using the **service role key** | Token = `booking_links.token` (64 hex, unique, one row per student, `is_active`). 1 link, 5 requests live. Max 3 pending requests per student; DB exclusion constraint prevents overlaps; tutor confirms in `BookingRequests.jsx`. Functions do not check `students.archived` / `deleted_at`. |
| Progress | `lesson_topics` (0 rows live), `syllabus_topics` (83 rows), `ProgressReportModal.jsx` PDF | No parent-facing progress page exists. The other spec adds `lesson_reports` + `get_progress_summary(p_token)` (migration 061), keyed on the same `payment_token`. |
| Tutor PayNow | `tutors.paynow_number` free text ("PayNow number or UEN", `Settings.jsx` line ~766) | 5 of 40 tutors have one. Shapes live: 8 digits (×4) and one 9-digit value that is neither a valid mobile nor a UEN. |
| `students.is_practice` | migration 059, **not live yet** | This spec reads it defensively so it works before and after 059. |
| Global widgets | `App.jsx` mounts `FeedbackButton`, `InstallPromptBanner`, `OfflineBanner` for every route | They show on parent pages today. |
| No analytics scripts | `index.html` | Only Google Fonts is loaded from a third party. |

### 5.2 Design decisions

1. **One token: reuse `students.payment_token`.** The page lives at the URL parents already have. No second token to manage, old links keep working, and the other spec's `get_progress_summary` already uses it. New tokens (after a reset) are 64 hex characters. (Open question 1.)
2. **Booking keeps its own token and its own on/off switch.** `get_parent_portal` hands the active `booking_links.token` to the Book tab, which calls the existing Netlify functions unchanged. Zero changes to working booking code. A reset rotates both tokens together.
3. **Claims are a separate table keyed on the student**, because pending cycle ids are not stable (5.1). A claim records the amount, reference and the date range it covered.
4. **Claims close themselves** through a trigger when a notice becomes paid or waived. This avoids editing the three places that mark notices paid (`Payments.jsx` line 350, `Dashboard.jsx` line 977, `SettlementBoard.jsx` line 173). The trigger swallows its own errors so it can never block "Mark as paid".
5. **Agency-collected = note mode, enforced in SQL.** Amounts and the tutor's PayNow number are not sent to the browser at all in note mode.
6. **No earnings logic in SQL.** The function only reads `amount_due` and repeats the existing per-lesson fee expression for display. Agency share, placement-fee drain and take-home are not computed or exposed.

### 5.3 New and changed objects (migration 064)

| Object | Purpose |
|---|---|
| `students.portal_pay_mode text not null default 'auto'` (`auto`/`note`/`hidden`) | Tutor's choice for the Pay tab. |
| `students.portal_pay_note text` (≤ 300 chars) | Optional text for note mode. |
| `students.portal_token_rotated_at timestamptz` | When the link was last reset. |
| `students_payment_token_key` unique index; length check 32–80 | Token integrity and fast lookup. |
| `payment_claims` table + RLS | "Parent says they've paid" records. |
| `get_parent_portal(p_token text) → jsonb` | Anon read for one student. |
| `claim_parent_payment(p_token text, p_expected_total numeric) → jsonb` | Anon write, rate-limited. |
| `withdraw_parent_payment_claim(p_token text) → jsonb` | Anon undo. |
| `rotate_parent_link(p_student_id uuid) → text` | Tutor-only reset. |
| `resolve_payment_claims_on_cycle_close()` + trigger `on_payment_cycle_closed_resolve_claims` on `payment_cycles` | Auto-close claims. |
| `get_payment_summary` | Only `SET search_path`. Behaviour unchanged. |

Shape returned by `get_parent_portal` (this is the contract the frontend builds on):

```json
{
  "v": 1,
  "today": "2026-11-16",
  "student": { "name": "…", "is_practice": false, "archived": false },
  "guardian_name": "Mrs …" ,
  "tutor_name": "…",
  "subject": "IB Math AA SL",
  "pay": {
    "mode": "paynow | note | hidden",
    "paynow_proxy": "9123 4567",
    "collected_by": null,
    "note": null,
    "payment_mode": "monthly",
    "unpaid": [
      { "period_start": "2026-10-01", "period_end": "2026-10-31", "amount": 480,
        "lessons": [ { "date": "2026-10-06", "time": "16:00", "duration_minutes": 60, "subject": "…", "amount": 120.00 } ] }
    ],
    "total": 480.00,
    "reference": "JIAENLIM-OCT26",
    "claim": { "amount": 480.00, "claimed_at": "2026-11-16T12:14:00+00:00", "covers_through": "2026-10-31" },
    "history": [ { "period_start": "2026-09-01", "period_end": "2026-09-30", "amount": 360, "paid_on": "2026-10-02" } ]
  },
  "book": { "enabled": true, "token": "<64 hex>", "next_lesson": { "date": "2026-11-17", "time": "16:00", "duration_minutes": 60 } }
}
```
In `note` mode: `paynow_proxy`, `total`, `reference`, `claim` are null, `history` is `[]`, and every `amount` is null. In `hidden` mode `unpaid` is also `[]`. Nullable everywhere: `guardian_name`, `tutor_name`, `subject`, `time`, `next_lesson`, `claim`.

**Progress data consumed (owned by the other spec, not created here):** `get_progress_summary(p_token)` → `{ student_name, tutor_first_name, syllabus, ratings[], reports[], outline[] }`, i.e. per shared lesson: date, topics with ratings, strengths and next steps. This spec passes that JSON straight to `ParentProgress` and reads only `reports.length` (to decide whether to show the tab).

### 5.4 Migration file: `supabase/migrations/064_parent_portal.sql`

This SQL was run end to end on a scratch Postgres 16 database with stand-in tables (twice, to prove it is safe to re-run; with and without the `is_practice` column). It has **not** been run on the live database.

```sql
-- ============================================================
-- 064_parent_portal.sql
-- Parent portal (Pay / Progress / Book behind one private link).
-- Progress data is NOT in this migration: it comes from
-- get_progress_summary() in migration 061 (docs/specs/done-to-parent-report.md).
--
--  1. students: portal settings + unique index on payment_token
--     (the existing /pay token becomes the single parent-link token).
--  2. payment_claims: "parent says they've paid" records. Keyed on the
--     STUDENT, never on a payment_cycles.id, because
--     recompute_payment_cycles deletes and re-creates pending cycles
--     (their ids are not stable).
--  3. get_parent_portal(token)            anon read, one student only
--     claim_parent_payment(token, total)  anon write, rate-limited
--     withdraw_parent_payment_claim(token)
--     rotate_parent_link(student_id)      tutor only
--  4. Trigger on payment_cycles: when a notice becomes paid/waived,
--     close the matching open claim. Never blocks the update.
--
-- Does NOT touch recompute_payment_cycles, handle_lesson_change,
-- lessons, booking_requests, agency_* tables or the Netlify functions.
-- get_payment_summary is kept (old cached pages may still call it);
-- only its search_path is pinned.
--
-- Independent of migrations 059-063: students.is_practice (059) is read
-- defensively, and nothing here references lesson_reports (061).
-- Run manually in the Supabase SQL Editor (propose-stop-review-run).
-- ============================================================

BEGIN;

-- ── 0. Preconditions (abort early with a clear message) ──────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE payment_token IS NOT NULL
    GROUP BY payment_token HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate students.payment_token values found. Stop and investigate.';
  END IF;
END $$;

-- ── 1. students: portal settings ─────────────────────────────────────────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS portal_pay_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS portal_pay_note text,
  ADD COLUMN IF NOT EXISTS portal_token_rotated_at timestamptz;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_portal_pay_mode_check,
  ADD  CONSTRAINT students_portal_pay_mode_check
       CHECK (portal_pay_mode IN ('auto', 'note', 'hidden')),
  DROP CONSTRAINT IF EXISTS students_portal_pay_note_check,
  ADD  CONSTRAINT students_portal_pay_note_check
       CHECK (portal_pay_note IS NULL OR char_length(portal_pay_note) <= 300),
  DROP CONSTRAINT IF EXISTS students_payment_token_len_check,
  ADD  CONSTRAINT students_payment_token_len_check
       CHECK (payment_token IS NULL OR char_length(payment_token) BETWEEN 32 AND 80);

COMMENT ON COLUMN public.students.portal_pay_mode IS
  'Parent portal Pay tab. auto = tutor PayNow QR unless an agency collects (then a note); note = never show QR or amounts; hidden = no Pay tab.';
COMMENT ON COLUMN public.students.portal_pay_note IS
  'Optional text shown to the parent instead of the PayNow QR when the Pay tab is in note mode. Max 300 chars.';
COMMENT ON COLUMN public.students.portal_token_rotated_at IS
  'Last time the tutor reset this student''s parent link (rotate_parent_link).';

-- Every student gets a token (safety net; expected to update 0 rows).
UPDATE public.students
SET payment_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE payment_token IS NULL;

-- Token lookups must be unique and indexed.
CREATE UNIQUE INDEX IF NOT EXISTS students_payment_token_key
  ON public.students (payment_token);

-- ── 2. payment_claims ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id       uuid NOT NULL REFERENCES public.tutors(id)   ON DELETE CASCADE,
  student_id     uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  amount_claimed numeric(10, 2) NOT NULL CHECK (amount_claimed > 0),
  reference      text,
  covers_from    date NOT NULL,     -- earliest period_start of the notices claimed
  covers_through date NOT NULL,     -- latest period_end of the notices claimed
  notice_count   integer NOT NULL CHECK (notice_count > 0),
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'confirmed', 'dismissed', 'withdrawn')),
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

COMMENT ON TABLE public.payment_claims IS
  'A parent tapped "I''ve paid" on the parent portal. This is only a message to the tutor: it never changes payment_cycles. open = waiting for tutor; confirmed = tutor marked the notice(s) paid/waived; dismissed = tutor says not received; withdrawn = parent tapped "I haven''t paid yet".';

-- At most one open claim per student (also the concurrency guard).
CREATE UNIQUE INDEX IF NOT EXISTS payment_claims_one_open_per_student
  ON public.payment_claims (student_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS payment_claims_tutor_status_idx
  ON public.payment_claims (tutor_id, status);
CREATE INDEX IF NOT EXISTS payment_claims_student_claimed_idx
  ON public.payment_claims (student_id, claimed_at DESC);

ALTER TABLE public.payment_claims ENABLE ROW LEVEL SECURITY;

-- Tutors: read, update (dismiss) and delete their own claims.
-- INSERT: deliberately NO policy. Claims are only ever created by
-- claim_parent_payment() (SECURITY DEFINER). The app never inserts directly.
-- anon: NO policies at all.
DROP POLICY IF EXISTS "Tutors read own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors read own payment claims"
  ON public.payment_claims FOR SELECT TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Tutors update own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors update own payment claims"
  ON public.payment_claims FOR UPDATE TO authenticated
  USING (tutor_id = (SELECT auth.uid()))
  WITH CHECK (tutor_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Tutors delete own payment claims" ON public.payment_claims;
CREATE POLICY "Tutors delete own payment claims"
  ON public.payment_claims FOR DELETE TO authenticated
  USING (tutor_id = (SELECT auth.uid()));

REVOKE ALL ON public.payment_claims FROM anon;
GRANT SELECT, UPDATE, DELETE ON public.payment_claims TO authenticated;

-- ── 3a. get_parent_portal ────────────────────────────────────────────────────
-- Everything the parent page needs for ONE student, looked up by token.
-- Returns NULL for an unknown / reset / deleted-student token.
-- Never returns: ids, tutor email, guardian contact, lessons.notes,
-- parent_summary, hourly rates, other students, or agency share figures.
CREATE OR REPLACE FUNCTION public.get_parent_portal(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s             public.students%ROWTYPE;
  v_today       date := (now() AT TIME ZONE 'Asia/Singapore')::date;
  v_tutor_name  text;
  v_paynow      text;
  v_payee_name  text;
  v_agency      boolean;
  v_mode        text;
  v_subject     text;
  v_unpaid      jsonb := '[]'::jsonb;
  v_total       numeric(10, 2) := 0;
  v_latest_end  date;
  v_reference   text;
  v_claim       jsonb;
  v_history     jsonb := '[]'::jsonb;
  v_book_token  text;
  v_next        jsonb;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO s
  FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT t.full_name, nullif(btrim(t.paynow_number), '')
  INTO v_tutor_name, v_paynow
  FROM tutors t WHERE t.id = s.tutor_id;

  -- Subjects: same rule as get_payment_summary (035).
  SELECT coalesce(
           nullif(btrim((SELECT string_agg(ss.subject, ', ' ORDER BY ss.created_at)
                         FROM student_subjects ss WHERE ss.student_id = s.id)), ''),
           s.subject)
  INTO v_subject;

  -- Who collects the fee?
  --   payee set-up A : payee_id set AND fee_collected_by = 'payee'  -> agency collects
  --   legacy platform: agency_placement_id set (migration 036)       -> agency collects
  --   otherwise the tutor collects.
  -- NOTE: fee_collected_by DEFAULTS to 'payee' for every student, so it only
  -- means "agency collects" when payee_id is also set.
  v_agency := (s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee')
              OR s.agency_placement_id IS NOT NULL;

  IF s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee' THEN
    SELECT p.name INTO v_payee_name FROM payees p
    WHERE p.id = s.payee_id AND p.tutor_id = s.tutor_id;
  ELSIF s.agency_placement_id IS NOT NULL THEN
    SELECT a.name INTO v_payee_name
    FROM agency_placements ap JOIN agencies a ON a.id = ap.agency_id
    WHERE ap.id = s.agency_placement_id;
  END IF;

  v_mode := CASE
    WHEN s.portal_pay_mode = 'hidden' THEN 'hidden'
    WHEN s.portal_pay_mode = 'note' OR v_agency THEN 'note'
    ELSE 'paynow'
  END;

  -- Unpaid notices (pending / overdue, amount > 0). Waived is never shown.
  -- Amounts are withheld server-side unless the tutor collects (mode paynow).
  IF v_mode <> 'hidden' THEN
    SELECT
      coalesce(jsonb_agg(jsonb_build_object(
        'period_start', pc.period_start,
        'period_end',   pc.period_end,
        'amount',       CASE WHEN v_mode = 'paynow' THEN pc.amount_due END,
        'lessons', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'date',             l.lesson_date,
                   'time',             to_char(l.lesson_time, 'HH24:MI'),
                   'duration_minutes', l.duration_minutes,
                   'subject',          l.subject,
                   -- Same expression as recompute_payment_cycles (058). Display only.
                   'amount', CASE WHEN v_mode = 'paynow' THEN round(
                               CASE WHEN l.rate_type = 'per_session'
                                    THEN coalesce(l.rate, s.hourly_rate, 0)
                                    ELSE (l.duration_minutes / 60.0) * coalesce(l.rate, s.hourly_rate, 0)
                               END, 2) END
                 ) ORDER BY l.lesson_date, l.lesson_time NULLS LAST, l.created_at), '[]'::jsonb)
          FROM lessons l
          WHERE l.payment_cycle_id = pc.id AND l.student_id = s.id
        )
      ) ORDER BY pc.period_end, pc.created_at), '[]'::jsonb),
      coalesce(sum(pc.amount_due), 0),
      max(pc.period_end)
    INTO v_unpaid, v_total, v_latest_end
    FROM payment_cycles pc
    WHERE pc.student_id = s.id
      AND pc.status IN ('pending', 'overdue')
      AND pc.amount_due > 0;
  END IF;

  IF v_mode = 'paynow' THEN
    -- PayNow reference, e.g. JIAENLIM-OCT26 (name, letters/digits only, max 12
    -- chars + month of the latest unpaid notice). Max 18 chars; PayNow allows 25.
    IF v_latest_end IS NOT NULL THEN
      v_reference := coalesce(
          nullif(left(upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')), 12), ''),
          'LESSONS')
        || '-' || upper(to_char(v_latest_end, 'MONYY'));
    END IF;

    -- An open "I've paid" claim only counts while a notice it covers is still unpaid.
    SELECT jsonb_build_object(
             'amount',         c.amount_claimed,
             'claimed_at',     c.claimed_at,
             'covers_through', c.covers_through)
    INTO v_claim
    FROM payment_claims c
    WHERE c.student_id = s.id AND c.status = 'open'
      AND EXISTS (
        SELECT 1 FROM payment_cycles pc
        WHERE pc.student_id = s.id
          AND pc.status IN ('pending', 'overdue')
          AND pc.amount_due > 0
          AND pc.period_end <= c.covers_through);

    -- Receipts: the 6 most recent paid notices.
    SELECT coalesce(jsonb_agg(h.obj ORDER BY h.paid_at DESC NULLS LAST, h.period_end DESC), '[]'::jsonb)
    INTO v_history
    FROM (
      SELECT pc.paid_at, pc.period_end,
             jsonb_build_object(
               'period_start', pc.period_start,
               'period_end',   pc.period_end,
               'amount',       pc.amount_due,
               'paid_on',      (pc.paid_at AT TIME ZONE 'Asia/Singapore')::date) AS obj
      FROM payment_cycles pc
      WHERE pc.student_id = s.id AND pc.status = 'paid'
      ORDER BY pc.paid_at DESC NULLS LAST, pc.period_end DESC
      LIMIT 6
    ) h;
  ELSE
    v_total := NULL;
  END IF;

  -- Booking: on only when the tutor has an ACTIVE booking link and the
  -- student is not archived. The token is the existing booking_links token;
  -- the Book tab calls the existing Netlify functions with it.
  IF NOT s.archived THEN
    SELECT bl.token INTO v_book_token
    FROM booking_links bl
    WHERE bl.student_id = s.id AND bl.tutor_id = s.tutor_id AND bl.is_active;
  END IF;

  SELECT jsonb_build_object(
           'date',             l.lesson_date,
           'time',             to_char(l.lesson_time, 'HH24:MI'),
           'duration_minutes', l.duration_minutes)
  INTO v_next
  FROM lessons l
  WHERE l.student_id = s.id
    AND l.lesson_date >= v_today
    AND NOT coalesce(l.is_completed, false)
    AND l.status IS DISTINCT FROM 'cancelled'
  ORDER BY l.lesson_date, l.lesson_time NULLS LAST
  LIMIT 1;

  RETURN jsonb_build_object(
    'v', 1,
    'today', v_today,
    'student', jsonb_build_object(
      'name',        btrim(s.name),
      -- Read through to_jsonb so this works before AND after migration 059
      -- adds students.is_practice (missing column = not a practice student).
      'is_practice', coalesce((to_jsonb(s) ->> 'is_practice')::boolean, false),
      'archived',    s.archived),
    'guardian_name', nullif(btrim(s.guardian_name), ''),
    'tutor_name',    nullif(btrim(v_tutor_name), ''),
    'subject',       v_subject,
    'pay', jsonb_build_object(
      'mode',         v_mode,
      'paynow_proxy', CASE WHEN v_mode = 'paynow' THEN v_paynow END,
      'collected_by', CASE WHEN v_mode = 'note' THEN v_payee_name END,
      'note',         CASE WHEN v_mode = 'note' THEN nullif(btrim(s.portal_pay_note), '') END,
      'payment_mode', s.payment_mode,
      'unpaid',       v_unpaid,
      'total',        v_total,
      'reference',    v_reference,
      'claim',        v_claim,
      'history',      v_history),
    'book', jsonb_build_object(
      'enabled',     v_book_token IS NOT NULL,
      'token',       v_book_token,
      'next_lesson', v_next)
  );
END;
$$;

-- ── 3b. claim_parent_payment ─────────────────────────────────────────────────
-- Parent taps "I've paid $X". Records a claim for the tutor to check.
-- NEVER changes payment_cycles. The amount is computed here, not trusted
-- from the browser; p_expected_total is only a "has the bill changed since
-- you loaded the page?" check.
-- Returns {ok, code}. Codes: claimed | already | not_found | not_allowed |
-- nothing_due | changed | too_many.
CREATE OR REPLACE FUNCTION public.claim_parent_payment(p_token text, p_expected_total numeric)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  s         public.students%ROWTYPE;
  v_total   numeric(10, 2);
  v_from    date;
  v_through date;
  v_count   integer;
  v_recent  integer;
  v_ref     text;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT * INTO s FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Claims only make sense when the parent pays the tutor directly.
  IF s.portal_pay_mode <> 'auto'
     OR (s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee')
     OR s.agency_placement_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_allowed');
  END IF;

  -- One claim action at a time per student (double-taps, two phones).
  PERFORM pg_advisory_xact_lock(hashtextextended('payment_claim:' || s.id::text, 0));

  IF EXISTS (SELECT 1 FROM payment_claims c WHERE c.student_id = s.id AND c.status = 'open') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already');
  END IF;

  -- Abuse guard: at most 5 claims per student per rolling 24 hours
  -- (withdrawn / dismissed ones count).
  SELECT count(*) INTO v_recent
  FROM payment_claims c
  WHERE c.student_id = s.id AND c.claimed_at > now() - interval '24 hours';
  IF v_recent >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'too_many');
  END IF;

  SELECT coalesce(sum(pc.amount_due), 0), min(pc.period_start), max(pc.period_end), count(*)
  INTO v_total, v_from, v_through, v_count
  FROM payment_cycles pc
  WHERE pc.student_id = s.id
    AND pc.status IN ('pending', 'overdue')
    AND pc.amount_due > 0;

  IF v_count = 0 OR v_total <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'nothing_due');
  END IF;

  IF p_expected_total IS NULL OR round(p_expected_total, 2) <> v_total THEN
    RETURN jsonb_build_object('ok', false, 'code', 'changed');
  END IF;

  v_ref := coalesce(
      nullif(left(upper(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')), 12), ''),
      'LESSONS')
    || '-' || upper(to_char(v_through, 'MONYY'));

  INSERT INTO payment_claims
    (tutor_id, student_id, amount_claimed, reference, covers_from, covers_through, notice_count)
  VALUES
    (s.tutor_id, s.id, v_total, v_ref, v_from, v_through, v_count);

  RETURN jsonb_build_object('ok', true, 'code', 'claimed');
END;
$$;

-- ── 3c. withdraw_parent_payment_claim ────────────────────────────────────────
-- Parent taps "I haven't paid yet". Idempotent.
CREATE OR REPLACE FUNCTION public.withdraw_parent_payment_claim(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id uuid;
BEGIN
  IF p_token IS NULL OR char_length(p_token) < 32 OR char_length(p_token) > 80 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  SELECT id INTO v_student_id FROM students
  WHERE payment_token = p_token AND deleted_at IS NULL;
  IF v_student_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  UPDATE payment_claims
  SET status = 'withdrawn', resolved_at = now()
  WHERE student_id = v_student_id AND status = 'open';

  RETURN jsonb_build_object('ok', true, 'code', 'withdrawn');
END;
$$;

-- ── 3d. rotate_parent_link (tutor only) ──────────────────────────────────────
-- "Reset link": gives the student a brand-new token. The old parent link,
-- old /pay link and old /book link all stop working immediately.
-- Returns the new token.
CREATE OR REPLACE FUNCTION public.rotate_parent_link(p_student_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner uuid;
  v_new   text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  SELECT tutor_id INTO v_owner FROM students WHERE id = p_student_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You do not own this student.';
  END IF;

  UPDATE students
  SET payment_token = v_new, portal_token_rotated_at = now()
  WHERE id = p_student_id;

  -- The booking token travels inside the portal, so it must change too.
  UPDATE booking_links
  SET token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  WHERE student_id = p_student_id AND tutor_id = v_owner;

  RETURN v_new;
END;
$$;

-- ── 3e. Permissions on the functions ─────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_parent_portal(text)                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_parent_payment(text, numeric)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_parent_payment_claim(text)     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rotate_parent_link(uuid)                FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_parent_portal(text)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_parent_payment(text, numeric)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_parent_payment_claim(text)  TO anon, authenticated;
REVOKE ALL ON FUNCTION public.rotate_parent_link(uuid)                FROM anon;
GRANT EXECUTE ON FUNCTION public.rotate_parent_link(uuid)             TO authenticated;

-- ── 4. Auto-close claims when the tutor marks a notice paid / waived ─────────
CREATE OR REPLACE FUNCTION public.resolve_payment_claims_on_cycle_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    UPDATE payment_claims c
    SET status = 'confirmed', resolved_at = now()
    WHERE c.student_id = NEW.student_id
      AND c.status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM payment_cycles pc
        WHERE pc.student_id = NEW.student_id
          AND pc.id <> NEW.id
          AND pc.status IN ('pending', 'overdue')
          AND pc.amount_due > 0
          AND pc.period_end <= c.covers_through);
  EXCEPTION WHEN OTHERS THEN
    -- Never let claim bookkeeping block "Mark as paid".
    RAISE WARNING 'resolve_payment_claims_on_cycle_close: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_payment_claims_on_cycle_close() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_payment_claims_on_cycle_close() FROM anon, authenticated;

DROP TRIGGER IF EXISTS on_payment_cycle_closed_resolve_claims ON public.payment_cycles;
CREATE TRIGGER on_payment_cycle_closed_resolve_claims
  AFTER UPDATE OF status ON public.payment_cycles
  FOR EACH ROW
  WHEN (NEW.status IN ('paid', 'waived') AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.resolve_payment_claims_on_cycle_close();

-- ── 5. Harden the legacy function (behaviour unchanged) ──────────────────────
ALTER FUNCTION public.get_payment_summary(text) SET search_path = public, pg_temp;

COMMIT;
```

### 5.5 Verification queries (run after the migration; all read-only)

```sql
-- 1. New columns exist with the right defaults (expect 3 rows).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'students'
  AND column_name IN ('portal_pay_mode', 'portal_pay_note', 'portal_token_rotated_at')
ORDER BY 1;

-- 2. Every student has a unique token of legal length (expect: total = distinct, 0 bad).
SELECT count(*) AS total, count(DISTINCT payment_token) AS distinct_tokens,
       count(*) FILTER (WHERE payment_token IS NULL OR char_length(payment_token) NOT BETWEEN 32 AND 80) AS bad
FROM students;

-- 3. payment_claims: RLS on, exactly 3 policies (SELECT, UPDATE, DELETE), all for authenticated.
SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_claims'::regclass;
SELECT policyname, cmd, roles::text FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'payment_claims' ORDER BY cmd;

-- 4. Functions: security definer, pinned search_path, correct callers.
SELECT p.proname, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute')          AS anon_can,
       has_function_privilege('authenticated', p.oid, 'execute') AS auth_can
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_parent_portal', 'claim_parent_payment', 'withdraw_parent_payment_claim',
                    'rotate_parent_link', 'resolve_payment_claims_on_cycle_close', 'get_payment_summary')
ORDER BY 1;
-- Expect: all prosecdef = true, all proconfig contain search_path=public, pg_temp.
-- anon_can: true for get_parent_portal, claim_parent_payment, withdraw_parent_payment_claim, get_payment_summary;
--           false for rotate_parent_link and resolve_payment_claims_on_cycle_close.

-- 5. Trigger exists on payment_cycles (expect 1 row).
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.payment_cycles'::regclass AND NOT tgisinternal;

-- 6. anon has no table privilege on payment_claims (expect false, false).
SELECT has_table_privilege('anon', 'public.payment_claims', 'select'),
       has_table_privilege('anon', 'public.payment_claims', 'insert');

-- 7. Smoke test with a real token of YOUR practice/test student (paste the token).
--    Expect one JSON object; check there is no email, no uuid, no "notes".
SELECT jsonb_pretty(get_parent_portal('<paste token here>'));
SELECT get_parent_portal('00000000-0000-0000-0000-000000000000') IS NULL AS unknown_token_is_null;  -- expect true
```

---

## 6. Logic and edge cases

### 6.1 What counts as "to pay"
- Unpaid = `payment_cycles.status IN ('pending','overdue') AND amount_due > 0`. Waived notices are never shown to parents. Paid notices appear only as receipts (latest 6).
- Lessons that are completed but not yet in a notice (e.g. 2 of 4 lessons done; current month before month-end) are **not** shown as owed. The portal shows what the tutor's Payments page shows as pending.
- Archived students: page works (they may still owe); Book shows "Lessons … have ended". Soft-deleted students (`deleted_at` set): link is "not active". Their money still counts in the tutor's reports as today; nothing changes there.
- Practice students: everything works; banner shown; the tutor-side claim row carries a "Practice" chip. Claims are not money, so no recap/report figure is affected. Practice students' QR codes are real: the banner tells people not to pay.
- Agency set-up A (payee collects): note mode, no amounts, no claims. Set-up B (`fee_collected_by = 'me'`): normal PayNow mode for the full fee; the tutor's commission to the agency is never shown.
- Placement fees: not modelled here. `amount_due` is the full fee for the notice. If the agency collects the first lessons directly, the tutor chooses "A note only" for that period (hint in 4.5; Open question 3).
- Legacy `agency_placement_id` (0 rows): treated as note mode with the agency's name. The deferred "handoff after N lessons" switch from migration 036 stays deferred.

### 6.2 PayNow QR payload (new `src/lib/paynowQr.js`, pure functions, no imports)

Format: EMVCo Merchant-Presented QR as used by SGQR/PayNow. Every field is `ID (2 digits) + length (2 digits, zero-padded, counted in characters) + value`.

| ID | Value | Notes |
|---|---|---|
| `00` | `01` | Payload format indicator |
| `01` | `12` | Point of initiation: dynamic (single payment) |
| `26` | nested ↓ | Merchant account information for PayNow |
| `26`.`00` | `SG.PAYNOW` | |
| `26`.`01` | `0` mobile, `2` UEN | Proxy type |
| `26`.`02` | `+65XXXXXXXX` or the UEN | Proxy value |
| `26`.`03` | `0` | **Amount editable = false** |
| `26`.`04` | (omitted) | Optional expiry `YYYYMMDD`; left out so a late payer's QR still works |
| `52` | `0000` | Merchant category code |
| `53` | `702` | Currency SGD |
| `54` | e.g. `480.00` | Amount, always 2 decimals, no separators |
| `58` | `SG` | Country |
| `59` | `NA` | Merchant name (the bank shows the registered PayNow name itself) |
| `60` | `Singapore` | City |
| `62` | nested `01` = reference | Bill number, max 25 chars; whole field omitted when the reference is empty |
| `63` | 4 hex chars | CRC, always last |

CRC: CRC-16/CCITT-FALSE (polynomial `0x1021`, initial value `0xFFFF`, no reflection, no final XOR) over the whole string **including** the trailing `6304`, written as 4 upper-case hex characters.

Proxy parsing from the free-text `tutors.paynow_number`: remove spaces and hyphens, upper-case, then
- mobile: optional `+65` or `65`, then 8 digits starting with 8 or 9 → type `0`, value `+65` + the 8 digits;
- UEN: `^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])([A-Z0-9]{3})?$` → type `2`, value as typed (upper-case);
- anything else (NRIC, landline, 9 digits, text) → `null` → no QR, show the number as text.

Reference implementation (copy exactly; the test vectors below were generated with it, and its CRC routine reproduces the published checksum `A177` of the sample payload in the open-source Python PayNow generator README):

```js
export function crc16ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (id, value) => id + String(value.length).padStart(2, "0") + value;

export function parsePayNowProxy(raw) {
  if (!raw) return null;
  const compact = String(raw).trim().replace(/[\s-]/g, "").toUpperCase();
  const m = compact.match(/^(?:\+?65)?([89]\d{7})$/);
  if (m) return { type: "0", value: "+65" + m[1] };
  if (/^(\d{8}[A-Z]|\d{9}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])([A-Z0-9]{3})?$/.test(compact)) {
    return { type: "2", value: compact };
  }
  return null;
}

export function sanitizeReference(ref) {
  return String(ref ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 25);
}

// Returns the payload string, or null when no valid QR can be made.
export function buildPayNowPayload({ proxy, amount, reference }) {
  const p = parsePayNowProxy(proxy);
  const cents = Math.round(Number(amount) * 100);
  if (!p || !Number.isFinite(cents) || cents <= 0 || cents > 99999999) return null;
  const amt = (cents / 100).toFixed(2);
  const ref = sanitizeReference(reference);
  const mai = tlv("00", "SG.PAYNOW") + tlv("01", p.type) + tlv("02", p.value) + tlv("03", "0");
  let s = tlv("00", "01") + tlv("01", "12") + tlv("26", mai) + tlv("52", "0000") +
          tlv("53", "702") + tlv("54", amt) + tlv("58", "SG") + tlv("59", "NA") + tlv("60", "Singapore");
  if (ref) s += tlv("62", tlv("01", ref));
  s += "6304";
  return s + crc16ccitt(s);
}
```

Test vectors (must match character for character):

| proxy | amount | reference | expected `buildPayNowPayload` |
|---|---|---|---|
| `9123 4567` | 480 | `JIAENLIM-OCT26` | `00020101021226380009SG.PAYNOW010100211+6591234567030105204000053037025406480.005802SG5902NA6009Singapore62180114JIAENLIM-OCT266304DC61` |
| `+6581234567` | 120.5 | `ALEX-NOV26` | `00020101021226380009SG.PAYNOW010100211+6581234567030105204000053037025406120.505802SG5902NA6009Singapore62140110ALEX-NOV2663044E55` |
| `201912345K` | 1234.56 | `SAMTAN-SEP26` | `00020101021226370009SG.PAYNOW010120210201912345K0301052040000530370254071234.565802SG5902NA6009Singapore62160112SAMTAN-SEP26630457B9` |
| `53312345A` | 90 | (empty) | `00020101021226360009SG.PAYNOW01012020953312345A03010520400005303702540590.005802SG5902NA6009Singapore63049BD5` |
| `123456789` | 90 | `X` | `null` |
| `91234567` | 0 | `X` | `null` |

Also: `crc16ccitt("123456789") === "29B1"`; `parsePayNowProxy("6591234567")` → `{type:"0", value:"+6591234567"}`; `parsePayNowProxy("61234567")` → `null`; `parsePayNowProxy("S1234567D")` → `null`.

Drawing the QR: add the npm package `qrcode-generator` (MIT, no dependencies). `const qr = qrcode(0, "M"); qr.addData(payload); qr.make();` then draw on an off-screen `<canvas>`: 8px per module, 4-module white quiet zone, navy `#1b2d4f` modules on white, using `qr.getModuleCount()` and `qr.isDark(row, col)`. Convert with `canvas.toDataURL("image/png")` and show it in an `<img>`. Compute inside `useMemo` keyed on the payload.

The reference string comes from the database (`pay.reference`), so the parent's bank reference and the tutor's claim row always match. Format: student name with everything except letters/digits removed, upper-case, first 12 characters, then `-MONYY` of the latest unpaid notice's `period_end` (e.g. `JIAENLIM-OCT26`); `LESSONS-OCT26` if the name has no letters or digits.

Display number for the "PayNow to" row: mobile → the 8 digits grouped `9123 4567`; UEN → as is; unparseable → the raw text.

### 6.3 Claims
- One open claim per student (unique partial index + advisory lock inside the function). Double taps and two phones produce one row; the second caller gets `already`.
- The claim amount is computed in the database from the unpaid notices. The browser sends only the total it was showing; if that no longer matches (a lesson was completed in between) the function returns `changed` and nothing is saved.
- Rate limit: 5 claims per student per rolling 24 hours, counting withdrawn and dismissed ones → `too_many`. There is no free-text field, so a claim can never carry abusive content.
- A claim "covers" unpaid notices with `period_end <= covers_through`. The parent page shows the thank-you state only while such a notice is still unpaid.
- Auto-close: when any notice of the student changes to `paid` or `waived`, open claims with no remaining covered unpaid notice become `confirmed`. Marking one of two claimed notices paid leaves the claim open until the second is closed too.
- If a paid notice is ever set back to pending (the app has no button for this today; undoing a waive is the nearest case): the claim stays `confirmed` (history is not rewritten). The parent page then shows State A again; the parent can tap again if needed.
- Recompute deletes/recreates pending notices: claims are unaffected (keyed on student + dates). If recompute leaves the student with nothing unpaid, the claim stays `open` on the tutor side until **Not received** is tapped, and is ignored on the parent side.
- Tutor "Not received": `update payment_claims set status = 'dismissed', resolved_at = <now>` for that `id` and `tutor_id`. Parent page returns to State A.
- Claims never touch `payment_cycles`, lessons, recaps, statements or the year-end report.

### 6.4 Time
- "Today" in SQL is `(now() AT TIME ZONE 'Asia/Singapore')::date`. `paid_on` is converted to an SGT date in SQL. `claimed_at` is an instant and is formatted in the browser with `timeZone: "Asia/Singapore"`.
- Writing `resolved_at` from the browser with `new Date().toISOString()` is fine: it is an instant, not a calendar date. (The "+08:00, never Z" rule applies to lesson dates/times and calendar sync, none of which this feature writes.)

### 6.5 Limits and idempotency
- `get_parent_portal` output is bounded: receipts 6; unpaid notices are few by nature (8 pending in the whole database today). No paging needed.
- Tutor-side claims query: `.eq("status","open").order("claimed_at",{ascending:false}).limit(200)`.
- `withdraw_parent_payment_claim` and `rotate_parent_link` are safe to call twice. The migration is safe to re-run.

### 6.6 Booking embed
- Refactor `src/pages/BookingPage.jsx` without changing behaviour: move the page body into an exported `BookingPanel({ token, embedded = false })`; the default export becomes `() => <BookingPanel token={useParams().token} />`.
- When `embedded` is true: do not render the navy header or the `min-h-screen` wrappers; the inactive/error states render as a small card instead of a full-screen one; the "Your upcoming lessons" section still shows.
- All fetches stay exactly as they are (`/.netlify/functions/booking-page?token=…`, `POST /.netlify/functions/booking-request`). `/book/:token` must look and behave exactly as before.

### 6.7 Routing and rollout order
- Phases 2–5 mount the new page on `/parent/:token` only, so the live `/pay/:token` page is untouched while you test.
- Phase 6 points `/pay/:token` at the new page (both routes stay). All generated links keep using `/pay/` (`buildPaymentSummaryUrl` in `src/lib/whatsapp.js` is unchanged), so the other specs' links (`/pay/<token>?tab=progress`) work.
- Coordination with done-to-parent-report phase 4 (which adds a Pay | Progress tab bar to `PaymentSummary.jsx`): whichever merges second adapts. If their phase 4 is already merged, this spec's phase 5 imports their `ParentProgress` and phase 6 retires their tab bar along with `PaymentSummary.jsx`. If this portal merges first, their phase 4 step 4 becomes "mount `ParentProgress` in `ParentPortal.jsx`" (their Open question 8 already allows for this).

---

## 7. Security / RLS review

### 7.1 Threat list

| # | Threat | Mitigation |
|---|---|---|
| T1 | Guessing or enumerating tokens | 122 random bits (existing) or 244 bits (after reset); unique index; identical "not active" answer for wrong, reset and deleted tokens; no hints in errors. |
| T2 | One parent seeing another student | Every function resolves exactly one student row from the token and filters every sub-query by that `student_id`. No function accepts a student id, cycle id or tutor id from anon. No ids are returned, so there is nothing to tamper with. |
| T3 | Anon reading tables directly | No anon policies are added anywhere. `payment_claims`: RLS on, anon privileges revoked. Verification queries 3 and 6. |
| T4 | Leaking tutor-private data | Function never selects `tutors.email`, `guardian_contact`, `lessons.notes`, `parent_summary`, `students.notes`, `address`, hourly rate fields, payee share %, placement fees, Stripe or Google fields. Scratch-DB test confirmed the output contains no email, uuid or private note. |
| T5 | Leaking the tutor's PayNow number or amounts to agency-collected families | Note mode nulls `paynow_proxy`, `total`, every `amount`, `history` in SQL. |
| T6 | Parent marks themselves as paid | Impossible: claim functions only write `payment_claims`. `payment_cycles` is only changed by the tutor's existing authenticated updates. |
| T7 | Claim spam / nuisance | One open claim per student, 5 per 24 h, amount computed server-side, no free text, nothing is pushed/emailed. Tutor can dismiss, or reset the link. |
| T8 | Link forwarded or leaked (WhatsApp group, screenshot) | **Reset link** rotates the pay token and the booking token in one transaction; `portal_token_rotated_at` records it. |
| T9 | Token leaking through the Referer header, search engines or shared caches | `<meta name="referrer" content="no-referrer">`, `noindex` meta, Netlify headers `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: no-store` for `/pay/*`, `/parent/*`, `/book/*`; no outbound links on the page; tokens for writes travel in POST bodies. |
| T10 | search_path hijack of SECURITY DEFINER functions | All new functions `SET search_path = public, pg_temp`; legacy `get_payment_summary` gets the same pin. |
| T11 | Another tutor resetting or reading someone's link/claims | `rotate_parent_link` checks `auth.uid()` owns the student and is not executable by anon; claim policies are `tutor_id = auth.uid()`. Tested on scratch DB. |
| T12 | Tutor signed in on the same phone opens a parent link | Functions are granted to `authenticated` too and never use `auth.uid()` for lookups, so the result is identical. |
| T13 | HTML/script injection through names or notes | React escapes all text; no `dangerouslySetInnerHTML`; `portal_pay_note` rendered as text with `whitespace-pre-line`; QR reference restricted to `A–Z 0–9 -`. |
| T14 | Wrong-amount or wrong-recipient QR | Amount locked (`26.03 = 0`); payload built only from DB values; invalid proxy → no QR rather than a guessed one; CRC test vectors; acceptance test scans with a real banking app. |
| T15 | Trigger breaking "Mark as paid" | Trigger body is wrapped in `EXCEPTION WHEN OTHERS` and only writes `payment_claims`. |
| T16 | Booking token exposed inside the portal response | Intended: it is the same family, and booking still requires the tutor to confirm. It is rotated with the portal token. |
| T17 | Agency-platform owners can read `students` rows of their placed students (existing policy), which includes `payment_token` | 0 placements exist. Noted for whoever revives that platform: exclude the token column or move tokens to their own table first. |
| T18 | Old links gain new powers (a link sent for payment now also shows Book, and Progress once shared) | Same audience (the family). Booking needs tutor confirmation; Progress shows only reports the tutor chose to share. Tutor can reset any link. Open question 1. |

### 7.2 Checklist for the reviewer
- [ ] Migration creates no policy with `TO anon` or `TO public` and no `USING (true)`.
- [ ] `payment_claims` has SELECT/UPDATE/DELETE policies for `authenticated` scoped to `tutor_id = (select auth.uid())`; the missing INSERT policy is deliberate and commented.
- [ ] All four RPC functions: `SECURITY DEFINER`, pinned search_path, `REVOKE ALL … FROM PUBLIC`, explicit grants.
- [ ] `rotate_parent_link` not executable by anon.
- [ ] No policy on any existing table is changed; no existing function body is changed (only `ALTER FUNCTION … SET search_path` on `get_payment_summary`).
- [ ] `ParentPortal.jsx`, `PayTab.jsx`, `BookTab.jsx` contain no `supabase.from(` calls: RPC and the two existing Netlify functions only.
- [ ] Tutor code touches only `payment_claims`, `students` (own rows) and `booking_links` (own rows); nothing in agency (`AgencyDashboard.jsx`, `agency_*`) or practitioner files (`practitioner.js`, `terminology.js`).
- [ ] Supabase's security advisor will list the three anon-callable SECURITY DEFINER functions. That is expected and by design (same as `get_payment_summary` today).

---

## 8. Acceptance tests

Use a **test student of your own** (ideally a practice student once 059 is live) with your own number as guardian. Previews use the live database. `P` = the preview base URL, `TOKEN` = that student's token (Student profile → Share payment summary copies a link ending in it).

### After phase 1 (schema)
1. Run verification queries 1–7 in section 5.5. All results as stated.
2. Open the live app: Dashboard, Payments, Student profile load as before. Mark one notice of a test student paid (there is no un-pay button, so use a test student). It saves with no error (proves the new trigger does not interfere). Waive another test notice and undo the waive: no error.
3. Open an existing `https://chopeandpay.com/pay/TOKEN`. The old page still works.

### After phase 2 (page + Pay tab, on `/parent/`)
4. In a private window open `P/parent/TOKEN`. Header shows the student's name and your name. No Feedback button, no install banner.
5. With one pending notice: hero amount equals the notice amount on your Payments page. "What this covers" lists the same lessons, and the lesson amounts add up to the total.
6. Scan the QR with a banking app on another phone. The app shows your PayNow name, the amount (not editable) and the reference. **Do not confirm the payment.**
7. On a phone, open the link from inside WhatsApp. Tap each **Copy**; paste into Notes: number, amount (e.g. `480.00`), reference. Tap **Save QR to photos** (or press and hold the QR) and check the image is in Photos.
8. `P/parent/TOKEN` with the last character changed → "This link isn't active any more…". `P/parent/abc` → same message.
9. Turn on flight mode and reload → "We couldn't load this page just now…" with **Try again**; turn flight mode off, tap it → page loads.
10. Student with no pending notices → "All paid up. Thank you!" and "Recent payments" rows.
11. Student with a **waived** notice → the waived notice appears nowhere and is not in any total.
12. Agency-collected test student (has a payee, "agency collects") → "Fees for … are collected by {payee}." No amounts, no QR, no button. Open the browser's Network tab, look at the `get_parent_portal` response: `paynow_proxy` is null and every `amount` is null.
13. In Settings temporarily clear your PayNow number → page shows "Please pay {you} the usual way…" with Amount and Reference rows, no QR. Put the number back.
14. Practice student (after 059): amber "Practice link…" banner under the header.
15. Temporarily, in the Supabase table editor, set a test student's `portal_pay_mode` to `hidden` → the Pay tab is gone and Book shows. Set it back to `auto`.

### After phase 3 ("I've paid" + tutor side)
16. On `P/parent/TOKEN` tap **I've paid $…** → "Thank you" card with "Sent {time}". Reload → still the thank-you card.
17. Signed in as tutor on `P`: Dashboard shows "💸 1 parent says they've paid". Payments shows the "Parents say they've paid" card with amount, reference, time, and the notice row has the "🙋 Parent says paid" chip. The notice is still **Pending**.
18. Tap **Mark as paid** on that notice → the card and the Dashboard alert disappear without a manual refresh of claims. Parent page now shows "All paid up" and the receipt.
19. Give the test student a new pending notice (set the student to per-lesson billing and mark one more lesson Done). On the parent page tap **I've paid**, then **I haven't paid yet** → back to the QR. Tutor side: no claim shown.
20. Tap **I've paid** again; on the tutor side tap **Not received** → card disappears; parent page is back to the QR.
21. Rate limit: tap **I've paid** / **I haven't paid yet** repeatedly; on the 6th claim within a day the red "That's been tapped a few times today…" line appears. (Afterwards Claude can clear the test rows on request; they are harmless.)
22. Amount changed underneath: open the parent page, then in the tutor app mark another lesson for that student Done so the notice changes; back on the parent page tap **I've paid** → page reloads with the toast "The amount has just been updated…", and no claim is created.
23. With no open claims anywhere: Dashboard has no 💸 card and Payments has no claims card.

### After phase 4 (Book)
24. Student with booking off: Book tab shows "Next lesson" and "To change or add a lesson, message …".
25. Turn booking on (existing "Create link"/"Reactivate"). Book tab shows the booking list. Send a request → "Request sent"; it appears in Booking Requests in the tutor app. Confirm it there → the lesson shows under upcoming lessons on the Book tab.
26. Open the old `P/book/<booking token>` → looks and works exactly as before.

### After phase 5 (Progress, only once migration 061 and `ParentProgress.jsx` exist)
27. Student with no shared report: no Progress tab. `P/parent/TOKEN?tab=progress` → Progress tab shows its empty state.
28. After sharing one lesson report: Progress tab appears and shows it. Pay and Book still work if you block the progress request (simulate by going offline after the page has loaded and switching tabs).

### After phase 6 (tutor card + switch)
29. Student profile shows the **Parent link** card; the old "Booking link" section and "Share payment summary" button are gone. **Copy link** copies `https://chopeandpay.com/pay/TOKEN`. **Preview** opens the new page.
30. `P/pay/TOKEN` now shows the new page (not the old table). `P/pay/TOKEN?tab=book` opens on Book.
31. Choose "A note only", type a note, Save → parent page shows your note, no amounts. Choose "Hide the Pay tab" → no Pay tab. Back to the first option → QR returns.
32. **Reset link** → modal → Cancel: nothing changes. **Reset link** → confirm: URL in the card changes; the old `P/pay/OLDTOKEN` shows "isn't active any more"; if booking was on, the old `/book/` link shows its inactive message; the new link works.
33. Agency-collected student's card: first option disabled with the explanation. Student with a placement fee: amber hint visible. Practitioner account: no Parent link card at all.
34. Send a payment request from Payments → the WhatsApp text still contains a `/pay/` link, and it opens the new page.
35. What's New banner appears once and stays dismissed after closing.

### Data checks (read-only; Claude can run these)

```sql
-- A. Portal total equals the database total for every tutor-collected student of one tutor.
--    Expect zero rows. (No names are selected.)
SELECT s.id,
       (get_parent_portal(s.payment_token) -> 'pay' ->> 'total')::numeric AS portal_total,
       (SELECT coalesce(sum(pc.amount_due), 0) FROM payment_cycles pc
         WHERE pc.student_id = s.id AND pc.status IN ('pending', 'overdue') AND pc.amount_due > 0) AS db_total
FROM students s
WHERE s.tutor_id = 'e104f920-3926-49f9-b8c5-a63e8103313e'
  AND s.deleted_at IS NULL
  AND get_parent_portal(s.payment_token) -> 'pay' ->> 'mode' = 'paynow'
  AND (get_parent_portal(s.payment_token) -> 'pay' ->> 'total')::numeric IS DISTINCT FROM
      (SELECT coalesce(sum(pc.amount_due), 0) FROM payment_cycles pc
        WHERE pc.student_id = s.id AND pc.status IN ('pending', 'overdue') AND pc.amount_due > 0);

-- B. Agency-collected students never receive amounts or a PayNow number. Expect zero rows.
SELECT s.id
FROM students s
WHERE s.payee_id IS NOT NULL AND s.fee_collected_by = 'payee' AND s.deleted_at IS NULL
  AND (get_parent_portal(s.payment_token) -> 'pay' ->> 'mode' <> 'note'
       OR get_parent_portal(s.payment_token) -> 'pay' ->> 'paynow_proxy' IS NOT NULL
       OR get_parent_portal(s.payment_token) -> 'pay' ->> 'total' IS NOT NULL);

-- C. Lesson lines add up to each unpaid notice (rows returned are notices where the page hides per-lesson amounts).
SELECT pc.id, pc.amount_due,
       (SELECT round(sum(CASE WHEN l.rate_type = 'per_session' THEN coalesce(l.rate, s.hourly_rate, 0)
                              ELSE (l.duration_minutes / 60.0) * coalesce(l.rate, s.hourly_rate, 0) END), 2)
          FROM lessons l WHERE l.payment_cycle_id = pc.id) AS lesson_sum
FROM payment_cycles pc JOIN students s ON s.id = pc.student_id
WHERE pc.status IN ('pending', 'overdue')
  AND pc.amount_due IS DISTINCT FROM
      (SELECT round(sum(CASE WHEN l.rate_type = 'per_session' THEN coalesce(l.rate, s.hourly_rate, 0)
                             ELSE (l.duration_minutes / 60.0) * coalesce(l.rate, s.hourly_rate, 0) END), 2)
         FROM lessons l WHERE l.payment_cycle_id = pc.id);

-- D. Claims overview after testing.
SELECT status, count(*), min(claimed_at), max(claimed_at) FROM payment_claims GROUP BY status;
```

---

## 9. Build phases

Six phases, one PR each, in this order. Do not start a phase until the previous one is merged and confirmed live.

### Phase 1: schema (propose SQL only)

```text
Read docs/specs/parent-portal.md fully first (especially sections 5.2 to 5.5 and 7).

Task: propose migration 064 only. Do not write any frontend code. Do NOT run any SQL against any database.

1. Create branch claude/parent-portal-schema from claude/charming-cray-new6h0.
2. Create supabase/migrations/064_parent_portal.sql containing exactly the SQL in spec section 5.4. Do not "improve" it.
3. Before committing, re-read supabase/migrations/027, 035, 036, 053 and 058 and confirm: students.payment_token exists; booking_links has token/is_active/student_id/tutor_id; payment_cycles has status/amount_due/period_start/period_end/paid_at; the per-lesson fee expression in the spec matches 058. If anything in the spec's SQL looks inconsistent with those files, STOP and tell me instead of fixing it silently.
4. Add the verification queries from spec 5.5 as a comment block at the bottom of the file (commented out).

Rules:
- Only this one new file. No changes to src/, netlify/ or other migrations.
- Commit, push, open a PR into claude/charming-cray-new6h0 titled "Propose migration 064: parent portal (NOT yet run)".
- Do not merge.

Report back: branch name, commit hash, PR link, and a plain-English list of what the migration creates so I can review it before running it by hand in the Supabase SQL Editor.
```

### Phase 2: parent page and Pay tab (read-only) on /parent/:token

```text
Read docs/specs/parent-portal.md first (sections 4.1, 4.2, 5.3 JSON shape, 6.1, 6.2, 6.4, 7).
Precondition: Hanyong has confirmed migration 064 is LIVE. If you are not sure, ask; do not test by writing to the database. Do not run any SQL.

Task: build the new parent page with the Pay tab, WITHOUT the "I've paid" button, on a new route.

1. Create branch claude/parent-portal-pay from claude/charming-cray-new6h0.
2. npm install qrcode-generator (the only new dependency).
3. New src/lib/paynowQr.js: exactly the reference implementation in spec 6.2, plus drawPayNowQrDataUrl(payload) that renders to an off-screen canvas as described and returns a PNG data URL (or null). Temporarily verify every row of the test-vector table and the extra checks with a throwaway node script; paste the output in your report; do not commit the script.
4. New src/lib/parentPortal.js: fmtDay, fmtMonth, fmtTime12, moneyShort (drops .00), initials(name), copyText(text) with the fallbacks in spec 4.2, and splitUnpaid(pay) returning { covered, fresh, freshTotal }.
5. New src/pages/ParentPortal.jsx (shell, states, header, practice banner, tab bar via useSearchParams, meta tags, footer) per spec 4.1. Data: supabase.rpc("get_parent_portal", { p_token: token }) only. In this phase the tabs are Pay and Book; Book renders just the text "Booking is coming to this page soon." (replaced in phase 4).
6. New src/components/portal/PayTab.jsx per spec 4.2 states A, C, D and Receipts. Leave out the "I've paid" button and State B for now (phase 3).
7. src/App.jsx: add <Route path="/parent/:token" element={<ParentPortal />} />. Do NOT change the /pay/:token route.
8. src/components/FeedbackButton.jsx and src/components/InstallPromptBanner.jsx: return null when useLocation().pathname starts with /pay/, /parent/ or /book/.
9. netlify.toml: add [[headers]] blocks for /pay/*, /parent/* and /book/* with Referrer-Policy = "no-referrer", X-Robots-Tag = "noindex", Cache-Control = "no-store".

Rules:
- No supabase.from( calls in ParentPortal.jsx or anything under src/components/portal/.
- Do not touch PaymentSummary.jsx, BookingPage.jsx, Payments.jsx, Dashboard.jsx, StudentProfile.jsx, netlify/functions, agency or practitioner files.
- Wrap any localStorage use in try/catch. Never build a Date from a bare "YYYY-MM-DD" string.
- npm run lint and npm run build must pass. Commit, push, open a PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, the test-vector output, and the exact preview URL pattern (deploy-preview-N--tuitionpay.netlify.app/parent/<token>) for acceptance tests 4 to 15.
```

### Phase 3: "I've paid" and tutor-side claims

```text
Read docs/specs/parent-portal.md first (sections 4.2 State B and the claim results table, 4.6, 6.3, 6.5).
Precondition: phase 2 is merged and live. Do not run any SQL.

Task: add the claim flow.

1. Create branch claude/parent-portal-claims from claude/charming-cray-new6h0.
2. src/components/portal/PayTab.jsx: add the "I've paid {amount}" button (calls supabase.rpc("claim_parent_payment", { p_token, p_expected_total: pay.total })), State B including "I haven't paid yet" (supabase.rpc("withdraw_parent_payment_claim", { p_token })), the "New since then" block, and every row of the claim results table with its exact wording. After any successful call, reload via onChanged().
3. New src/lib/paymentClaims.js: loadOpenClaims(tutorId) → select "id, student_id, amount_claimed, reference, covers_through, claimed_at, students(name)" from payment_claims where tutor_id and status = "open", newest first, limit 200; dismissClaim(id, tutorId) → update status "dismissed" and resolved_at; countOpenClaims(tutorId) using { count: "exact", head: true }.
4. src/pages/Payments.jsx: load open claims alongside the existing load; render the "Parents say they've paid" card and the row chip per spec 4.6; reload claims after handleMarkPaid, handleWaiveCycle, handleUndoWaive and handleUndoCycle succeed. Practice chip: read is_practice from the students list the page already loads with select("*") (do not name is_practice in any select string).
5. src/pages/Dashboard.jsx: add the 💸 alert card directly under the existing "Booking requests alert" block, same styling, linking to /payments. Load the count next to where pendingBookingCount is loaded.

Rules:
- Do not change how notices are marked paid, waived or undone. Do not call recompute_payment_cycles anywhere new.
- All new failures must show visible error text (no silent failures).
- Do not touch SettlementBoard.jsx, agency or practitioner files, netlify/functions.
- Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and acceptance tests 16 to 23 with the preview URLs to use.
```

### Phase 4: Book tab

```text
Read docs/specs/parent-portal.md first (sections 4.3 and 6.6).
Precondition: phase 3 is merged and live. Do not run any SQL. Do not edit anything in netlify/functions.

Task: show the existing booking flow inside the Book tab.

1. Create branch claude/parent-portal-book from claude/charming-cray-new6h0.
2. src/pages/BookingPage.jsx: pure refactor per spec 6.6. Export BookingPanel({ token, embedded = false }); default export stays the /book/:token page and must render exactly as today.
3. New src/components/portal/BookTab.jsx per spec 4.3, using book.next_lesson, book.enabled, book.token from get_parent_portal and <BookingPanel token={book.token} embedded />.
4. src/pages/ParentPortal.jsx: replace the phase-2 placeholder with BookTab.

Rules:
- The fetch URLs, request bodies and all booking rules stay byte-for-byte the same.
- Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, a short note confirming what moved inside BookingPage.jsx, and acceptance tests 24 to 26.
```

### Phase 5: Progress tab (host only)

```text
Read docs/specs/parent-portal.md first (sections 4.4, 5.3 "Progress data consumed", 6.7) and docs/specs/done-to-parent-report.md sections 4.4 and 5.3.
Preconditions: phase 4 is merged and live; migration 061 is live; src/components/ParentProgress.jsx and src/lib/topicMastery.js exist in claude/charming-cray-new6h0. If either file is missing, STOP and report: this phase waits for the done-to-parent-report work. Do not build your own progress view. Do not run any SQL.

Task: mount the existing Progress component in the portal.

1. Create branch claude/parent-portal-progress from claude/charming-cray-new6h0.
2. src/pages/ParentPortal.jsx: call supabase.rpc("get_progress_summary", { p_token: token }) in parallel with get_parent_portal, with its own loading and error state. Show the Progress tab only when it returned at least one report or the URL has ?tab=progress. Render <ParentProgress data={...} /> in that tab. A progress failure must never affect Pay or Book.

Rules:
- Do not change ParentProgress.jsx, topicMastery.js or any database function.
- Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and acceptance tests 27 and 28.
```

### Phase 6: tutor Parent link card and switching /pay to the new page

```text
Read docs/specs/parent-portal.md first (sections 4.5, 6.7, 7.2, acceptance tests 29 to 35).
Precondition: phases 2 to 4 are merged and live (phase 5 may or may not be). Do not run any SQL.

Task: give tutors the Parent link card and make /pay/:token show the new page.

1. Create branch claude/parent-portal-link-card from claude/charming-cray-new6h0.
2. src/pages/StudentProfile.jsx: replace the "Booking link" section and the "🔗 Share payment summary" button with the Parent link card exactly as spec 4.5 (copy, WhatsApp share, Preview, Reset link with confirm modal calling supabase.rpc("rotate_parent_link", { p_student_id: student.id }) then reloading the student and booking link, Pay tab setting saved to students.portal_pay_mode / portal_pay_note with .eq("id", student.id).eq("tutor_id", user.id), booking on/off using the existing handlers, the three hints). Hide the whole card when isPractitioner. To know the payee name, load the student's payee row (payees: id, name) only when student.payee_id is set. Use parsePayNowProxy from src/lib/paynowQr.js for the PayNow hint.
3. src/App.jsx: change the /pay/:token route to render ParentPortal. Keep /parent/:token as well.
4. Delete src/pages/PaymentSummary.jsx and its import. If that file contains a Pay | Progress tab bar from the done-to-parent-report work, it is replaced by the portal's tabs; say so in your report.
5. src/pages/Dashboard.jsx: update the ANNOUNCEMENT constant with a new id "whats-new-2026-11-parent-portal" and three short bullets: one parent link per student (pay, progress, booking); PayNow QR with the amount filled in; parents can tell you they've paid and you confirm.
6. src/pages/Faq.jsx: if it describes the payment summary link, update the wording to "parent link". Otherwise leave it.

Rules:
- Do not change src/lib/whatsapp.js buildPaymentSummaryUrl (links stay /pay/<token>).
- Do not touch the database functions, netlify/functions, agency or practitioner files.
- Every save and the reset must show a visible error on failure.
- Lint and build. Commit, push, PR into claude/charming-cray-new6h0. Do not merge.

Report back: branch, commit hash, PR link, files changed, and acceptance tests 29 to 35 with preview URLs.
```

---

## 10. Open questions for Hanyong

1. **One token for everything.** Reusing the existing pay token means every `/pay` link you have ever sent becomes the full parent page (Book tab if you have booking on for that student; Progress once you share a report). *Default: reuse, because it is the same family and you can reset any link.* Alternative: a new separate portal token and leave old links as payment-only (more to build, two links per student to explain).
2. **Agency-collected students: hide amounts and name the agency?** *Default: yes to both* ("Fees for … are collected by {payee name}", no figures), because the amount the agency charges the parent may differ from what you record, and payees have no payment details in the app. The payee name shown is whatever you typed in Agencies; tell me if any of those names are private shorthand.
3. **Placement-fee students.** While an agency is taking the first lessons' fees, who does the parent pay? *Default: the app does not guess; you switch that student to "A note only" until the fee is cleared (the card shows a hint).*
4. **Several unpaid notices: one QR for the total?** *Default: yes, one QR and one "I've paid" for everything outstanding.* Alternative: one QR per notice (more accurate matching, more taps for parents).
5. **How you hear about a claim.** *Default for v1: in the app only (Dashboard card + Payments).* A push/email alert is a later, separate piece of work.
6. **QR expiry.** *Default: none, so a QR from an old message still works.* Alternative: expire after 30 days.
7. **Reference format** `NAME-MONYY` (e.g. `JIAENLIM-OCT26`, built from the student name you typed). *Default: as specified.* If you would rather not have student names in bank references, say so and it becomes `CP-OCT26-xxxx`.
8. **Font.** The concept uses Bricolage Grotesque for big numbers and headings. *Default: stay with Inter (already loaded) to keep the page fast on mobile data.*
9. **PayNow numbers that are not a mobile or UEN.** One tutor's saved value has 9 digits. *Default: no QR for such values, number shown as text, and a hint on the tutor's card.* A validation message in Settings can follow as a small separate PR.
10. **Claim limit** of 5 per student per day. *Default: keep.*
11. **Order versus done-to-parent-report phase 4.** *Default: build this portal's phases 1–4 first, then their phase 4 mounts `ParentProgress` inside the portal (their Open question 8), then this spec's phases 5–6.* If their phase 4 is already merged, nothing is lost; phase 6 here retires their temporary tab bar.

---

## 11. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | A parent sees another family's data. | Token-only SECURITY DEFINER access, no ids in or out, no anon policies, threat list T1–T5, data checks A–B, scratch-DB tests. |
| R2 | The QR sends money to the wrong place or with the wrong amount. | Payload built only from DB values, amount locked, strict proxy parsing with "no QR" fallback, exact test vectors, real-app scan in test 6. |
| R3 | Parents on WhatsApp's in-app browser cannot scan their own screen or copy. | Save-QR button, press-and-hold image, three copy rows with two fallbacks; test 7 is done inside WhatsApp. |
| R4 | The new trigger on `payment_cycles` interferes with billing. | It fires only on status → paid/waived, writes only `payment_claims`, swallows its own errors; test 2 checks mark-paid/undo right after the migration. |
| R5 | Claims get out of step with notices (recompute, undo, partial payment). | Claims keyed on student + date range, derived display rules in 6.3, "Not received" always available, amber "Notice is now …" when amounts differ. |
| R6 | Replacing a live parent page breaks links already sent. | New page is built and tested on `/parent/:token`; `/pay/:token` is switched only in the last phase; the old RPC stays in place. |
| R7 | Two specs edit the same parent page. | Section 6.7 and Open question 11 fix the order; phase 5 stops if the other spec's files are missing; phase 6 handles either order. |
| R8 | Spec's SQL assumes columns that differ live. | Schema facts in 5.1 were read from the live database on 16 Nov 2026; the SQL ran on a scratch database; phase 1 re-checks the migration files and stops on any mismatch; `is_practice` is read defensively. |
| R9 | Old `/book/<token>` links keep working for archived or deleted students (existing behaviour; the portal itself hides booking for archived students and is dead for deleted ones). | Listed under Later; the fix is a two-line filter in the two Netlify functions, deliberately kept out of this work so booking code is not touched. |
| R10 | Agency families are shown the wrong thing. | Note mode is decided and enforced in SQL using the same rule as `collectedBreakdown.js`; data check B; tutor override; test 12 inspects the network response. |
| R11 | Builder forgets a conditional state. | Every state has explicit copy in section 4 and a numbered acceptance test (empty claims: 23; not found: 8; offline: 9; no PayNow: 13; hidden: 15; modal cancel: 32). |
