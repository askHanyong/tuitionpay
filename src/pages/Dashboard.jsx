import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatSGD } from "../lib/paymentNotice";
import { useToast } from "../contexts/ToastContext";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";

export default function Dashboard() {
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const pendingCount = paymentCycles.filter(
    (c) => c.status === "pending",
  ).length;

  useEffect(() => {
    const load = async () => {
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
    load();
  }, []);

  // Position each lesson within its 4-lesson billing group (cycled or still open).
  const groups = new Map();
  for (const lesson of lessons) {
    const key = `${lesson.student_id}|${lesson.payment_cycle_id ?? "open"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lesson);
  }
  const lessonPosition = new Map();
  const openCountByStudent = new Map();
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    sorted.forEach((lesson, i) => lessonPosition.set(lesson.id, i + 1));
    const [studentId, cycleKey] = key.split("|");
    if (cycleKey === "open") openCountByStudent.set(studentId, group.length);
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

  return (
    <AppShell>
      {!loading && pendingCycleByStudent.size > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm">
          <span className="font-semibold">⚠️ Payment due:</span>{" "}
          {[...pendingCycleByStudent.values()]
            .map((c) => `${c.students?.name} (${formatSGD(c.amount_due)})`)
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
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
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
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
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
                          Payment Due
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {lastLessonDate
                        ? `Last lesson: ${new Date(lastLessonDate).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })}`
                        : "No lessons yet"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${paymentDue ? "bg-red-500" : "bg-indigo-500"}`}
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
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
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
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
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
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
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
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
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
