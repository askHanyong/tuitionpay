import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { buildPaymentNoticeMessage, formatSGD } from "../lib/paymentNotice";
import AppShell from "../components/AppShell";

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (students) => ({
  student_id: students[0]?.id ?? "",
  lesson_date: today(),
  duration_hours: students[0]?.lesson_duration_hours ?? "",
  rate: students[0]?.hourly_rate ?? "",
  notes: "",
});

export default function Lessons() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(emptyForm([]));
  const [submitting, setSubmitting] = useState(false);
  const [newCycle, setNewCycle] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      const [
        { data: studentsData, error: studentsError },
        { data: lessonsData, error: lessonsError },
      ] = await Promise.all([
        supabase.from("students").select("*").order("name"),
        supabase
          .from("lessons")
          .select("*, students(name)")
          .order("lesson_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (studentsError) setError(studentsError.message);
      if (lessonsError) setError(lessonsError.message);
      setStudents(studentsData ?? []);
      setLessons(lessonsData ?? []);
      setForm(emptyForm(studentsData ?? []));
      setLoading(false);
    };
    load();
  }, []);

  const reloadLessons = async () => {
    const { data, error } = await supabase
      .from("lessons")
      .select("*, students(name)")
      .order("lesson_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) setError(error.message);
    setLessons(data ?? []);
  };

  const handleStudentChange = (studentId) => {
    const student = students.find((s) => s.id === studentId);
    setForm({
      ...form,
      student_id: studentId,
      duration_hours: student?.lesson_duration_hours ?? "",
      rate: student?.hourly_rate ?? "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setNewCycle(null);
    setSubmitting(true);

    try {
      const durationHours = Number(form.duration_hours);
      const { count: beforeCount } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("student_id", form.student_id)
        .is("payment_cycle_id", null)
        .eq("status", "completed");

      const { error } = await supabase.from("lessons").insert({
        tutor_id: user.id,
        student_id: form.student_id,
        lesson_date: form.lesson_date,
        duration_minutes: Math.round(durationHours * 60),
        rate: form.rate === "" ? null : Number(form.rate),
        notes: form.notes.trim() || null,
      });
      if (error) throw error;

      if ((beforeCount ?? 0) + 1 >= 4) {
        const { data: cycle } = await supabase
          .from("payment_cycles")
          .select("*, students(name)")
          .eq("student_id", form.student_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        setNewCycle(cycle ?? null);
        setInfo(
          "Lesson logged. 4 lessons have now accumulated — a payment notice is ready below.",
        );
      } else {
        setInfo("Lesson logged.");
      }

      setForm((f) => ({ ...f, notes: "" }));
      await reloadLessons();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyNotice = async () => {
    if (!newCycle) return;
    const message = buildPaymentNoticeMessage({
      studentName: newCycle.students?.name,
      amountDue: newCycle.amount_due,
      periodStart: newCycle.period_start,
      periodEnd: newCycle.period_end,
      tutorName: user?.user_metadata?.full_name,
    });
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this lesson? This cannot be undone.")) return;
    setError(null);
    const { error } = await supabase.from("lessons").delete().eq("id", id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    await reloadLessons();
    showToast("Lesson deleted.");
  };

  return (
    <AppShell>
      {students.length === 0 && !loading ? (
        <p className="rounded-md border border-gray-200 bg-white p-5 text-sm text-gray-500">
          Add a student first before logging lessons.{" "}
          <Link
            to="/students"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            Add a student →
          </Link>
        </p>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-gray-900">
            Log a lesson
          </h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Student
              </label>
              <select
                required
                value={form.student_id}
                onChange={(e) => handleStudentChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Date
              </label>
              <input
                type="date"
                required
                value={form.lesson_date}
                onChange={(e) =>
                  setForm({ ...form, lesson_date: e.target.value })
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Duration (hours)
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.25"
                value={form.duration_hours}
                onChange={(e) =>
                  setForm({ ...form, duration_hours: e.target.value })
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Rate (SGD/hr)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.rate}
                onChange={(e) => setForm({ ...form, rate: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Notes
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? "Logging..." : "Log lesson"}
          </button>
        </form>
      )}

      {newCycle && (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-5">
          <h2 className="mb-2 text-base font-semibold text-gray-900">
            Payment notice ready
          </h2>
          <p className="mb-3 text-sm text-gray-700">
            {newCycle.students?.name} now owes{" "}
            <span className="font-semibold">
              {formatSGD(newCycle.amount_due)}
            </span>{" "}
            for lessons {newCycle.period_start} to {newCycle.period_end}.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCopyNotice}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              {copied ? "Copied!" : "Copy payment notice"}
            </button>
            <Link
              to="/payments"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              View all payments
            </Link>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Recent lessons
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : lessons.length === 0 ? (
          <p className="text-sm text-gray-500">No lessons logged yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="px-4 py-2 font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Rate</th>
                  <th className="px-4 py-2 font-medium">Billed</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {lessons.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-3 text-gray-900">{l.lesson_date}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {l.students?.name}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {(l.duration_minutes / 60).toFixed(2)}h
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {l.rate != null ? `$${l.rate}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {l.payment_cycle_id ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(l.id)}
                        className="font-medium text-red-600 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AppShell>
  );
}
