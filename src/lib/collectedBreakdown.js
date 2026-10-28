// Splits a month's earnings (lessons TAUGHT in that month, same basis as the
// agency statements) into what you keep and what each agency earns.
//
// Per completed lesson taught in the month:
//  1. Placement fee: the part that is a one-off referral fee (e.g. Mindflex)
//     is earned 100% by that referral agency. It comes off the student's
//     earliest lessons first -- same rule as src/lib/statement.js.
//  2. The rest ("counted") belongs to you and, if the student is linked to an
//     agency, is shared with it: the agency keeps (100 - share_percent)%.
//     Rounding follows the statement: the agency-collected and
//     you-collected pots are rounded separately.
//
// What you keep = total - agencies' earnings, so the two halves always add up.
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
  const placement = new Map(); // key -> { name, cents }
  // payeeId -> { collectedByPayee (cents), collectedByMe (cents) } of counted fees
  const pots = new Map();

  for (const student of students) {
    const studentLessons = lessons
      .filter((l) => l.student_id === student.id && l.is_completed)
      .sort(lessonOrder);
    if (studentLessons.length === 0) continue;

    let feeLeft = toCents(student.placement_fee_amount);
    const feeStart = student.placement_fee_start || null;
    const payee = student.payee_id ? payeesById.get(student.payee_id) : null;
    const byMe = student.fee_collected_by === "me";

    for (const l of studentLessons) {
      const amount = toCents(lessonAmount(l, student));
      let fee = 0;
      if (feeLeft > 0 && (!feeStart || l.lesson_date >= feeStart)) {
        fee = Math.min(feeLeft, amount);
        feeLeft -= fee;
      }
      if (!l.lesson_date.startsWith(prefix)) continue; // only this month counts

      totalCents += amount;
      if (fee > 0) {
        const name = (student.placement_fee_agency || "Referral agency").trim();
        const key = name.toLowerCase();
        const row = placement.get(key) ?? { name, cents: 0 };
        row.cents += fee;
        placement.set(key, row);
      }
      const counted = amount - fee;
      if (payee && counted > 0) {
        const pot = pots.get(payee.id) ?? { payee, byPayee: 0, byMe: 0 };
        if (byMe) pot.byMe += counted;
        else pot.byPayee += counted;
        pots.set(payee.id, pot);
      }
    }
  }

  // Agency earnings, merged by name (a payee and a referral fee can be the
  // same agency).
  const earned = new Map(); // key -> { name, cents }
  const addEarned = (name, cents) => {
    if (cents <= 0) return;
    const key = name.trim().toLowerCase();
    const row = earned.get(key) ?? { name: name.trim(), cents: 0 };
    row.cents += cents;
    earned.set(key, row);
  };
  for (const p of placement.values()) addEarned(p.name, p.cents);
  for (const { payee, byPayee, byMe } of pots.values()) {
    const share = Number(payee.share_percent ?? 80);
    const youGetFromAgency = Math.round((byPayee * share) / 100);
    const youOweAgency = Math.round((byMe * (100 - share)) / 100);
    addEarned(payee.name, byPayee - youGetFromAgency + youOweAgency);
  }

  const agencies = [...earned.values()]
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map((a) => ({ name: a.name, amount: fromCents(a.cents) }));
  const agencyCents = [...earned.values()].reduce((s, a) => s + a.cents, 0);

  return {
    total: fromCents(totalCents),
    mine: fromCents(totalCents - agencyCents),
    agencyTotal: fromCents(agencyCents),
    agencies,
  };
}
