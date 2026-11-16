# Spec — Year-end income report (Phase B)

Copied from the project doc `claude/spec-year-end-income-report.md` (16 Nov 2026). Decisions confirmed by Hanyong.

Purpose: figures tutors can use for their Singapore income tax return (Form B/B1). **Income only** — no expense tracking yet.

## IRAS basis (IRAS tuition starter guide; IRAS business expenses page)
- **Earned basis:** income = lessons TAUGHT in the period (lesson_date, is_completed), not cash collected.
- **Basis period:** calendar year by default (1 Jan–31 Dec), assessed in the following Year of Assessment (e.g. YA 2027 = lessons taught 1 Jan–31 Dec 2026). Tutor can configure a different year-end.
- **Revenue <= $200k:** 2-line statement — Revenue, Adjusted profit/loss.
- **Bad debts:** written-off amounts are dated by `payment_cycles.waived_at` (the year they were written off), not the lesson date.
- **Records:** keep 5 years. Per-student record card: lessons attended, fees, shares, paid, written off, outstanding.

## Agency rules (CONFIRMED — these override any earlier inference)
Set-up A — agency's share never reaches the tutor → tutor revenue = tutor's share only:
- `students.payee_id` with `fee_collected_by = 'payee'` (e.g. Lumina collects, pays tutor share_percent; Edulab collects, pays 100%).
- Placement fees (`students.placement_fee_*`, e.g. Mindflex) — parent pays agency directly; fee is drained from the student's earliest lessons on/after placement_fee_start.

Set-up B — tutor collects full fee, then pays the agency → tutor revenue = FULL fee; agency's cut shown on a separate "Commission paid to agencies" line:
- `students.payee_id` with `fee_collected_by = 'me'`.

Out of scope for now:
- `agency_placements` / `agency_ledger_entries` (agency platform) — no records exist yet. If any placement exists for the tutor, show a notice that those students are not yet covered by the report.
- `students.direct_payer` — display label only, no income effect.

## Calculation rules
- Reuse the existing JS earnings logic (`buildEarningsBreakdown` in collectedBreakdown.js and helpers). Do NOT reimplement the arithmetic in SQL. The year total must equal the sum of the 12 monthly recaps.
- Placement fees can span years: load each affected student's lessons from placement_fee_start (which may be before 1 Jan) so fee already consumed in earlier years is accounted for.
- Include archived and soft-deleted students.
- Exclude uncompleted lessons and lessons dated outside the year.

## Data loading
- Supabase returns max 1,000 rows per query. Page with `.range()` until fewer than the page size come back. Never silently truncate.

## Report contents
- Year selector (default: previous calendar year).
- Headline: Revenue (per agency rules above), Commission paid to agencies (set-up B only), Written off in year, plus the 2-line statement figure for Revenue with a plain-language "how this is worked out" note.
- By month: lessons taught, gross fees, agency share, your revenue, collected (paid_at in month), written off (waived_at in month).
- Reconciliation line: revenue earned in year vs collected vs written off vs still owed at year end — must balance, show the check.
- Per student (record card): lessons, gross fees, agency/placement share, your revenue, paid, written off, outstanding.
- Export: CSV (for an accountant) and PDF/print view (for records).
- Footer: "Prepared from your ChopeAndPay records. Not tax advice — check with IRAS or an accountant, especially for agency income."

## Constraints
- Keep tutor, practitioner and agency code separate.
- No schema changes expected. If one is needed, propose SQL only — Hanyong runs it manually.
