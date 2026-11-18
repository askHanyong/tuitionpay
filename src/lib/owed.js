// One source of truth for "what is owed" (spec: today-briefing-and-reminders 6.1).
// Moved, not rewritten, from Dashboard.jsx (`allPendingAmount` and the
// current-month branch of `pendingBreakdownRows`). Pure: no Supabase, no clock.
import { lessonAmount } from "./paymentMode";

// The fee goes to an agency, not the tutor: a placement, or a payee that collects.
// fee_collected_by defaults to 'payee' even with no agency, so payee_id must be set.
export function isAgencyCollected(student) {
  return (
    Boolean(student?.agency_placement_id) ||
    (Boolean(student?.payee_id) && student?.fee_collected_by !== "me")
  );
}

// cycles / allStudents / allLessons = the "recap" sets (archived + deleted included).
// activeStudents = non-archived, non-deleted. payees = [{ id, name }] or null.
// Returns rows[] of { type: 'cycle' | 'mid_cycle', studentId, studentName, amount,
// tag, archived, deleted, cycleId, cycleStatus, cycle, student, collector,
// collectorName }.
export function buildOwedRows({ cycles, allStudents, activeStudents, allLessons, payees }) {
  const payeeName = new Map((payees ?? []).map((p) => [p.id, p.name]));
  const collectorOf = (student) => {
    const agency = isAgencyCollected(student);
    return {
      collector: agency ? "agency" : "tutor",
      collectorName: agency ? (payeeName.get(student?.payee_id) ?? null) : null,
    };
  };
  const isPracticeStudent = (s) => s?.is_practice === true;

  const rows = [];
  const owedCycles = cycles.filter((c) => c.status === "pending" || c.status === "overdue");
  const owedStudentIds = new Set(owedCycles.map((c) => c.student_id));

  for (const c of owedCycles) {
    const student = allStudents.find((s) => s.id === c.student_id) ?? null;
    if (isPracticeStudent(student)) continue;
    rows.push({
      type: "cycle",
      studentId: c.student_id,
      studentName: student?.name ?? c.students?.name ?? "—",
      amount: Number(c.amount_due),
      tag: c.status === "overdue" ? "Overdue" : "Pending",
      archived: student ? !!student.archived : false,
      deleted: student ? !!student.deleted_at : false,
      cycleId: c.id,
      cycleStatus: c.status,
      cycle: c,
      student,
      ...collectorOf(student),
    });
  }

  const lessonsByStudent = new Map();
  for (const l of allLessons) {
    if (!lessonsByStudent.has(l.student_id)) lessonsByStudent.set(l.student_id, []);
    lessonsByStudent.get(l.student_id).push(l);
  }

  for (const stu of activeStudents) {
    if (isPracticeStudent(stu)) continue;
    if ((stu.payment_mode ?? "lessons") !== "lessons") continue;
    if (owedStudentIds.has(stu.id)) continue;
    const openLessons = (lessonsByStudent.get(stu.id) ?? []).filter((l) => !l.payment_cycle_id);
    const openCount = openLessons.length;
    if (openCount === 0) continue;
    const cycleCount = stu.payment_cycle_count ?? 4;
    if (openCount < cycleCount - 1) continue;
    const cycleLessons = [...openLessons]
      .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1))
      .slice(-cycleCount);
    const amount = cycleLessons.reduce((s, l) => s + lessonAmount(l, stu), 0);
    rows.push({
      type: "mid_cycle",
      studentId: stu.id,
      studentName: stu.name,
      amount,
      tag: "Not yet billed",
      archived: !!stu.archived,
      deleted: !!stu.deleted_at,
      cycleId: null,
      cycleStatus: null,
      cycle: null,
      student: stu,
      ...collectorOf(stu),
    });
  }
  return rows;
}

// Same grouping as the old Dashboard code (cycles first, then not-yet-billed) and
// no per-row rounding, so the total is exactly what Pending showed before.
export function sumOwed(rows) {
  const total = (type) => rows.filter((r) => r.type === type).reduce((s, r) => s + r.amount, 0);
  return total("cycle") + total("mid_cycle");
}

// Briefing invariant (6.1): owed to tutor + via agency + not yet billed === total.
// Compared in whole cents. Returns true when it holds.
export function owedInvariantHolds(rows, total) {
  const sumBy = (f) => rows.filter(f).reduce((s, r) => s + r.amount, 0);
  const parts =
    sumBy((r) => r.type === "cycle" && r.collector === "tutor") +
    sumBy((r) => r.type === "cycle" && r.collector === "agency") +
    sumBy((r) => r.type === "mid_cycle");
  return Math.round(parts * 100) === Math.round(total * 100);
}
