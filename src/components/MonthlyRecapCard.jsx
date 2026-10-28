import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useTerms } from "../contexts/TerminologyContext";
import { formatSGD } from "../lib/paymentNotice";
import { buildMonthlyReport } from "../lib/monthlyReport";
import { downloadMonthlyReportPdf } from "../lib/pdfReport";
import { downloadMonthlyReportImage } from "../lib/imageReport";
import MonthlyReportTemplate from "./MonthlyReportTemplate";
import { formatMonth } from "../utils/dateFormat";
import { lessonAmount } from "../lib/paymentMode";
import { buildEarningsBreakdown } from "../lib/collectedBreakdown";

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
  // The mid-cycle estimate only makes sense for the month still in progress.
  // But a real payment_cycles row that is still unpaid is money genuinely
  // owed, so it must keep showing as pending even after its month has ended
  // (e.g. a Sept cycle still unpaid in October).
  const pending = isCurrentMonth
    ? pendingFromCycles + pendingFromMidCycleLessons
    : pendingFromCycles;

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

  // `monthLessons` comes from the `lessons` prop, which only covers
  // strictly-before-today (the caller fetches it that way so today's
  // lessons can be tracked separately for the "mark as done" UI). That
  // means a lesson completed earlier today wouldn't be counted here until
  // tomorrow. `scheduledThisMonth` covers today onward and is guaranteed
  // disjoint from `monthLessons` (same boundary, complementary
  // comparisons), so counting its already-completed entries is safe and
  // closes that gap without affecting `projectedEarnings` above, which
  // already correctly draws today's contribution from this same set.
  const lessonsTaughtThisMonth =
    monthLessons.length +
    scheduledThisMonth.filter((l) => l.is_completed).length;

  return {
    totalLessons: lessonsTaughtThisMonth,
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
  const { user } = useAuth();
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";
  const terms = useTerms();
  const [monthDate, setMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [generating, setGenerating] = useState(false);
  const reportRef = useRef(null);
  // null until loaded. If the load fails we hide the breakdown rather than
  // show wrong numbers (agency-collected money would look like "mine").
  const [payees, setPayees] = useState(null);
  // Which agency's per-student breakdown is open (lowercased name).
  const [openAgency, setOpenAgency] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    supabase
      .from("payees")
      .select("id, name, share_percent")
      .eq("tutor_id", user.id)
      .then(({ data, error }) => {
        if (!cancelled && !error) setPayees(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

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

  // What you keep vs what each agency earns, from lessons TAUGHT this month
  // (same basis as the agency statements). `lessons` only covers before today,
  // so today's completed lessons are added from `scheduledLessons`; the two
  // sets never overlap.
  const breakdown = useMemo(() => {
    if (payees === null) return null;
    const completed = [
      ...lessons,
      ...scheduledLessons.filter((l) => l.is_completed),
    ].filter((l) => l.is_completed);
    return buildEarningsBreakdown({
      monthDate,
      students,
      payees,
      lessons: completed,
    });
  }, [payees, students, lessons, scheduledLessons, monthDate]);

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
            📚 {terms.lessons} {isPractitioner ? "conducted" : "taught"}
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

      {breakdown && breakdown.agencyTotal > 0 && (
        <div className="mt-4 rounded-lg border border-[#b8e8d9] bg-white/70 p-3 text-sm">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {terms.lessons} taught — who earns what
          </p>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-gray-700">My take-home</span>
            <span className="font-semibold text-[#0f7a58]">
              {formatSGD(breakdown.mine)}
            </span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-gray-700">Agencies earn</span>
            <span className="font-semibold text-gray-900">
              {formatSGD(breakdown.agencyTotal)}
            </span>
          </div>
          {breakdown.agencies.map((a) => {
            const isOpen = openAgency === a.name.toLowerCase();
            const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
            return (
              <div key={a.name}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenAgency(isOpen ? null : a.name.toLowerCase())
                  }
                  aria-expanded={isOpen}
                  className="flex min-h-8 w-full items-center justify-between rounded py-0.5 pl-4 text-xs text-gray-600 hover:bg-[#edf6f3]"
                >
                  <span>
                    {isOpen ? "▾" : "▸"} {a.name}
                  </span>
                  <span className="font-medium underline decoration-dotted underline-offset-2">
                    {formatSGD(a.amount)}
                  </span>
                </button>
                {isOpen && (
                  <div className="mb-1 ml-4 rounded-md bg-[#edf6f3] p-2 text-xs text-gray-600">
                    {a.lines.map((l) => (
                      <div
                        key={`${l.kind}-${l.student}`}
                        className="flex items-start justify-between gap-2 py-0.5"
                      >
                        <span>
                          {l.student}
                          <span className="block text-[11px] text-gray-500">
                            {l.kind === "placement"
                              ? "Placement fee (100%)"
                              : `${100 - a.sharePct}% of ${formatSGD(l.billed)}${
                                  l.collectedBy === "me"
                                    ? " · you collected"
                                    : " · agency collected"
                                }`}
                          </span>
                        </span>
                        <span className="font-medium text-gray-800">
                          {formatSGD(l.amount)}
                        </span>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center justify-between border-t border-[#b8e8d9] pt-1 font-semibold text-gray-800">
                      <span>{a.name} earns</span>
                      <span>{formatSGD(a.amount)}</span>
                    </div>
                    {a.payeeId && (
                      <Link
                        to={`/statements?payee=${a.payeeId}&month=${monthStr}`}
                        className="mt-1 inline-block font-medium text-[#0f7a58] hover:underline"
                      >
                        Open {a.name} statement →
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-1 flex items-center justify-between border-t border-[#b8e8d9] pt-1.5">
            <span className="font-medium text-gray-700">Total billed</span>
            <span className="font-semibold text-gray-900">
              {formatSGD(breakdown.total)}
            </span>
          </div>
        </div>
      )}

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
