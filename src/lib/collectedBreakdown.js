// Splits a month's earnings (lessons TAUGHT in that month, same basis as the
// agency statements) into what you keep and what each agency earns, and keeps
// the per-student lines behind every agency figure so they can be shown.
//
// Per completed lesson taught in the month:
//  1. Placement fee: the part that is a one-off referral fee (e.g. Mindflex)
//     is earned 100% by that referral agency. It comes off the student's
//     earliest lessons first -- same rule as src/lib/statement.js.
//  2. The rest ("counted") is shared with the student's agency, if any: the
//     agency keeps (100 - share_percent)% of it, whoever collected the fee.
//
// An agency's total is the sum of its per-student lines, and what you keep is
// total - agencies' earnings, so everything always adds up.
// All maths is in whole cents.

import { lessonAmount } from "./paymentMode";

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;

const lessonOrder = (a, b) =>
  `${a.lesson_date} ${a.lesson_time ?? ""} ${a.id}`.localeCompare(
    `${b.lesson_date} ${b.lesson_time ?? ""} ${b.id}`,
  );

const monthPrefix = (monthDate) =>
  `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;

// lessons: ALL completed lessons known (needed to know how much of a
// placement fee was already used before this month).
export function buildEarningsBreakdown({ monthDate, students, payees, lessons }) {
  const prefix = monthPrefix(monthDate);
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));

  let totalCents = 0;
  // Agency name (lowercase) -> { name, payeeId, sharePct, lines: [] }
  const agencies = new Map();
  const agencyFor = (name, payee) => {
    const clean = name.trim();
    const key = clean.toLowerCase();
    const row = agencies.get(key) ?? {
      name: clean,
      payeeId: null,
      sharePct: null,
      lines: [],
    };
    if (payee) {
      row.payeeId = payee.id;
      row.sharePct = Number(payee.share_percent ?? 80);
    }
    agencies.set(key, row);
    return row;
  };

  for (const student of students) {
    const studentLessons = lessons
      .filter((l) => l.student_id === student.id && l.is_completed)
      .sort(lessonOrder);
    if (studentLessons.length === 0) continue;

    let feeLeft = toCents(student.placement_fee_amount);
    const feeStart = student.placement_fee_start || null;

    // This student's totals for the month.
    let billed = 0;
    let fee = 0;
    let lessonCount = 0;
    for (const l of studentLessons) {
      const amount = toCents(lessonAmount(l, student));
      let take = 0;
      if (feeLeft > 0 && (!feeStart || l.lesson_date >= feeStart)) {
        take = Math.min(feeLeft, amount);
        feeLeft -= take;
      }
      if (!l.lesson_date.startsWith(prefix)) continue; // only this month counts
      billed += amount;
      fee += take;
      lessonCount += 1;
    }
    if (lessonCount === 0) continue;
    totalCents += billed;
    const counted = billed - fee;

    if (fee > 0) {
      agencyFor(student.placement_fee_agency || "Referral agency").lines.push({
        kind: "placement",
        student: student.name,
        billed,
        cents: fee,
      });
    }

    const payee = student.payee_id ? payeesById.get(student.payee_id) : null;
    if (payee && counted > 0) {
      const share = Number(payee.share_percent ?? 80);
      const byMe = student.fee_collected_by === "me";
      // Same rounding as the statement: agency-collected fees round the
      // tutor's share; tutor-collected fees round the agency's share.
      const cents = byMe
        ? Math.round((counted * (100 - share)) / 100)
        : counted - Math.round((counted * share) / 100);
      agencyFor(payee.name, payee).lines.push({
        kind: "share",
        student: student.name,
        collectedBy: byMe ? "me" : "agency",
        billed: counted, // after any placement fee
        cents,
        lessonCount,
      });
    }
  }

  const rows = [...agencies.values()]
    .map((a) => {
      const cents = a.lines.reduce((s, l) => s + l.cents, 0);
      return {
        name: a.name,
        payeeId: a.payeeId,
        sharePct: a.sharePct,
        cents,
        amount: fromCents(cents),
        lines: a.lines
          .filter((l) => l.cents > 0)
          .sort((x, y) => y.cents - x.cents || x.student.localeCompare(y.student))
          .map((l) => ({
            ...l,
            billed: fromCents(l.billed),
            amount: fromCents(l.cents),
          })),
      };
    })
    .filter((a) => a.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));

  const agencyCents = rows.reduce((s, a) => s + a.cents, 0);
  return {
    total: fromCents(totalCents),
    mine: fromCents(totalCents - agencyCents),
    agencyTotal: fromCents(agencyCents),
    agencies: rows,
  };
}
