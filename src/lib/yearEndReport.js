// Year-end income report maths. Everything per-month goes through
// buildEarningsBreakdown; the per-student cards mirror its cents rounding
// month by month so they add up to the monthly totals.

import { lessonAmount } from "./paymentMode";
import {
  buildEarningsBreakdown,
  fromCents,
  lessonOrder,
  toCents,
} from "./collectedBreakdown";

export const TOLERANCE = 0.01;

// Asia/Singapore has no daylight saving, so a fixed +08:00 offset is exact.
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

// "YYYY-MM-DD" of a timestamp as seen in Singapore (a payment at 01:00 SGT on
// 1 Dec is 17:00 UTC on 30 Nov, so the UTC string prefix would be wrong).
export const sgtDate = (ts) =>
  new Date(new Date(ts).getTime() + SGT_OFFSET_MS).toISOString().slice(0, 10);

export const sgtMonth = (ts) => sgtDate(ts).slice(0, 7);

export const sgtInYear = (ts, year) => sgtDate(ts).startsWith(`${year}-`);

// 'A': the agency collects and pays the tutor their share.
// 'B': the tutor collects the full fee and pays the agency its cut.
// 'direct': no agency. fee_collected_by defaults to 'payee' even for students
// with no payee_id, so it only means anything when a payee is linked.
export function agencySetup(student, payee) {
  if (!student.payee_id || !payee) return "direct";
  return student.fee_collected_by === "me" ? "B" : "A";
}

export function computeMonthlyBreakdowns({ year, students, payees, lessons }) {
  return Array.from({ length: 12 }, (_, m) => {
    const monthDate = new Date(year, m, 1);
    const monthPrefix = `${year}-${String(m + 1).padStart(2, "0")}`;
    const bd = buildEarningsBreakdown({ monthDate, students, payees, lessons });

    let commissionBCents = 0;
    for (const agency of bd.agencies) {
      for (const line of agency.lines) {
        if (line.collectedBy === "me") commissionBCents += line.cents;
      }
    }
    return {
      monthDate,
      monthPrefix,
      bd,
      lessonCount: lessons.filter((l) => l.lesson_date.startsWith(monthPrefix))
        .length,
      gross: bd.total,
      agencyShare: bd.agencyTotal,
      mine: bd.mine,
      commissionB: fromCents(commissionBCents),
      // Gross less everything agencies keep, with set-up B commission added
      // back (the tutor received that money, then paid it on).
      revenue: fromCents(
        toCents(bd.total) - toCents(bd.agencyTotal) + commissionBCents,
      ),
      // Same figure from the breakdown's own take-home number.
      takeHomePlusCommission: fromCents(toCents(bd.mine) + commissionBCents),
    };
  });
}

export function computePerStudentRows({ year, students, payees, lessons, cycles }) {
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));
  const lessonsByStudent = new Map();
  for (const l of lessons) {
    if (!lessonsByStudent.has(l.student_id)) lessonsByStudent.set(l.student_id, []);
    lessonsByStudent.get(l.student_id).push(l);
  }
  const cyclesByStudent = new Map();
  for (const c of cycles) {
    if (!cyclesByStudent.has(c.student_id)) cyclesByStudent.set(c.student_id, []);
    cyclesByStudent.get(c.student_id).push(c);
  }

  const rows = [];
  for (const student of students) {
    const studentLessons = (lessonsByStudent.get(student.id) ?? []).sort(lessonOrder);
    const payee = student.payee_id ? payeesById.get(student.payee_id) : null;
    const setup = agencySetup(student, payee);
    const share = Number(payee?.share_percent ?? 80);

    // Placement fee drains from the earliest lessons across ALL history, but
    // only this year's lessons are tallied, month by month like the breakdown.
    let feeLeft = toCents(student.placement_fee_amount);
    const feeStart = student.placement_fee_start || null;
    const byMonth = new Map();
    for (const l of studentLessons) {
      const amount = toCents(lessonAmount(l, student));
      let take = 0;
      if (feeLeft > 0 && (!feeStart || l.lesson_date >= feeStart)) {
        take = Math.min(feeLeft, amount);
        feeLeft -= take;
      }
      if (!l.lesson_date.startsWith(`${year}-`)) continue;
      const key = l.lesson_date.slice(0, 7);
      const b = byMonth.get(key) ?? { billed: 0, fee: 0, count: 0 };
      b.billed += amount;
      b.fee += take;
      b.count += 1;
      byMonth.set(key, b);
    }
    if (byMonth.size === 0) continue;

    let billed = 0;
    let fee = 0;
    let lessonCount = 0;
    let shareA = 0;
    let commissionB = 0;
    for (const b of byMonth.values()) {
      billed += b.billed;
      fee += b.fee;
      lessonCount += b.count;
      const counted = b.billed - b.fee;
      if (setup === "direct" || counted <= 0) continue;
      // Same rounding as buildEarningsBreakdown: tutor-collected fees round
      // the agency's share; agency-collected fees round the tutor's share.
      if (setup === "B") commissionB += Math.round((counted * (100 - share)) / 100);
      else shareA += counted - Math.round((counted * share) / 100);
    }

    let paid = 0;
    let writtenOff = 0;
    for (const c of cyclesByStudent.get(student.id) ?? []) {
      if (c.status === "paid" && c.paid_at && sgtInYear(c.paid_at, year)) {
        paid += Number(c.amount_due);
      }
      if (c.status === "waived" && c.waived_at && sgtInYear(c.waived_at, year)) {
        writtenOff += Number(c.amount_due);
      }
    }
    const revenue = fromCents(billed - fee - shareA);

    rows.push({
      student,
      setup,
      lessonCount,
      gross: fromCents(billed),
      placementFee: fromCents(fee),
      agencyShareA: fromCents(shareA),
      commissionB: fromCents(commissionB),
      revenue,
      paid,
      writtenOff,
      outstanding: Math.max(0, revenue - paid - writtenOff),
    });
  }
  return rows.sort((a, b) => a.student.name.localeCompare(b.student.name));
}

// Each check compares two independently derived figures.
export function buildChecks({
  months,
  perStudentRows,
  annualRevenue,
  annualGross,
  annualAgencyShare,
  annualCommissionB,
  annualLessons,
  collectedInYear,
  writtenOffInYear,
  monthsCollected,
  monthsWrittenOff,
}) {
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const checks = [
    {
      label: "Per-student revenue adds up to the monthly revenue",
      a: sum(perStudentRows, (r) => r.revenue),
      b: annualRevenue,
    },
    {
      label: "Monthly revenue equals the earnings breakdown's take-home plus set-up B commission",
      a: annualRevenue,
      b: sum(months, (m) => m.takeHomePlusCommission),
    },
    {
      label: "Gross fees less agency/placement share plus set-up B commission equals revenue",
      a: annualGross - annualAgencyShare + annualCommissionB,
      b: annualRevenue,
    },
    {
      label: "Lessons per student add up to lessons per month",
      a: sum(perStudentRows, (r) => r.lessonCount),
      b: annualLessons,
      unit: "count",
    },
    {
      label: "Collected by month adds up to collected in the year",
      a: monthsCollected,
      b: collectedInYear,
    },
    {
      label: "Written off by month adds up to written off in the year",
      a: monthsWrittenOff,
      b: writtenOffInYear,
    },
  ];
  return checks.map((c) => ({ ...c, ok: Math.abs(c.a - c.b) <= TOLERANCE }));
}
