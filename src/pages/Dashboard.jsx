import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatSGD } from "../lib/paymentNotice";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";

export default function Dashboard() {
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
    group.forEach((lesson, i) => lessonPosition.set(lesson.id, i + 1));
    const [studentId, cycleKey] = key.split("|");
    if (cycleKey === "open") openCountByStudent.set(studentId, group.length);
  }

  const recentLessons = [...lessons].slice(-3).reverse();

  return (
    <AppShell>
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
              const paymentDue = completed >= 4;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {s.name}
                    </span>
                    {paymentDue && (
                      <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                        Payment Due
                      </span>
                    )}
                  </div>
                  <div className="flex w-40 items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${paymentDue ? "bg-red-500" : "bg-indigo-500"}`}
                        style={{ width: `${Math.min(completed, 4) * 25}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-500">
                      {completed}/4 lessons
                    </span>
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
