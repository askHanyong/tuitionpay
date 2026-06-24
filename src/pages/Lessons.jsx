import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { buildPaymentNoticeMessage, formatSGD } from "../lib/paymentNotice";
import { formatDate } from "../lib/date";
import { buildLessonIcs, downloadIcs } from "../lib/ics";
import { autoCompletePastLessons } from "../lib/autoCompleteLessons";
import AppShell from "../components/AppShell";

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (students, prefillDate) => ({
  student_id: students[0]?.id ?? "",
  lesson_date: prefillDate ?? today(),
  lesson_time: "09:00",
  duration_hours: students[0]?.lesson_duration_hours ?? "",
  rate: students[0]?.hourly_rate ?? "",
  notes: "",
});

export default function Lessons() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const prefillDate = location.state?.lessonDate;
  const editLessonId = location.state?.editLessonId;
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(emptyForm([], prefillDate));
  const [submitting, setSubmitting] = useState(false);
  const [newCycle, setNewCycle] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    const load = async () => {
      await autoCompletePastLessons();
      const [
        { data: studentsData, error: studentsError },
        { data: lessonsData, error: lessonsError },
      ] = await Promise.all([
        supabase.from("students").select("*").order("name"),
        supabase
          .from("lessons")
          .select("*, students(name, subject, hourly_rate)")
          .order("lesson_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (studentsError) setError(studentsError.message);
      if (lessonsError) setError(lessonsError.message);
      setStudents(studentsData ?? []);
      setLessons(lessonsData ?? []);
      setForm((f) => emptyForm(studentsData ?? [], f.lesson_date));
      if (editLessonId) {
        const lesson = (lessonsData ?? []).find((l) => l.id === editLessonId);
        if (lesson) {
          setEditingId(lesson.id);
          setForm({
            student_id: lesson.student_id,
            lesson_date: lesson.lesson_date,
            lesson_time: lesson.lesson_time ?? "09:00",
            duration_hours: lesson.duration_minutes / 60,
            rate: lesson.rate ?? "",
            notes: lesson.notes ?? "",
          });
        }
      }
      setLoading(false);
    };
    load();
  }, [editLessonId]);

  const reloadLessons = async () => {
    const { data, error } = await supabase
      .from("lessons")
      .select("*, students(name, subject, hourly_rate)")
      .order("lesson_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) setError(error.message);
    setLessons(data ?? []);
  };

  // Position each lesson within its running 4-lesson billing sequence, based
  // on chronological lesson_date (not insertion order or DB cycle membership).
  const lessonPosition = useMemo(() => {
    const lessonsByStudent = new Map();
    for (const lesson of lessons) {
      if (!lessonsByStudent.has(lesson.student_id))
        lessonsByStudent.set(lesson.student_id, []);
      lessonsByStudent.get(lesson.student_id).push(lesson);
    }
    const positions = new Map();
    for (const group of lessonsByStudent.values()) {
      const sorted = [...group].sort((a, b) =>
        a.lesson_date < b.lesson_date
          ? -1
          : a.lesson_date > b.lesson_date
            ? 1
            : 0,
      );
      sorted.forEach((lesson, i) => positions.set(lesson.id, (i % 4) + 1));
    }
    return positions;
  }, [lessons]);

  const handleAddToCalendar = (lesson) => {
    const ics = buildLessonIcs({
      lesson,
      studentName: lesson.students?.name ?? "Lesson",
      subject: lesson.students?.subject,
      lessonNumber: lessonPosition.get(lesson.id) ?? 1,
      rate: lesson.rate ?? lesson.students?.hourly_rate ?? null,
    });
    downloadIcs(
      `${lesson.students?.name ?? "lesson"}-${lesson.lesson_date}.ics`,
      ics,
    );
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

  const resetForm = () => {
    setEditingId(null);
    setForm((f) => emptyForm(students, f.lesson_date));
  };

  const handleEditLesson = (lesson) => {
    setEditingId(lesson.id);
    setNewCycle(null);
    setInfo(null);
    setForm({
      student_id: lesson.student_id,
      lesson_date: lesson.lesson_date,
      lesson_time: lesson.lesson_time ?? "09:00",
      duration_hours: lesson.duration_minutes / 60,
      rate: lesson.rate ?? "",
      notes: lesson.notes ?? "",
    });
    document
      .getElementById("log-lesson-form-submit")
      ?.closest("form")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setNewCycle(null);
    setSubmitting(true);

    try {
      const durationHours = Number(form.duration_hours);
      const isFuture = form.lesson_date > today();
      const status = isFuture ? "scheduled" : "completed";

      if (editingId) {
        const { error } = await supabase
          .from("lessons")
          .update({
            student_id: form.student_id,
            lesson_date: form.lesson_date,
            lesson_time: form.lesson_time || null,
            duration_minutes: Math.round(durationHours * 60),
            rate: form.rate === "" ? null : Number(form.rate),
            notes: form.notes.trim() || null,
            status,
          })
          .eq("id", editingId);
        if (error) throw error;
        setInfo("Lesson updated.");
        resetForm();
        await reloadLessons();
        return;
      }

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
        lesson_time: form.lesson_time || null,
        duration_minutes: Math.round(durationHours * 60),
        rate: form.rate === "" ? null : Number(form.rate),
        notes: form.notes.trim() || null,
        status,
      });
      if (error) throw error;

      if (isFuture) {
        setInfo(
          "Lesson scheduled. It'll count toward billing once its date arrives.",
        );
      } else if ((beforeCount ?? 0) + 1 >= 4) {
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
    if (editingId === id) resetForm();
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
            className="font-medium text-green-600 hover:text-green-700"
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
            {editingId ? "Edit lesson" : "Log a lesson"}
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Time
              </label>
              <input
                type="time"
                required
                value={form.lesson_time}
                onChange={(e) =>
                  setForm({ ...form, lesson_time: e.target.value })
                }
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Lesson notes (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="e.g. Covered algebra chapter 3, struggling with fractions..."
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-green-600">{info}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow disabled:opacity-50"
              id="log-lesson-form-submit"
            >
              {submitting
                ? editingId
                  ? "Saving..."
                  : "Logging..."
                : editingId
                  ? "Save changes"
                  : "Log lesson"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
            )}
          </div>
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
            for lessons {formatDate(newCycle.period_start)} to{" "}
            {formatDate(newCycle.period_end)}.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleCopyNotice}
              className="min-h-11 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
            >
              {copied ? "Copied!" : "Copy payment notice"}
            </button>
            <Link
              to="/payments"
              className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
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
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
            <p className="mb-4 text-5xl">📚</p>
            <p className="mb-6 max-w-sm text-sm text-gray-600">
              No lessons logged yet. Start by logging your first lesson!
            </p>
            <a
              href="#log-lesson-form-submit"
              onClick={(e) => {
                e.preventDefault();
                document
                  .querySelector('select, input[type="date"]')
                  ?.closest("form")
                  ?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="flex min-h-11 items-center rounded-md bg-green-600 px-5 text-sm font-medium text-white hover:bg-green-700"
            >
              Log Lesson
            </a>
          </div>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {lessons.map((l) => (
                <li
                  key={l.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-2 font-medium text-gray-900">
                      <Link
                        to={`/students/${l.student_id}`}
                        className="hover:text-green-700"
                      >
                        {l.students?.name}
                      </Link>
                      {l.status === "scheduled" && (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Scheduled
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-gray-500">
                      {formatDate(l.lesson_date)}
                    </span>
                  </div>
                  <p className="mb-3 text-sm text-gray-600">
                    {(l.duration_minutes / 60).toFixed(2)}h
                    {l.rate != null && ` · $${l.rate}/hr`}
                    {` · Billed: ${l.payment_cycle_id ? "Yes" : "No"}`}
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleAddToCalendar(l)}
                      className="text-sm font-medium text-green-600 hover:text-green-700"
                    >
                      📅 Add to Calendar
                    </button>
                    <button
                      onClick={() => handleEditLesson(l)}
                      className="text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(l.id)}
                      className="text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
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
                    <tr key={l.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {formatDate(l.lesson_date)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <span className="flex items-center gap-2">
                          <Link
                            to={`/students/${l.student_id}`}
                            className="hover:text-green-700"
                          >
                            {l.students?.name}
                          </Link>
                          {l.status === "scheduled" && (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              Scheduled
                            </span>
                          )}
                        </span>
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
                          onClick={() => handleAddToCalendar(l)}
                          className="mr-3 font-medium text-green-600 hover:text-green-700"
                        >
                          📅 Add to Calendar
                        </button>
                        <button
                          onClick={() => handleEditLesson(l)}
                          className="mr-3 font-medium text-gray-700 hover:text-gray-900"
                        >
                          Edit
                        </button>
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
          </>
        )}
      </section>
    </AppShell>
  );
}
