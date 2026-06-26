import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { buildPaymentNoticeMessage, formatSGD } from "../lib/paymentNotice";
import { formatDate, formatDateTime } from "../utils/dateFormat";
import { buildLessonIcs, downloadIcs } from "../lib/ics";
import { createCalendarEvent, isGoogleTokenValid } from "../lib/googleCalendar";
import { showAppNotification } from "../lib/notifications";
import AppShell from "../components/AppShell";

const today = () => new Date().toISOString().slice(0, 10);

const emptyForm = (students, prefillDate, defaultTime) => ({
  student_id: students[0]?.id ?? "",
  lesson_date: prefillDate ?? today(),
  lesson_time: defaultTime ?? "",
  duration_hours: students[0]?.lesson_duration_hours ?? "",
  rate: students[0]?.hourly_rate ?? "",
  notes: "",
});

// Most recently used lesson_time for a student, based on the latest lesson_date.
function mostRecentLessonTime(lessons, studentId) {
  const matches = lessons
    .filter((l) => l.student_id === studentId && l.lesson_time)
    .sort((a, b) => (a.lesson_date < b.lesson_date ? 1 : -1));
  return matches[0]?.lesson_time?.slice(0, 5) ?? "";
}

function isLessonCompleted(lesson) {
  return lesson.is_completed;
}

