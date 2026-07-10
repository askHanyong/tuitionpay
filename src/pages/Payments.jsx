import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
import { formatSGD } from "../lib/paymentNotice";
import {
  formatDate,
  formatDateFull,
  formatMonth,
  formatMonthName,
  formatDayMonth,
} from "../utils/dateFormat";
import { lessonAmount } from "../lib/paymentMode";
import {
  buildPaidReceiptMessage,
  buildPaymentRequestMessage,
} from "../lib/whatsapp";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";
import MessagePreviewModal from "../components/MessagePreviewModal";

export default function Payments() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const terms = useTerms();
  const [cycles, setCycles] = useState([]);
  const [lessonDatesByCycle, setLessonDatesByCycle] = useState({});
  const [tutorProfile, setTutorProfile] = useState({});
  const [cycleProgress, setCycleProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);

  const load = async () => {
    const [{ data, error }, { data: tutorData }, { data: studentsData }] =
      await Promise.all([
        supabase
          .from("payment_cycles")
          .select(
            "*, students(name, subject, guardian_name, guardian_contact, payment_mode, payment_cycle_count, payment_custom_day)",
          )
          .eq("tutor_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("tutors")
          .select("full_name, paynow_number")
          .eq("id", user.id)
          .single(),
        supabase.from("students").select("*").eq("tutor_id", user.id),
      ]);
    if (error) setError(error.message);
    const excludedStudentIds = new Set(
      (studentsData ?? [])
        .filter((s) => s.archived || s.deleted_at)
        .map((s) => s.id),
    );
    const activeCycles = (data ?? []).filter(
      (c) => !excludedStudentIds.has(c.student_id),
    );
    setCycles(activeCycles);
    setTutorProfile(tutorData ?? {});

    const studentIds = [
      ...new Set(activeCycles.map((c) => c.student_id)),
    ];
    if (studentIds.length > 0) {
      const { data: lessonsData } = await supabase
        .from("lessons")
        .select("student_id, lesson_date")
        .eq("tutor_id", user.id)
        .in("student_id", studentIds)
        .eq("is_completed", true)
        .order("lesson_date", { ascending: true });
      const map = {};
      for (const c of activeCycles) {
        map[c.id] = (lessonsData ?? [])
          .filter(
            (l) =>
              l.student_id === c.student_id &&
              l.lesson_date >= c.period_start &&
              l.lesson_date <= c.period_end,
          )
          .map((l) => l.lesson_date);
      }
      setLessonDatesByCycle(map);
    }

    // "Due soon" / "in progress" students are mid-cycle: they have unbilled
    // completed lessons but haven't hit their full payment_cycle_count yet,
    // so no payment_cycles row exists for them at all. Compute that directly
    // from lessons rather than relying on payment_cycles, since that table
    // only gets a row once the whole cycle has landed.
    const students = (studentsData ?? []).filter((s) => !s.archived);
    const pendingStudentIds = new Set(
      activeCycles
        .filter((c) => c.status === "pending")
        .map((c) => c.student_id),
    );
    if (students.length > 0) {
      const allStudentIds = students.map((s) => s.id);
      const { data: allLessons } = await supabase
        .from("lessons")
        .select(
          "student_id, lesson_date, payment_cycle_id, is_completed, duration_minutes, rate",
        )
        .eq("tutor_id", user.id)
        .in("student_id", allStudentIds);

      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const result = [];
      for (const student of students) {
        if (pendingStudentIds.has(student.id)) continue;
        const studentLessons = (allLessons ?? []).filter(
          (l) => l.student_id === student.id,
        );
        const mode = student.payment_mode ?? "lessons";
        const nextLesson = studentLessons
          .filter((l) => !l.is_completed && l.lesson_date > todayStr)
          .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1))[0];

        // Monthly/custom-date billing has no fixed cycle size -- it's just
        // every unbilled completed lesson so far this month, accumulating
        // toward a total that's only actually due once the month ends (at
        // which point the backend creates a real payment_cycles row, shown
        // separately in `pending`). per_lesson billing gets a real cycle
        // the moment a lesson completes, so it never needs this estimate.
        if (mode === "monthly" || mode === "custom_date") {
          const thisMonthKey = todayStr.slice(0, 7);
          const openLessons = studentLessons.filter(
            (l) =>
              l.is_completed &&
              !l.payment_cycle_id &&
              l.lesson_date.slice(0, 7) === thisMonthKey,
          );
          const scheduledThisMonth = studentLessons.filter(
            (l) =>
              !l.is_completed && l.lesson_date.slice(0, 7) === thisMonthKey,
          );
          if (openLessons.length === 0 && scheduledThisMonth.length === 0)
            continue;
          const completedAmount = openLessons.reduce(
            (sum, l) => sum + lessonAmount(l, student),
            0,
          );
          const scheduledAmount = scheduledThisMonth.reduce(
            (sum, l) => sum + lessonAmount(l, student),
            0,
          );

          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          const daysToEnd = Math.round(
            (endOfMonth -
              new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
              (1000 * 60 * 60 * 24),
          );

          if (daysToEnd <= 7 && openLessons.length > 0) {
            const dueDateLabel = formatDayMonth(endOfMonth);
            let label = `⚠️ ${formatSGD(completedAmount)} due ${dueDateLabel}`;
            if (scheduledAmount > 0) {
              label += ` · +${formatSGD(scheduledAmount)} on ${dueDateLabel}`;
            }
            result.push({
              studentId: student.id,
              studentName: student.name,
              openCount: openLessons.length,
              cycleCount: null,
              monthLabel: formatMonth(now),
              expectedAmount: completedAmount + scheduledAmount,
              nextLessonDate: nextLesson?.lesson_date ?? null,
              isFullyDue: false,
              isMonthlyDueSoon: true,
              dueSoonLabel: label,
            });
            continue;
          }

          if (openLessons.length === 0) continue;
          result.push({
            studentId: student.id,
            studentName: student.name,
            openCount: openLessons.length,
            cycleCount: null,
            monthLabel: formatMonth(now),
            expectedAmount: completedAmount,
            nextLessonDate: nextLesson?.lesson_date ?? null,
            isFullyDue: false,
            isMonthlyDueSoon: false,
          });
          continue;
        }

        if (mode === "per_lesson") continue;

        const openLessonsAll = studentLessons.filter(
          (l) => l.is_completed && !l.payment_cycle_id,
        );
        const openCount = openLessonsAll.length;
        const cycleCount = student.payment_cycle_count ?? 4;
        if (openCount === 0) continue;

        const cycleLessons = [...openLessonsAll]
          .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1))
          .slice(-cycleCount);
        const cycleAmount = cycleLessons.reduce(
          (sum, l) => sum + lessonAmount(l, student),
          0,
        );
        // Once only the final lesson of the cycle is left, the tutor needs to
        // know the full amount that will be due, not just what's accumulated
        // so far -- project the remaining lesson at the cycle's average rate.
        const expectedAmount =
          openCount === cycleCount - 1
            ? (cycleAmount / openCount) * cycleCount
            : cycleAmount;

        // Identify the lesson that will actually complete this cycle (the
        // Nth lesson), not just the soonest scheduled lesson overall -- if
        // that completing lesson falls in a future month, the tutor cares
        // about which month payment is due in, not the next lesson's date.
        const scheduledNeeded = Math.max(cycleCount - openCount, 0);
        const upcoming = studentLessons
          .filter((l) => !l.is_completed && l.lesson_date > todayStr)
          .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
        const completingLesson =
          upcoming.length >= scheduledNeeded && scheduledNeeded > 0
            ? upcoming[scheduledNeeded - 1]
            : null;
        const completingMonthLabel =
          completingLesson &&
          completingLesson.lesson_date.slice(0, 7) !== todayStr.slice(0, 7)
            ? formatMonthName(completingLesson.lesson_date)
            : null;

        const sevenDaysOutStr = new Date(now.getTime() + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
        const isLessonsDueSoon = Boolean(
          completingLesson && completingLesson.lesson_date <= sevenDaysOutStr,
        );

        result.push({
          studentId: student.id,
          studentName: student.name,
          openCount,
          cycleCount,
          expectedAmount,
          nextLessonDate: nextLesson?.lesson_date ?? null,
          completingLessonDate: completingLesson?.lesson_date ?? null,
          completingMonthLabel,
          isLessonsDueSoon,
          isFullyDue: openCount >= cycleCount,
        });
      }
      setCycleProgress(result);
    }

    setLoading(false);
  };

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMarkPaid = async (id) => {
    setError(null);
    const { error } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tutor_id", user.id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    await load();
    showToast("Marked as paid.");
  };

  const handleRequestPayment = (cycle) => {
    const message = buildPaymentRequestMessage({
      studentName: cycle.students?.name,
      subject: cycle.students?.subject,
      lessonDates: lessonDatesByCycle[cycle.id] ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
      paynowNumber: tutorProfile.paynow_number,
      paymentMode: cycle.students?.payment_mode,
      monthLabel: formatMonth(cycle.period_end),
      dueDateLabel: formatDateFull(cycle.period_end),
    });
    setPreview({
      title: "Payment request",
      message,
      mode: "whatsapp",
    });
  };

  const handleSendReceipt = (cycle) => {
    const message = buildPaidReceiptMessage({
      studentName: cycle.students?.name,
      subject: cycle.students?.subject,
      lessonDates: lessonDatesByCycle[cycle.id] ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
    });
    setPreview({
      title: "Payment receipt",
      message,
      mode: "whatsapp",
    });
  };

  const pending = cycles.filter((c) => c.status === "pending");
  const settled = cycles.filter((c) => c.status !== "pending");
  const fullyDue = cycleProgress.filter((p) => p.isFullyDue);
  const dueSoon = cycleProgress.filter(
    (p) => !p.isFullyDue && p.cycleCount != null && p.isLessonsDueSoon,
  );
  const monthlyDueSoon = cycleProgress.filter(
    (p) => !p.isFullyDue && p.cycleCount == null && p.isMonthlyDueSoon,
  );
  const inProgress = cycleProgress.filter(
    (p) =>
      !p.isFullyDue &&
      !p.isMonthlyDueSoon &&
      (p.cycleCount == null || !p.isLessonsDueSoon),
  );
  const noticesCount =
    pending.length + fullyDue.length + dueSoon.length + monthlyDueSoon.length;

  return (
    <AppShell>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Payment notices due {noticesCount > 0 && `(${noticesCount})`}
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : noticesCount === 0 && settled.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
            <p className="mb-4 text-5xl">💰</p>
            <p className="max-w-sm text-sm text-gray-600">
              No payments yet.
            </p>
          </div>
        ) : noticesCount === 0 ? (
          <p className="text-sm text-gray-500">
            No payments due. A notice appears here automatically once a {terms.student.toLowerCase()}
            accumulates 4 {terms.lessons.toLowerCase()}.
          </p>
        ) : (
          <ul className="space-y-3">
            {fullyDue.map((p) => (
              <li
                key={`fullydue-${p.studentId}`}
                className="rounded-md border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {p.studentName}
                    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      ⚠️ Payment due
                    </span>
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(p.expectedAmount)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  ⚠️ {formatSGD(p.expectedAmount)} due — {p.cycleCount} {terms.lessons.toLowerCase()}
                  completed
                </p>
              </li>
            ))}
            {dueSoon.map((p) => (
              <li
                key={`duesoon-${p.studentId}`}
                className="rounded-md border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {p.studentName}
                    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      ⚠️ Due soon
                    </span>
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(p.expectedAmount)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  {p.openCount}/{p.cycleCount} {terms.lessons.toLowerCase()} done
                  {p.completingLessonDate &&
                    ` · Payment due after ${terms.lesson.toLowerCase()} ${p.cycleCount} on ${formatDayMonth(p.completingLessonDate)}`}
                </p>
              </li>
            ))}
            {monthlyDueSoon.map((p) => (
              <li
                key={`monthlyduesoon-${p.studentId}`}
                className="rounded-md border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {p.studentName}
                    <span className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                      ⚠️ Due soon
                    </span>
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(p.expectedAmount)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{p.dueSoonLabel}</p>
              </li>
            ))}
            {pending.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {c.students?.name}
                    <StatusBadge status={c.status} />
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(c.amount_due)}
                  </span>
                </div>
                <p className="mb-3 text-sm text-gray-600">
                  {formatDate(c.period_start)} to {formatDate(c.period_end)}
                  {c.students?.guardian_contact &&
                    ` · Contact: ${c.students.guardian_contact}`}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleMarkPaid(c.id)}
                    className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                  >
                    Mark as paid
                  </button>
                  <button
                    onClick={() => handleRequestPayment(c)}
                    className="min-h-11 rounded-md bg-orange-500 px-3 text-sm font-medium text-white transition hover:bg-orange-600 hover:shadow"
                  >
                    💬 Request Payment
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {inProgress.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            Current cycles in progress
          </h2>
          <ul className="space-y-3">
            {inProgress.map((p) => (
              <li
                key={`inprogress-${p.studentId}`}
                className="rounded-md border border-blue-200 bg-blue-50 p-4"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium text-gray-900">
                    {p.studentName}
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(p.expectedAmount)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  {p.cycleCount != null
                    ? `${p.openCount}/${p.cycleCount} ${terms.lessons.toLowerCase()} done`
                    : `${p.monthLabel}: ${p.openCount} ${p.openCount === 1 ? terms.lesson.toLowerCase() : terms.lessons.toLowerCase()} done`}
                  {p.completingMonthLabel
                    ? ` · Payment due in ${p.completingMonthLabel}`
                    : p.nextLessonDate &&
                      ` · Next ${terms.lesson.toLowerCase()} on ${formatDate(p.nextLessonDate)}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">History</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : settled.length === 0 ? (
          <p className="text-sm text-gray-500">
            No settled payment cycles yet.
          </p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {settled.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {c.students?.name}
                    </span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    {formatDate(c.period_start)} – {formatDate(c.period_end)} ·{" "}
                    {formatSGD(c.amount_due)}
                  </p>
                  {c.status === "paid" && (
                    <button
                      onClick={() => handleSendReceipt(c)}
                      className="mt-2 min-h-11 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                    >
                      💬 Send WhatsApp Receipt
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">{terms.student}</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {settled.map((c) => (
                    <tr key={c.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {c.students?.name}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(c.period_start)} –{" "}
                        {formatDate(c.period_end)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatSGD(c.amount_due)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.status === "paid" && (
                          <button
                            onClick={() => handleSendReceipt(c)}
                            className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
                          >
                            💬 Send WhatsApp Receipt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {preview && (
        <MessagePreviewModal
          title={preview.title}
          initialMessage={preview.message}
          mode={preview.mode}
          onClose={() => setPreview(null)}
        />
      )}
    </AppShell>
  );
}
