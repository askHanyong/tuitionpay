import { useMemo, useRef, useState } from "react";
import { useTerms } from "../contexts/TerminologyContext";
import { formatSGD } from "../lib/paymentNotice";
import { buildMonthlyReport } from "../lib/monthlyReport";
import { downloadMonthlyReportPdf } from "../lib/pdfReport";
import { downloadMonthlyReportImage } from "../lib/imageReport";
import MonthlyReportTemplate from "./MonthlyReportTemplate";
import { formatMonth } from "../utils/dateFormat";
import { lessonAmount } from "../lib/paymentMode";

function isSameMonth(dateStr, monthDate) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return (
    d.getFullYear() === monthDate.getFullYear() &&
    d.getMonth() === monthDate.getMonth()
  );
}

function computeForMonth(
  monthDate,
  lessons,
  paymentCycles,
  students,
  scheduledLessons,
) {
  const monthLessons = lessons.filter((l) =>
    isSameMonth(l.lesson_date, monthDate),
  );
  const collected = paymentCycles
    .filter((c) => c.status === "paid" && isSameMonth(c.period_end, monthDate))
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const pendingFromCycles = paymentCycles
    .filter(
      (c) => c.status === "pending" && isSameMonth(c.period_end, monthDate),
    )
    .reduce((sum, c) => sum + Number(c.amount_due), 0);

  const studentsById = new Map(students.map((s) => [s.id, s]));
  // A payment cycle only gets created once its full lesson group has
  // landed, so a student mid-cycle has no payment_cycles row yet. Their full
  // cycle amount only counts as pending once the cycle is far enough along
  // to be imminent -- at least (payment_cycle_count - 1) completed unbilled
  // lessons -- not from the very first lesson of the cycle.
  const unbilledCountByStudent = new Map();
  for (const l of lessons) {
    if (l.payment_cycle_id) continue;
    unbilledCountByStudent.set(
      l.student_id,
      (unbilledCountByStudent.get(l.student_id) ?? 0) + 1,
    );
  }
  const midCycleStudentIds = new Set(
    monthLessons.filter((l) => !l.payment_cycle_id).map((l) => l.student_id),
  );
  const scheduledLessonsByStudent = new Map();
  for (const l of scheduledLessons ?? []) {
    if (!scheduledLessonsByStudent.has(l.student_id))
      scheduledLessonsByStudent.set(l.student_id, []);
    scheduledLessonsByStudent.get(l.student_id).push(l);
  }
  const now = new Date();
  const pendingFromMidCycleLessons = [...midCycleStudentIds].reduce(
    (sum, studentId) => {
      const student = studentsById.get(studentId);
      if (!student) return sum;
      const mode = student.payment_mode ?? "lessons";
      // Monthly/custom-date billing has no fixed cycle size -- every
      // unbilled lesson this month accumulates toward the month's total,
      // regardless of payment_cycle_count (which only applies to "lessons"
      // mode billing). Sum each lesson's actual duration_minutes * rate
      // rather than assuming a fixed per-lesson amount.
      if (mode === "monthly" || mode === "custom_date") {
        // Monthly/custom-date students are still "accumulating" for most of
        // the month -- only start showing them as pending once the month is
        // almost over (last 3 days).
        const endOfMonth = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0,
        );
        const daysToEnd = Math.round(
          (endOfMonth -
            new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
            (1000 * 60 * 60 * 24),
        );
        if (daysToEnd > 3) return sum;
        const unbilledThisMonthLessons = monthLessons.filter(
          (l) => l.student_id === studentId && !l.payment_cycle_id,
        );
        const total = unbilledThisMonthLessons.reduce(
          (s, l) => s + lessonAmount(l, student),
          0,
        );
        return sum + total;
      }
      const cycleCount = student.payment_cycle_count ?? 4;
      const unbilledCount = unbilledCountByStudent.get(studentId) ?? 0;
      if (unbilledCount < cycleCount - 1) return sum;
      // The cycle is only "imminent" enough to count toward this month's
      // pending if the scheduled lesson that would complete it actually
      // falls within this month.
      const nextScheduled = (scheduledLessonsByStudent.get(studentId) ?? [])
        .slice()
        .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
      const lessonsNeeded = cycleCount - unbilledCount;
      const completingLesson = nextScheduled[lessonsNeeded - 1];
      if (
        completingLesson &&
        !isSameMonth(completingLesson.lesson_date, monthDate)
      ) {
        return sum;
      }
      const unbilledLessons = lessons
        .filter(
          (l) =>
            l.student_id === studentId && !l.payment_cycle_id && l.is_completed,
        )
        .sort((a, b) =>
          a.lesson_date < b.lesson_date
            ? -1
            : a.lesson_date > b.lesson_date
              ? 1
              : 0,
        )
        .slice(-cycleCount);
      const cycleAmount = unbilledLessons.reduce(
        (s, l) => s + lessonAmount(l, student),
        0,
      );
      return sum + cycleAmount;
    },
    0,
  );
  const isCurrentMonth =
    monthDate.getFullYear() === now.getFullYear() &&
    monthDate.getMonth() === now.getMonth();
  const isPastMonth =
    monthDate.getFullYear() < now.getFullYear() ||
    (monthDate.getFullYear() === now.getFullYear() &&
      monthDate.getMonth() < now.getMonth());
  // Pending amounts only make sense for the month that's still in progress --
  // a month that has already ended is fully settled or already reflected in
  // history, so it should never display a pending balance.
  const pending = isCurrentMonth
    ? pendingFromCycles + pendingFromMidCycleLessons
    : 0;

  // Projected earnings for past months: use the settled collected+pending
  // total so the number matches reality. Using lesson-based math for past
  // months produces wrong results because "Collected" attributes a payment
  // cycle's full amount to the month its LAST lesson fell in, while
  // lesson-based math splits it across whichever months each individual
  // lesson occurred in — they will always disagree whenever a cycle spans a
  // month boundary.
  // For the current and future months: sum duration × rate for all lessons
  // scheduled in the month (taught so far + upcoming), since cycles haven't
  // all closed yet and we genuinely need to project forward.
  const scheduledThisMonth = (scheduledLessons ?? []).filter((l) =>
    isSameMonth(l.lesson_date, monthDate),
  );
  const projectedEarnings = isPastMonth
    ? collected + pending
    : [...monthLessons, ...scheduledThisMonth].reduce(
        (sum, l) => sum + lessonAmount(l, studentsById.get(l.student_id)),
        0,
      );

  return {
    totalLessons: monthLessons.length,
    collected,
    pending,
    projectedEarnings,
    total: collected + pending,
  };
}

