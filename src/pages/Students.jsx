import { Fragment, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import ScheduleLessonsModal from "../components/ScheduleLessonsModal";
import { formatDate } from "../utils/dateFormat";
import { formatSGD } from "../lib/paymentNotice";
import { LEVEL_OPTIONS } from "../lib/levels";

const emptyForm = {
  name: "",
  subject: "",
  level: "",
  hourly_rate: "",
  lesson_duration_hours: "",
  address: "",
  payment_mode: "lessons",
  payment_cycle_count: "4",
  payment_custom_day: "1",
};

const PAYMENT_MODE_OPTIONS = [
  { value: "lessons", label: "Every N lessons" },
  { value: "monthly", label: "End of each month" },
  { value: "per_lesson", label: "After each lesson" },
  { value: "custom_date", label: "On a specific day each month" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const SORT_OPTIONS = [
  { value: "payment_due", label: "Payment due soonest" },
  { value: "name_asc", label: "Name A–Z" },
  { value: "name_desc", label: "Name Z–A" },
  { value: "recent_lesson", label: "Most recent lesson" },
  { value: "rate_high", label: "Highest hourly rate" },
  { value: "rate_low", label: "Lowest hourly rate" },
];

export default function Students() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [lessonsByStudent, setLessonsByStudent] = useState({});
  const [lessonsLoading, setLessonsLoading] = useState(false);
  const [scheduleStudent, setScheduleStudent] = useState(null);
  const [rateBenchmark, setRateBenchmark] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("payment_due");
  const [dueDateByStudent, setDueDateByStudent] = useState({});
  const [lastLessonByStudent, setLastLessonByStudent] = useState({});

  const refreshLessonsFor = async (studentId) => {
    const { data } = await supabase
      .from("lessons")
      .select("*")
      .eq("student_id", studentId)
      .order("lesson_date", { ascending: false });
    setLessonsByStudent((prev) => ({ ...prev, [studentId]: data ?? [] }));
  };

  const toggleLessons = async (studentId) => {
    if (expandedId === studentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(studentId);
    if (!lessonsByStudent[studentId]) {
      setLessonsLoading(true);
      const { data } = await supabase
        .from("lessons")
        .select("*")
        .eq("student_id", studentId)
        .order("lesson_date", { ascending: false });
      setLessonsByStudent((prev) => ({ ...prev, [studentId]: data ?? [] }));
      setLessonsLoading(false);
    }
  };

  const loadSortSupportData = async () => {
    const [{ data: cyclesData }, { data: lessonsData }] = await Promise.all([
      supabase
        .from("payment_cycles")
        .select("student_id, period_end")
        .eq("status", "pending")
        .order("period_end", { ascending: true }),
      supabase
        .from("lessons")
        .select("student_id, lesson_date")
        .order("lesson_date", { ascending: false }),
    ]);
    const dueMap = {};
    for (const c of cyclesData ?? []) {
      if (!dueMap[c.student_id]) dueMap[c.student_id] = c.period_end;
    }
    setDueDateByStudent(dueMap);
    const lastLessonMap = {};
    for (const l of lessonsData ?? []) {
      if (!lastLessonMap[l.student_id]) {
        lastLessonMap[l.student_id] = l.lesson_date;
      }
    }
    setLastLessonByStudent(lastLessonMap);
  };

  const loadStudents = async () => {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setStudents(data ?? []);
    setLoading(false);
    loadSortSupportData();
  };

  const handleEdit = (student) => {
    setEditingId(student.id);
    setForm({
      name: student.name ?? "",
      subject: student.subject ?? "",
      level: student.level ?? "",
      hourly_rate: student.hourly_rate ?? "",
      lesson_duration_hours: student.lesson_duration_hours ?? "",
      address: student.address ?? "",
      payment_mode: student.payment_mode ?? "lessons",
      payment_cycle_count: String(student.payment_cycle_count ?? 4),
      payment_custom_day: String(student.payment_custom_day ?? 1),
    });
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) setError(error.message);
      setStudents(data ?? []);
      setLoading(false);
      loadSortSupportData();
      const editStudentId = location.state?.editStudentId;
      if (editStudentId) {
        const target = (data ?? []).find((s) => s.id === editStudentId);
        if (target) handleEdit(target);
        navigate(location.pathname, { replace: true, state: {} });
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subject = form.subject.trim();
    const level = form.level;
    let cancelled = false;
    const fetchBenchmark = async () => {
      if (!subject || !level) {
        if (!cancelled) setRateBenchmark(null);
        return;
      }
      const { data } = await supabase.rpc("rate_benchmark", {
        p_subject: subject,
        p_level: level,
      });
      if (!cancelled) setRateBenchmark(data?.[0] ?? null);
    };
    fetchBenchmark();
    return () => {
      cancelled = true;
    };
  }, [form.subject, form.level]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setRateBenchmark(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim() || null,
      level: form.level || null,
      hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
      lesson_duration_hours:
        form.lesson_duration_hours === ""
          ? null
          : Number(form.lesson_duration_hours),
      address: form.address.trim() || null,
      payment_mode: form.payment_mode,
      payment_cycle_count:
        form.payment_mode === "lessons" ? Number(form.payment_cycle_count) : 4,
      payment_custom_day:
        form.payment_mode === "custom_date"
          ? Number(form.payment_custom_day)
          : null,
    };

    try {
      if (editingId) {
        const { error } = await supabase
          .from("students")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("students")
          .insert({ ...payload, tutor_id: user.id });
        if (error) throw error;
      }
      resetForm();
      await loadStudents();
      showToast(editingId ? "Student updated." : "Student added.");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this student? This cannot be undone.")) return;
    setError(null);
    const { error } = await supabase.from("students").delete().eq("id", id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    if (editingId === id) resetForm();
    await loadStudents();
    showToast("Student deleted.");
  };

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredStudents = normalizedSearch
    ? students.filter(
        (s) =>
          s.name?.toLowerCase().includes(normalizedSearch) ||
          s.subject?.toLowerCase().includes(normalizedSearch),
      )
    : students;

  const sortedStudents = [...filteredStudents].sort((a, b) => {
    switch (sortBy) {
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "rate_high":
      case "rate_low": {
        const aRate = a.hourly_rate;
        const bRate = b.hourly_rate;
        if (aRate == null && bRate == null) return 0;
        if (aRate == null) return 1;
        if (bRate == null) return -1;
        return sortBy === "rate_high" ? bRate - aRate : aRate - bRate;
      }
      case "recent_lesson": {
        const aDate = lastLessonByStudent[a.id];
        const bDate = lastLessonByStudent[b.id];
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate > bDate ? -1 : 1;
      }
      case "payment_due":
      default: {
        const aDue = dueDateByStudent[a.id];
        const bDue = dueDateByStudent[b.id];
        if (!aDue && !bDue) return a.name.localeCompare(b.name);
        if (!aDue) return 1;
        if (!bDue) return -1;
        return aDue < bDue ? -1 : 1;
      }
    }
  });

  return (
    <AppShell>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold text-gray-900">
          {editingId ? "Edit student" : "Add a student"}
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Name
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Subject
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Level
            </label>
            <select
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="">Select level...</option>
              {LEVEL_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Hourly rate (SGD)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.hourly_rate}
              onChange={(e) =>
                setForm({ ...form, hourly_rate: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            {rateBenchmark &&
              (rateBenchmark.sample_size >= 3 ? (
                <p className="mt-1 text-xs text-gray-500">
                  💡 Tutors charge an average of{" "}
                  {formatSGD(rateBenchmark.avg_rate)}/hr (range{" "}
                  {formatSGD(rateBenchmark.min_rate)}–
                  {formatSGD(rateBenchmark.max_rate)}/hr) for {form.level}{" "}
                  {form.subject.trim()}.
                </p>
              ) : (
                <p className="mt-1 text-xs text-gray-500">
                  💡 Not enough data yet for this subject and level —
                  you&apos;ll be among the first!
                </p>
              ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Lesson duration (hours)
            </label>
            <input
              type="number"
              min="0"
              step="0.25"
              value={form.lesson_duration_hours}
              onChange={(e) =>
                setForm({ ...form, lesson_duration_hours: e.target.value })
              }
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Home address (optional)
          </label>
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="e.g. 123 Clementi Ave 3, #05-12, Singapore 120123"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>

        <div className="rounded-md border border-gray-200 p-4">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Payment cycle
          </label>
          <div className="space-y-2">
            {PAYMENT_MODE_OPTIONS.map((opt) => (
              <div key={opt.value} className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    name="payment_mode"
                    value={opt.value}
                    checked={form.payment_mode === opt.value}
                    onChange={() =>
                      setForm({ ...form, payment_mode: opt.value })
                    }
                  />
                  {opt.label}
                </label>
                {opt.value === "lessons" && form.payment_mode === "lessons" && (
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={form.payment_cycle_count}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        payment_cycle_count: e.target.value,
                      })
                    }
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                )}
                {opt.value === "custom_date" &&
                  form.payment_mode === "custom_date" && (
                    <select
                      value={form.payment_custom_day}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          payment_custom_day: e.target.value,
                        })
                      }
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map(
                        (day) => (
                          <option key={day} value={day}>
                            {day}
                          </option>
                        ),
                      )}
                    </select>
                  )}
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow disabled:opacity-50"
          >
            {submitting
              ? "Saving..."
              : editingId
                ? "Save changes"
                : "Add student"}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Your students
        </h2>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              🔍
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search students by name or subject..."
              className="min-h-11 w-full rounded-md border border-gray-300 px-9 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-2 flex items-center px-1 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="min-h-11 rounded-md border border-gray-300 px-3 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 sm:w-56"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {normalizedSearch && !loading && (
          <p className="mb-4 inline-block rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
            Showing {sortedStudents.length} of {students.length} students
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-gray-500">No students yet.</p>
        ) : sortedStudents.length === 0 ? (
          <p className="text-sm text-gray-500">
            🔍 No students found for &quot;{searchTerm.trim()}&quot; — try a
            different name or subject.
          </p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {sortedStudents.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <Link
                      to={`/students/${s.id}`}
                      className="font-medium text-gray-900 hover:text-green-700"
                    >
                      {s.name}
                    </Link>
                    <span className="text-sm text-gray-700">
                      {s.hourly_rate != null ? `$${s.hourly_rate}/hr` : "—"}
                    </span>
                  </div>
                  <p className="mb-3 text-sm text-gray-500">
                    {s.subject || "—"}
                    {s.lesson_duration_hours != null &&
                      ` · ${s.lesson_duration_hours}h lessons`}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => toggleLessons(s.id)}
                      className="text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      {expandedId === s.id ? "Hide lessons" : "View lessons"}
                    </button>
                    <button
                      onClick={() => setScheduleStudent(s)}
                      className="text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      Schedule Lessons
                    </button>
                    <button
                      onClick={() => handleEdit(s)}
                      className="text-sm font-medium text-green-600 hover:text-green-700"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="text-sm font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                  {expandedId === s.id && (
                    <StudentLessonsPanel
                      loading={lessonsLoading}
                      lessons={lessonsByStudent[s.id] ?? []}
                    />
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-4 py-2 font-medium">Subject</th>
                    <th className="px-4 py-2 font-medium">Rate (SGD/hr)</th>
                    <th className="px-4 py-2 font-medium">Duration (hrs)</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {sortedStudents.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="transition hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">
                          <Link
                            to={`/students/${s.id}`}
                            className="hover:text-green-700"
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {s.subject || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {s.hourly_rate != null ? `$${s.hourly_rate}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {s.lesson_duration_hours ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => toggleLessons(s.id)}
                            className="mr-3 font-medium text-gray-700 hover:text-gray-900"
                          >
                            {expandedId === s.id
                              ? "Hide lessons"
                              : "View lessons"}
                          </button>
                          <button
                            onClick={() => setScheduleStudent(s)}
                            className="mr-3 font-medium text-gray-700 hover:text-gray-900"
                          >
                            Schedule Lessons
                          </button>
                          <button
                            onClick={() => handleEdit(s)}
                            className="mr-3 font-medium text-green-600 hover:text-green-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(s.id)}
                            className="font-medium text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                      {expandedId === s.id && (
                        <tr>
                          <td colSpan={5} className="bg-gray-50 px-4 py-3">
                            <StudentLessonsPanel
                              loading={lessonsLoading}
                              lessons={lessonsByStudent[s.id] ?? []}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {scheduleStudent && (
        <ScheduleLessonsModal
          student={scheduleStudent}
          onClose={() => setScheduleStudent(null)}
          onScheduled={() => refreshLessonsFor(scheduleStudent.id)}
        />
      )}
    </AppShell>
  );
}

function StudentLessonsPanel({ loading, lessons }) {
  if (loading) {
    return <p className="text-sm text-gray-500">Loading lessons...</p>;
  }

  const upcoming = lessons
    .filter((l) => l.status === "scheduled" || l.lesson_date > todayStr())
    .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
  const past = lessons
    .filter((l) => l.status !== "scheduled" && l.lesson_date <= todayStr())
    .sort((a, b) => (a.lesson_date > b.lesson_date ? -1 : 1));

  if (lessons.length === 0) {
    return <p className="text-sm text-gray-500">No lessons logged yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          Upcoming ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500">No upcoming lessons.</p>
        ) : (
          <ul className="space-y-1">
            {upcoming.map((l) => (
              <li key={l.id} className="text-sm text-gray-700">
                {formatDate(l.lesson_date)} ·{" "}
                {(l.duration_minutes / 60).toFixed(2)}h
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          Past ({past.length})
        </h3>
        {past.length === 0 ? (
          <p className="text-sm text-gray-500">No past lessons.</p>
        ) : (
          <ul className="space-y-1">
            {past.map((l) => (
              <li key={l.id} className="text-sm text-gray-700">
                {formatDate(l.lesson_date)} ·{" "}
                {(l.duration_minutes / 60).toFixed(2)}h
                {l.payment_cycle_id ? " · Billed" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
