import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";

export default function Dashboard() {
  const [students, setStudents] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [loading, setLoading] = useState(true);
  const pendingCount = paymentCycles.filter(
    (c) => c.status === "pending",
  ).length;

  useEffect(() => {
    const load = async () => {
      const [{ data: studentsData }, { data: cyclesData }] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .order("created_at", { ascending: false }),
        supabase
          .from("payment_cycles")
          .select("*, students(name)")
          .order("period_end", { ascending: false }),
      ]);
      setStudents(studentsData ?? []);
      setPaymentCycles(cyclesData ?? []);
      setLoading(false);
    };
    load();
  }, []);

  return (
    <AppShell>
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Students</h2>
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
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
            {students.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm text-gray-700">
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Lessons</h2>
          <Link
            to="/lessons"
            className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Log a lesson →
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Payment Cycles
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
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
            {paymentCycles.map((c) => (
              <li
                key={c.id}
                className="flex justify-between px-4 py-3 text-sm text-gray-700"
              >
                <span>{c.students?.name}</span>
                <span className="flex items-center gap-2">
                  ${c.amount_due}
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