export default function MonthlyRecapCard({
  lessons,
  paymentCycles,
  students = [],
  scheduledLessons = [],
  tutorName,
  currentMonthPendingOverride,
}) {
  const terms = useTerms();
  const [monthDate, setMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [generating, setGenerating] = useState(false);
  const reportRef = useRef(null);

  const current = useMemo(() => {
    const computed = computeForMonth(
      monthDate,
      lessons,
      paymentCycles,
      students,
      scheduledLessons,
    );
    const now = new Date();
    const isCurrentMonth =
      monthDate.getFullYear() === now.getFullYear() &&
      monthDate.getMonth() === now.getMonth();
    if (isCurrentMonth && currentMonthPendingOverride != null) {
      return {
        ...computed,
        pending: currentMonthPendingOverride,
        total: computed.collected + currentMonthPendingOverride,
      };
    }
    return computed;
  }, [
    monthDate,
    lessons,
    paymentCycles,
    students,
    scheduledLessons,
    currentMonthPendingOverride,
  ]);
  const message =
    current.projectedEarnings > 3000
      ? "🔥 Amazing month! You're on fire!"
      : current.projectedEarnings >= 2000
        ? "💪 Solid month! Keep it going!"
        : `📈 Building up — every ${terms.lesson.toLowerCase()} counts!`;

  const monthLabel = formatMonth(monthDate);

  const goToMonth = (offset) => {
    setMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
  };

  const report = useMemo(
    () => buildMonthlyReport(monthDate, students, lessons, paymentCycles),
    [monthDate, students, lessons, paymentCycles],
  );

  const handleDownloadPdf = () => {
    downloadMonthlyReportPdf(monthDate, tutorName, report);
  };

  const handleSaveImage = async () => {
    setGenerating(true);
    try {
      await downloadMonthlyReportImage(reportRef.current, monthDate);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {monthLabel} recap
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
            className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-2.5 text-sm text-gray-600 hover:bg-[#d6ede6]"
          >
            ←
          </button>
          <button
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-2.5 text-sm text-gray-600 hover:bg-[#d6ede6]"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-900">
            {current.totalLessons}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            📚 {terms.lessons} taught
          </p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-[#0f7a58]">
            {formatSGD(current.collected)}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">✅ Collected</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-amber-700">
            {formatSGD(current.pending)}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">⏳ Pending</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-900">
            {formatSGD(current.projectedEarnings)}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            📈 Projected earnings
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-sm font-medium text-gray-700">
        {message}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          onClick={handleDownloadPdf}
          className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-4 text-sm font-medium text-[#0f7a58] transition hover:bg-[#d6ede6]"
        >
          📄 Download Report
        </button>
        <button
          onClick={handleSaveImage}
          disabled={generating}
          className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-4 text-sm font-medium text-[#0f7a58] transition hover:bg-[#d6ede6] disabled:opacity-50"
        >
          {generating ? "Generating..." : "🖼️ Save as Image"}
        </button>
      </div>

      <MonthlyReportTemplate
        ref={reportRef}
        tutorName={tutorName}
        monthLabel={monthLabel}
        report={report}
      />
    </section>
  );
}
