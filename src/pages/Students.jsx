import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";

const emptyForm = {
  name: "",
  subject: "",
  hourly_rate: "",
  lesson_duration_hours: "",
};

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function Students() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [lessonsByStudent, setLessonsByStudent] = useState({});
  const [lessonsLoading, setLessonsLoading] = useState(false);

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

  const loadStudents = async () => {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setStudents(data ?? []);
    setLoading(false);
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
    };
    load();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload = {
      name: form.name.trim(),
      subject: form.subject.trim() || null,
      hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
      lesson_duration_hours:
        form.lesson_duration_hours === ""
          ? null
          : Number(form.lesson_duration_hours),
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

  const handleEdit = (student) => {
    setEditingId(student.id);
    setForm({
      name: student.name ?? "",
      subject: student.subject ?? "",
      hourly_rate: student.hourly_rate ?? "",
      lesson_duration_hours: student.lesson_duration_hours ?? "",
    });
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
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-gray-500">No students yet.</p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {students.map((s) => (
                <li
                  key={s.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-gray-900">{s.name}</span>
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
                  {students.map((s) => (
                    <Fragment key={s.id}>
                      <tr className="transition hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">{s.name}</td>
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
                {l.lesson_date} · {(l.duration_minutes / 60).toFixed(2)}h
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
                {l.lesson_date} · {(l.duration_minutes / 60).toFixed(2)}h
                {l.payment_cycle_id ? " · Billed" : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
