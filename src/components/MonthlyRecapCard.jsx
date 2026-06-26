import { useMemo, useRef, useState } from "react";
import { formatSGD } from "../lib/paymentNotice";
import { buildMonthlyReport } from "../lib/monthlyReport";
import { downloadMonthlyReportPdf } from "../lib/pdfReport";
import { downloadMonthlyReportImage } from "../lib/imageReport";
import MonthlyReportTemplate from "./MonthlyReportTemplate";
import { formatMonth } from "../utils/dateFormat";

function isSameMonth(dateStr, monthDate) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return (
    d.getFullYear() === monthDate.getFullYear() &&
    d.getMonth() === monthDate.getMonth()
  );
}

function computeForMonth(monthDate, lessons, paymentCycles, students) {
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
  // A payment cycle only gets created once its full lesson group has
  // landed, so a student mid-cycle (e.g. 3 of 4 lessons done) has no
  // payment_cycles row yet. Once at least one of this month's lessons has
  // landed unbilled (payment_cycle_id is null), the FULL cycle amount is
  // what's actually pending -- that's what gets collected the moment the
  // last lesson in the cycle is logged, not just the lessons-so-far amount.
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const midCycleStudentIds = new Set(
    monthLessons.filter((l) => !l.payment_cycle_id).map((l) => l.student_id),
  );
  const pendingFromMidCycleLessons = [...midCycleStudentIds].reduce(
    (sum, studentId) => {
      const student = studentsById.get(studentId);
      if (!student) return sum;
      const cycleAmount =
        (student.hourly_rate ?? 0) *
        (student.lesson_duration_hours ?? 0) *
        (student.payment_cycle_count ?? 4);
      return sum + cycleAmount;
    },
    0,
  );
  const pending = pendingFromCycles + pendingFromMidCycleLessons;

  return {
    totalLessons: monthLessons.length,
    collected,
    pending,
    total: collected + pending,
  };
}

export default function MonthlyRecapCard({
  lessons,
  paymentCycles,
  students = [],
  tutorName,
}) {
  const [monthDate, setMonthDate] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [generating, setGenerating] = useState(false);
  const reportRef = useRef(null);

  const prevMonthDate = useMemo(
    () => new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1),
    [monthDate],
  );

  const current = useMemo(
    () => computeForMonth(monthDate, lessons, paymentCycles, students),
    [monthDate, lessons, paymentCycles, students],
  );
  const previous = useMemo(
    () => computeForMonth(prevMonthDate, lessons, paymentCycles, students),
    [prevMonthDate, lessons, paymentCycles, students],
  );

  const change =
    previous.total > 0
      ? Math.round(((current.total - previous.total) / previous.total) * 100)
      : null;

  const message =
    current.total > 3000
      ? "🔥 Amazing month! You're on fire!"
      : current.total >= 2000
        ? "💪 Solid month! Keep it going!"
        : "📈 Building up — every lesson counts!";

  const monthLabel = formatMonth(monthDate);
  const prevMonthLabel = prevMonthDate.toLocaleDateString("en-SG", {
    month: "short",
  });

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
    <section className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {monthLabel} recap
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
            className="min-h-11 rounded-md border border-green-300 bg-white px-2.5 text-sm text-gray-600 hover:bg-green-100"
          >
            ←
          </button>
          <button
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            className="min-h-11 rounded-md border border-green-300 bg-white px-2.5 text-sm text-gray-600 hover:bg-green-100"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-900">
            {current.totalLessons}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            📚 Lessons taught
          </p>
        </div>
        <div className="text-center">
          <p className="text-xl font-semibold text-green-700">
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
            {formatSGD(current.total)}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-600">
            💰 Total earned
            {change != null && (
              <span
                className={`ml-1 font-semibold ${
                  change >= 0 ? "text-green-600" : "text-red-600"
                }`}
              >
                {change >= 0 ? "↑" : "↓"} {Math.abs(change)}% vs{" "}
                {prevMonthLabel}
              </span>
            )}
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-sm font-medium text-gray-700">
        {message}
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <button
          onClick={handleDownloadPdf}
          className="min-h-11 rounded-md border border-green-300 bg-white px-4 text-sm font-medium text-green-700 transition hover:bg-green-100"
        >
          📄 Download Report
        </button>
        <button
          onClick={handleSaveImage}
          disabled={generating}
          className="min-h-11 rounded-md border border-green-300 bg-white px-4 text-sm font-medium text-green-700 transition hover:bg-green-100 disabled:opacity-50"
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
