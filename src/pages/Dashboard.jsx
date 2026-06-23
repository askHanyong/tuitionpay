import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatSGD } from "../lib/paymentNotice";
import { autoCompletePastLessons } from "../lib/autoCompleteLessons";
import { useToast } from "../contexts/ToastContext";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";
import Onboarding from "../components/Onboarding";

export default function Dashboard() {
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("tuitionpay_onboarding_dismissed") === "true",
  );
  const pendingCount = paymentCycles.filter(
    (c) => c.status === "pending",
  ).length;
  const showOnboarding =
    !loading && students.length === 0 && !onboardingDismissed;

  const loadAll = async () => {
    await autoCompletePastLessons();
    const [
      { data: studentsData },
      { data: lessonsData },
      { data: cyclesData },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("lessons")
        .select("*, students(name)")
        .eq("status", "completed")
        .order("created_at", { ascending: true }),
      supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .order("period_end", { ascending: false }),
    ]);
    setStudents(studentsData ?? []);
    setLessons(lessonsData ?? []);
    setPaymentCycles(cyclesData ?? []);
    setLoading(false);
  };

  useEffect(() => {
    const load = async () => {
      await loadAll();
    };
    load();
  }, []);

  // Position each lesson within its running 4-lesson billing sequence, based
  // purely on chronological lesson_date (not insertion order or which
  // payment_cycle_id it was actually billed under).
  const lessonsByStudent = new Map();
  for (const lesson of lessons) {
    if (!lessonsByStudent.has(lesson.student_id))
      lessonsByStudent.set(lesson.student_id, []);
    lessonsByStudent.get(lesson.student_id).push(lesson);
  }
  const lessonPosition = new Map();
  for (const group of lessonsByStudent.values()) {
    const sorted = [...group].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    sorted.forEach((lesson, i) => lessonPosition.set(lesson.id, (i % 4) + 1));
  }

  const openCountByStudent = new Map();
  for (const lesson of lessons) {
    if (lesson.payment_cycle_id) continue;
    openCountByStudent.set(
      lesson.student_id,
      (openCountByStudent.get(lesson.student_id) ?? 0) + 1,
    );
  }

  const recentLessons = [...lessons].slice(-3).reverse();

  const pendingCycleByStudent = new Map();
  for (const c of paymentCycles) {
    if (c.status === "pending") pendingCycleByStudent.set(c.student_id, c);
  }

  const lastLessonByStudent = new Map();
  for (const lesson of lessons) {
    const existing = lastLessonByStudent.get(lesson.student_id);
    if (!existing || lesson.lesson_date > existing) {
      lastLessonByStudent.set(lesson.student_id, lesson.lesson_date);
    }
  }

  const now = new Date();
  const monthLabel = now.toLocaleDateString("en-SG", {
    month: "long",
    year: "numeric",
  });
  const isThisMonth = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  };
  const collectedThisMonth = paymentCycles
    .filter((c) => c.status === "paid" && isThisMonth(c.paid_at))
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const pendingThisMonth = paymentCycles
    .filter((c) => c.status === "pending" && isThisMonth(c.created_at))
    .reduce((sum, c) => sum + Number(c.amount_due), 0);

  const handleCollectPayment = async (cycleId) => {
    const { error } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", cycleId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setPaymentCycles((prev) =>
      prev.map((c) =>
        c.id === cycleId
          ? { ...c, status: "paid", paid_at: new Date().toISOString() }
          : c,
      ),
    );
    showToast("Marked as paid.");
  };

  if (!loading && students.length === 0) {
    return (
      <AppShell>
        {showOnboarding && (
          <Onboarding
            onDismiss={() => setOnboardingDismissed(true)}
            onDone={loadAll}
          />
        )}
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <p className="mb-4 text-5xl">🎓</p>
          <p className="mb-6 max-w-sm text-sm text-gray-600">
            Welcome! Add your first student to get started.
          </p>
          <Link
            to="/students"
            className="flex min-h-11 items-center rounded-md bg-green-600 px-5 text-sm font-medium text-white hover:bg-green-700"
          >
            Add Student
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {!loading && pendingCycleByStudent.size > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <span className="font-semibold">⚠️ Payment due:</span>{" "}
          {[...pendingCycleByStudent.values()]
            .map(
              (c) =>
                `${c.students?.name} (${formatSGD(c.amount_due)}, due ${new Date(c.period_end).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })})`,
            )
            .join(", ")}{" "}
          — 4 lessons completed.
        </div>
      )}

      {!loading && (
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-gray-900">
            {monthLabel} earnings
          </h2>
          <p className="text-sm text-gray-700">
            <span className="font-medium text-green-700">
              ✅ Collected: {formatSGD(collectedThisMonth)}
            </span>
            {" · "}
            <span className="font-medium text-amber-700">
              ⏳ Pending: {formatSGD(pendingThisMonth)}
            </span>
            {" · "}
            <span className="font-semibold text-gray-900">
              Total: {formatSGD(collectedThisMonth + pendingThisMonth)}
            </span>
          </p>
        </section>
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Student payment progress
          </h2>
          <Link
            to="/students"
            className="text-sm font-medium text-green-600 hover:text-green-700"
          >
            Manage students →
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-gray-500">No students yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {students.map((s) => {
              const completed = openCountByStudent.get(s.id) ?? 0;
              const pendingCycle = pendingCycleByStudent.get(s.id);
              const paymentDue = Boolean(pendingCycle);
              const expectedAmount =
                s.hourly_rate != null && s.lesson_duration_hours != null
                  ? s.hourly_rate * s.lesson_duration_hours * 4
                  : null;
              const lastLessonDate = lastLessonByStudent.get(s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {s.name}
                      </span>
                      {s.subject && (
                        <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {s.subject}
                        </span>
                      )}
                      {paymentDue && (
                        <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                          Payment Due{" "}
                          {pendingCycle.period_end &&
                            `(${new Date(pendingCycle.period_end).toLocaleDateString("en-SG", { day: "numeric", month: "short" })})`}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {lastLessonDate
                        ? `Last lesson: ${new Date(lastLessonDate).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}`
                        : "No lessons yet"}
                    </p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-full max-w-40 flex-1 overflow-hidden rounded-full bg-gray-100 sm:w-24 sm:flex-none">
                        <div
                          className={`h-full rounded-full ${paymentDue ? "bg-red-500" : "bg-green-500"}`}
                          style={{
                            width: `${Math.min(completed, 4) * 25}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-500">
                        {completed}/4 lessons
                        {expectedAmount != null &&
                          ` · ${formatSGD(expectedAmount)} due at completion`}
                      </span>
                    </div>
                    {paymentDue && (
                      <button
                        onClick={() => handleCollectPayment(pendingCycle.id)}
                        className="min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700"
                      >
                        Collect Payment
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Recent lessons
          </h2>
          <Link
            to="/lessons"
            className="text-sm font-medium text-green-600 hover:text-green-700"
          >
            Log a lesson →
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : recentLessons.length === 0 ? (
          <p className="text-sm text-gray-500">No lessons logged yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentLessons.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {l.students?.name}
                  </p>
                  <p className="text-xs text-gray-500">{l.lesson_date}</p>
                </div>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                  Lesson {lessonPosition.get(l.id) ?? "?"} of 4
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Payment cycles
          </h2>
          <Link
            to="/payments"
            className="text-sm font-medium text-green-600 hover:text-green-700"
          >
            {pendingCount > 0
              ? `${pendingCount} notice${pendingCount > 1 ? "s" : ""} due →`
              : "View payments →"}
          </Link>
        </div>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : paymentCycles.length === 0 ? (
          <p className="text-sm text-gray-500">No payment cycles yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {paymentCycles.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <span className="text-sm text-gray-700">
                  {c.students?.name}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900">
                    {formatSGD(c.amount_due)}
                  </span>
                  <StatusBadge status={c.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