function LessonActionsMenu({ onAddToCalendar, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Lesson actions"
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onAddToCalendar();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            📅 Add to Calendar
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-50"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

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
      const [
        { data: studentsData, error: studentsError },
        { data: lessonsData, error: lessonsError },
      ] = await Promise.all([
        supabase.from("students").select("*").order("name"),
        supabase
          .from("lessons")
          .select(
            "*, students(name, subject, hourly_rate, payment_mode, payment_cycle_count)",
          )
          .order("lesson_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (studentsError) setError(studentsError.message);
      if (lessonsError) setError(lessonsError.message);
      setStudents(studentsData ?? []);
      setLessons(lessonsData ?? []);
      setForm((f) =>
        emptyForm(
          studentsData ?? [],
          f.lesson_date,
          mostRecentLessonTime(lessonsData ?? [], (studentsData ?? [])[0]?.id),
        ),
      );
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
      .select(
        "*, students(name, subject, hourly_rate, payment_mode, payment_cycle_count)",
      )
      .order("lesson_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) setError(error.message);
    setLessons(data ?? []);
  };

  // Position each lesson within its billing sequence, based on chronological
  // lesson_date (not insertion order or DB cycle membership). For monthly /
  // custom_date students, the sequence resets every calendar month since
  // there is no fixed cycle size.
  const lessonPosition = useMemo(() => {
    const isMonthlyBilled = (lesson) => {
      const mode = lesson.students?.payment_mode ?? "lessons";
      return mode === "monthly" || mode === "custom_date";
    };
    const groupKey = (lesson) =>
      isMonthlyBilled(lesson)
        ? `${lesson.student_id}|${lesson.lesson_date?.slice(0, 7)}`
        : lesson.student_id;
    const lessonsByGroup = new Map();
    for (const lesson of lessons) {
      const key = groupKey(lesson);
      if (!lessonsByGroup.has(key)) lessonsByGroup.set(key, []);
      lessonsByGroup.get(key).push(lesson);
    }
    const positions = new Map();
    for (const group of lessonsByGroup.values()) {
      const cycleCount = group[0]?.students?.payment_cycle_count ?? 4;
      const monthly = isMonthlyBilled(group[0]);
      const sorted = [...group].sort((a, b) =>
        a.lesson_date < b.lesson_date
          ? -1
          : a.lesson_date > b.lesson_date
            ? 1
            : 0,
      );
      sorted.forEach((lesson, i) =>
        positions.set(lesson.id, monthly ? i + 1 : (i % cycleCount) + 1),
      );
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

  const addLessonToGoogleCalendar = async ({
    studentId,
    lessonDate,
    lessonTime,
    durationMinutes,
    lessonNumber,
  }) => {
    const { data: tutor } = await supabase
      .from("tutors")
      .select("google_access_token, google_token_expiry")
      .eq("id", user.id)
      .single();
    if (!isGoogleTokenValid(tutor)) return;

    const student = students.find((s) => s.id === studentId);
    const start = new Date(`${lessonDate}T${lessonTime || "09:00"}:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const mode = student?.payment_mode ?? "lessons";
    const isMonthlyBilled = mode === "monthly" || mode === "custom_date";
    const lessonLabel = isMonthlyBilled
      ? `Lesson ${lessonNumber}`
      : `Lesson ${lessonNumber} of ${student?.payment_cycle_count ?? 4}`;
    try {
      await createCalendarEvent(tutor.google_access_token, {
        summary: `${student?.name ?? "Lesson"} - ${student?.subject || "Lesson"} (${lessonLabel})`,
        description: `${lessonLabel} for ${student?.name ?? "student"}`,
        start: start.toISOString(),
        end: end.toISOString(),
      });
    } catch (err) {
      showToast(
        `Lesson logged, but Google Calendar event failed: ${err.message}`,
        "error",
      );
    }
  };

  const handleStudentChange = (studentId) => {
    const student = students.find((s) => s.id === studentId);
    setForm({
      ...form,
      student_id: studentId,
      duration_hours: student?.lesson_duration_hours ?? "",
      rate: student?.hourly_rate ?? "",
      lesson_time: mostRecentLessonTime(lessons, studentId),
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setForm((f) =>
      emptyForm(
        students,
        f.lesson_date,
        mostRecentLessonTime(lessons, students[0]?.id),
      ),
    );
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
      // Only strictly past-dated lessons auto-complete on entry. Lessons
      // dated today must still go through an explicit "Mark as Done" tap,
      // same as lessons logged via Today's Lessons / the calendar. When
      // editing, don't silently flip an already-completed lesson back to
      // incomplete just because its date happens to be today.
      const original = editingId
        ? lessons.find((l) => l.id === editingId)
        : null;
      const is_completed = isFuture
        ? false
        : form.lesson_date < today()
          ? true
          : (original?.is_completed ?? false);

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
            is_completed,
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
        .eq("is_completed", true);

      const { error } = await supabase.from("lessons").insert({
        tutor_id: user.id,
        student_id: form.student_id,
        lesson_date: form.lesson_date,
        lesson_time: form.lesson_time || null,
        duration_minutes: Math.round(durationHours * 60),
        rate: form.rate === "" ? null : Number(form.rate),
        notes: form.notes.trim() || null,
        status,
        is_completed,
      });
      if (error) throw error;

      await addLessonToGoogleCalendar({
        studentId: form.student_id,
        lessonDate: form.lesson_date,
        lessonTime: form.lesson_time,
        durationMinutes: Math.round(durationHours * 60),
        lessonNumber: ((beforeCount ?? 0) % 4) + 1,
      });

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
        if (cycle) {
          const { data: tutor } = await supabase
            .from("tutors")
            .select("notify_payment_due")
            .eq("id", user.id)
            .single();
          if (tutor?.notify_payment_due) {
            showAppNotification(
              `${cycle.students?.name} has completed 4 lessons — ${formatSGD(cycle.amount_due)} due! 💰`,
            );
          }
        }
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
                Lesson time (optional)
              </label>
              <input
                type="time"
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
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                      <Link
                        to={`/students/${l.student_id}`}
                        className="hover:text-green-700"
                      >
                        {l.students?.name}
                      </Link>
                      {isLessonCompleted(l) ? (
                        <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Completed
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          Scheduled
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">
                        {formatDateTime(l.lesson_date, l.lesson_time)}
                      </span>
                      <LessonActionsMenu
                        onAddToCalendar={() => handleAddToCalendar(l)}
                        onEdit={() => handleEditLesson(l)}
                        onDelete={() => handleDelete(l.id)}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">
                    {(l.duration_minutes / 60).toFixed(2)}h
                    {l.rate != null && ` · $${l.rate}/hr`}
                    {" · "}
                    {!isLessonCompleted(l) ? (
                      <span className="text-gray-400">—</span>
                    ) : l.payment_cycle_id ? (
                      <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                        Paid
                      </span>
                    ) : (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                        Unpaid
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Student</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Rate</th>
                    <th className="px-4 py-2 font-medium">Payment</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {lessons.map((l) => (
                    <tr key={l.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {formatDateTime(l.lesson_date, l.lesson_time)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <Link
                          to={`/students/${l.student_id}`}
                          className="hover:text-green-700"
                        >
                          {l.students?.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {isLessonCompleted(l) ? (
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Completed
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                            Scheduled
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {(l.duration_minutes / 60).toFixed(2)}h
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {l.rate != null ? `$${l.rate}` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {!isLessonCompleted(l) ? (
                          <span className="text-gray-400">—</span>
                        ) : l.payment_cycle_id ? (
                          <span className="inline-block rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Paid
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Unpaid
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <LessonActionsMenu
                          onAddToCalendar={() => handleAddToCalendar(l)}
                          onEdit={() => handleEditLesson(l)}
                          onDelete={() => handleDelete(l.id)}
                        />
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
