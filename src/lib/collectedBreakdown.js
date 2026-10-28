// Splits a month's "Collected" total into who actually received the money:
// each agency vs. you.
//
// Every paid cycle is placed in exactly ONE bucket (or split into two for a
// one-off placement fee), so the buckets always add up to the cycle total.
//
// Rules, per paid cycle:
//  1. Placement fee: the part of the cycle that is a one-off referral fee
//     (e.g. Mindflex) counts as collected by that referral agency. Uses the
//     same "comes off the earliest lessons first" rule as the agency
//     statements (src/lib/statement.js).
//  2. The rest: if the student is linked to an agency and that agency
//     collects the fee ("payee"), it counts as collected by that agency.
//     Otherwise (no agency, or "I collect") it counts as collected by you.
//
// All maths is done in whole cents to avoid rounding drift.

import { lessonAmount } from "./paymentMode";

const toCents = (n) => Math.round((Number(n) || 0) * 100);
const fromCents = (c) => c / 100;

const lessonOrder = (a, b) =>
  `${a.lesson_date} ${a.lesson_time ?? ""} ${a.id}`.localeCompare(
    `${b.lesson_date} ${b.lesson_time ?? ""} ${b.id}`,
  );

// lesson id -> cents of that lesson that went to the student's placement
// (referral) agency.
function placementCentsByLesson(students, lessons) {
  const result = new Map();
  for (const student of students) {
    let feeLeft = toCents(student.placement_fee_amount);
    if (feeLeft <= 0) continue;
    const feeStart = student.placement_fee_start || null;
    const sorted = lessons
      .filter((l) => l.student_id === student.id && l.is_completed)
      .sort(lessonOrder);
    for (const l of sorted) {
      if (feeLeft <= 0) break;
      if (feeStart && l.lesson_date < feeStart) continue;
      const take = Math.min(feeLeft, toCents(lessonAmount(l, student)));
      if (take > 0) {
        result.set(l.id, take);
        feeLeft -= take;
      }
    }
  }
  return result;
}

// paidCycles: the paid payment_cycles that make up this month's "Collected".
// students / payees / lessons: full lists (lessons = all lessons before
// today, so the placement fee can be tracked from the student's first lesson).
export function buildCollectedBreakdown({ paidCycles, students, payees, lessons }) {
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));
  const placementByLesson = placementCentsByLesson(students, lessons);

  const lessonsByCycle = new Map();
  for (const l of lessons) {
    if (!l.payment_cycle_id) continue;
    if (!lessonsByCycle.has(l.payment_cycle_id))
      lessonsByCycle.set(l.payment_cycle_id, []);
    lessonsByCycle.get(l.payment_cycle_id).push(l);
  }

  // Same agency typed two ways ("Mindflex" / "mindflex ") is one agency.
  const agencies = new Map(); // key -> { name, cents }
  const addAgency = (name, cents) => {
    if (cents <= 0) return;
    const clean = (name ?? "").trim() || "Other agency";
    const key = clean.toLowerCase();
    const row = agencies.get(key) ?? { name: clean, cents: 0 };
    row.cents += cents;
    agencies.set(key, row);
  };

  let meCents = 0;
  let totalCents = 0;

  for (const cycle of paidCycles) {
    const cycleCents = toCents(cycle.amount_due);
    totalCents += cycleCents;
    const student = studentsById.get(cycle.student_id);

    // 1. Placement-fee portion -> referral agency.
    let placementCents = 0;
    if (student) {
      const fromLessons = (lessonsByCycle.get(cycle.id) ?? []).reduce(
        (sum, l) => sum + (placementByLesson.get(l.id) ?? 0),
        0,
      );
      // Never take more than the cycle itself.
      placementCents = Math.min(fromLessons, cycleCents);
      addAgency(student.placement_fee_agency || "Referral agency", placementCents);
    }

    // 2. The rest -> the collecting agency, or you.
    const restCents = cycleCents - placementCents;
    const payee = student?.payee_id ? payeesById.get(student.payee_id) : null;
    if (payee && student.fee_collected_by !== "me") {
      addAgency(payee.name, restCents);
    } else {
      meCents += restCents;
    }
  }

  const agencyRows = [...agencies.values()]
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name))
    .map((a) => ({ name: a.name, amount: fromCents(a.cents) }));
  const agencyCents = [...agencies.values()].reduce((s, a) => s + a.cents, 0);

  return {
    total: fromCents(totalCents),
    me: fromCents(meCents),
    agencyTotal: fromCents(agencyCents),
    agencies: agencyRows,
    // Always true by construction; handy for a quick test.
    matches: meCents + agencyCents === totalCents,
  };
}
