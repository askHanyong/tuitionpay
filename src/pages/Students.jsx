import { Fragment, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import ScheduleLessonsModal from "../components/ScheduleLessonsModal";
import { formatDate } from "../utils/dateFormat";
import { LEVEL_OPTIONS } from "../lib/levels";
import {
  computeStudentPaymentStatus,
  tierRank,
  TIER_BADGE_CLASSES,
} from "../lib/paymentStatus";

const emptySubjectRow = () => ({
  id: null,
  subject: "",
  level: "",
  hourly_rate: "",
  lesson_duration_hours: "",
});

const emptyForm = {
  name: "",
  subjects: [emptySubjectRow()],
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
  const [subjectsByStudent, setSubjectsByStudent] = useState({});
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("payment_due");
  const [lastLessonByStudent, setLastLessonByStudent] = useState({});
  const [paymentStatusByStudent, setPaymentStatusByStudent] = useState({});

  const refreshLessonsFor = async (studentId) => {
    const { data } = await supabase
      .from("lessons")
      .select("*")
      .eq("student_id", studentId)
      .eq("tutor_id", user.id)
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
        .eq("tutor_id", user.id)
        .order("lesson_date", { ascending: false });
      setLessonsByStudent((prev) => ({ ...prev, [studentId]: data ?? [] }));
      setLessonsLoading(false);
    }
  };

  const loadSortSupportData = async (studentsList) => {
    const [{ data: cyclesData }, { data: lessonsData }] = await Promise.all([
      supabase
        .from("payment_cycles")
        .select("student_id, status, period_start, period_end, amount_due")
        .eq("tutor_id", user.id)
        .order("period_end", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, payment_cycle_id, is_completed, duration_minutes, rate",
        )
        .eq("tutor_id", user.id)
        .order("lesson_date", { ascending: false }),
    ]);

    const lastLessonMap = {};
    for (const l of lessonsData ?? []) {
      if (!lastLessonMap[l.student_id]) {
        lastLessonMap[l.student_id] = l.lesson_date;
      }
    }
    setLastLessonByStudent(lastLessonMap);

    const pendingCyclesByStudent = new Map();
    const paidCyclesByStudent = new Map();
    for (const c of cyclesData ?? []) {
      const map =
        c.status === "pending"
          ? pendingCyclesByStudent
          : c.status === "paid"
            ? paidCyclesByStudent
            : null;
      if (!map) continue;
      if (!map.has(c.student_id)) map.set(c.student_id, []);
      map.get(c.student_id).push(c);
    }

    const completedLessonsByStudent = new Map();
    const scheduledLessonsByStudent = new Map();
    const openCountByStudent = new Map();
    for (const l of lessonsData ?? []) {
      const targetMap = l.is_completed
        ? completedLessonsByStudent
        : scheduledLessonsByStudent;
      if (!targetMap.has(l.student_id)) targetMap.set(l.student_id, []);
      targetMap.get(l.student_id).push(l);
      if (l.is_completed && !l.payment_cycle_id) {
        openCountByStudent.set(
          l.student_id,
          (openCountByStudent.get(l.student_id) ?? 0) + 1,
        );
      }
    }

    const now = new Date();
    const statusMap = {};
    for (const s of studentsList ?? []) {
      statusMap[s.id] = computeStudentPaymentStatus(s, {
        pendingCycles: pendingCyclesByStudent.get(s.id) ?? [],
        paidCycles: paidCyclesByStudent.get(s.id) ?? [],
        completedLessons: completedLessonsByStudent.get(s.id) ?? [],
        scheduledLessons: scheduledLessonsByStudent.get(s.id) ?? [],
        openCount: openCountByStudent.get(s.id) ?? 0,
        now,
      });
    }
    setPaymentStatusByStudent(statusMap);
  };

  const loadSubjectsByStudent = async () => {
    const { data } = await supabase
      .from("student_subjects")
      .select("student_id, subject")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: true });
    const map = {};
    for (const row of data ?? []) {
      if (!map[row.student_id]) map[row.student_id] = [];
      map[row.student_id].push(row.subject);
    }
    setSubjectsByStudent(map);
  };

  const loadStudents = async () => {
    const { data, error } = await supabase
      .from("students")
      .select("*")
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    setStudents(data ?? []);
    setLoading(false);
    loadSortSupportData(data ?? []);
    loadSubjectsByStudent();
  };

  const progressFor = (student) => {
    const status = paymentStatusByStudent[student.id];
    if (!status) {
      return { label: "Loading...", classes: "bg-gray-100 text-gray-600" };
    }
    return {
      label: status.label,
      classes: TIER_BADGE_CLASSES[status.tier],
    };
  };

  const handleEdit = async (student) => {
    setEditingId(student.id);
    const { data: subjectRows } = await supabase
      .from("student_subjects")
      .select("*")
      .eq("student_id", student.id)
      .eq("tutor_id", user.id)
      .order("created_at", { ascending: true });
    const subjects = (subjectRows ?? []).map((row) => ({
      id: row.id,
      subject: row.subject ?? "",
      level: row.level ?? "",
      hourly_rate: row.hourly_rate ?? "",
      lesson_duration_hours: row.lesson_duration_hours ?? "",
    }));
    setForm({
      name: student.name ?? "",
      subjects:
        subjects.length > 0
          ? subjects
          : [
              {
                id: null,
                subject: student.subject ?? "",
                level: student.level ?? "",
                hourly_rate: student.hourly_rate ?? "",
                lesson_duration_hours: student.lesson_duration_hours ?? "",
              },
            ],
      address: student.address ?? "",
      payment_mode: student.payment_mode ?? "lessons",
      payment_cycle_count: String(student.payment_cycle_count ?? 4),
      payment_custom_day: String(student.payment_custom_day ?? 1),
    });
  };

  const handleSubjectRowChange = (index, field, value) => {
    setForm((f) => ({
      ...f,
      subjects: f.subjects.map((row, i) =>
        i === index ? { ...row, [field]: value } : row,
      ),
    }));
  };

  const handleAddSubjectRow = () => {
    setForm((f) => ({ ...f, subjects: [...f.subjects, emptySubjectRow()] }));
  };

  const handleRemoveSubjectRow = (index) => {
    setForm((f) => ({
      ...f,
      subjects: f.subjects.filter((_, i) => i !== index),
    }));
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("students")
        .select("*")
        .eq("tutor_id", user.id)
        .order("created_at", { ascending: false });
      if (error) setError(error.message);
      setStudents(data ?? []);
      setLoading(false);
      loadSortSupportData(data ?? []);
      loadSubjectsByStudent();
      const editStudentId = location.state?.editStudentId;
      if (editStudentId) {
        const target = (data ?? []).find((s) => s.id === editStudentId);
        if (target) await handleEdit(target);
        navigate(location.pathname, { replace: true, state: {} });
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const subjectRows = form.subjects.filter((row) => row.subject.trim());
    const primary = subjectRows[0] ?? emptySubjectRow();

    const payload = {
      name: form.name.trim(),
      subject: primary.subject.trim() || null,
      level: primary.level || null,
      hourly_rate:
        primary.hourly_rate === "" ? null : Number(primary.hourly_rate),
      lesson_duration_hours:
        primary.lesson_duration_hours === ""
          ? null
          : Number(primary.lesson_duration_hours),
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
      let studentId = editingId;
      if (editingId) {
        const { error } = await supabase
          .from("students")
          .update(payload)
          .eq("id", editingId)
          .eq("tutor_id", user.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("students")
          .insert({ ...payload, tutor_id: user.id })
          .select()
          .single();
        if (error) throw error;
        studentId = data.id;
      }

      const keptIds = subjectRows.map((row) => row.id).filter(Boolean);
      if (editingId) {
        let deleteQuery = supabase
          .from("student_subjects")
          .delete()
          .eq("student_id", studentId)
          .eq("tutor_id", user.id);
        deleteQuery =
          keptIds.length > 0
            ? deleteQuery.not("id", "in", `(${keptIds.join(",")})`)
            : deleteQuery;
        const { error: deleteError } = await deleteQuery;
        if (deleteError) throw deleteError;
      }

      for (const row of subjectRows) {
        const rowPayload = {
          student_id: studentId,
          tutor_id: user.id,
          subject: row.subject.trim(),
          level: row.level || null,
          hourly_rate: row.hourly_rate === "" ? null : Number(row.hourly_rate),
          lesson_duration_hours:
            row.lesson_duration_hours === ""
              ? null
              : Number(row.lesson_duration_hours),
        };
        if (row.id) {
          const { error: updateError } = await supabase
            .from("student_subjects")
            .update(rowPayload)
            .eq("id", row.id)
            .eq("tutor_id", user.id);
          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from("student_subjects")
            .insert(rowPayload);
          if (insertError) throw insertError;
        }
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
    const { error } = await supabase
      .from("students")
      .delete()
      .eq("id", id)
      .eq("tutor_id", user.id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    if (editingId === id) resetForm();
    await loadStudents();
    showToast("Student deleted.");
  };

  const subjectsLabel = (studentId, fallback) =>
    (subjectsByStudent[studentId]?.length
      ? subjectsByStudent[studentId]
      : fallback
        ? [fallback]
        : []
    ).join(" · ");

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredStudents = normalizedSearch
    ? students.filter(
        (s) =>
          s.name?.toLowerCase().includes(normalizedSearch) ||
          subjectsLabel(s.id, s.subject)
            .toLowerCase()
            .includes(normalizedSearch),
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
        const aStatus = paymentStatusByStudent[a.id];
        const bStatus = paymentStatusByStudent[b.id];
        if (!aStatus && !bStatus) return a.name.localeCompare(b.name);
        if (!aStatus) return 1;
        if (!bStatus) return -1;
        const rankDiff = tierRank(aStatus.tier) - tierRank(bStatus.tier);
        if (rankDiff !== 0) return rankDiff;
        if (bStatus.amountDue !== aStatus.amountDue) {
          return bStatus.amountDue - aStatus.amountDue;
        }
        return a.name.localeCompare(b.name);
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

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 sm:max-w-sm"
          />
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            Subjects
          </label>
          {form.subjects.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Subject
                </label>
                <input
                  type="text"
                  required
                  value={row.subject}
                  onChange={(e) =>
                    handleSubjectRowChange(index, "subject", e.target.value)
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Level
                </label>
                <select
                  value={row.level}
                  onChange={(e) =>
                    handleSubjectRowChange(index, "level", e.target.value)
                  }
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
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Hourly rate (SGD)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.hourly_rate}
                  onChange={(e) =>
                    handleSubjectRowChange(
                      index,
                      "hourly_rate",
                      e.target.value,
                    )
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Duration (hrs)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={row.lesson_duration_hours}
                  onChange={(e) =>
                    handleSubjectRowChange(
                      index,
                      "lesson_duration_hours",
                      e.target.value,
                    )
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <button
                type="button"
                onClick={() => handleRemoveSubjectRow(index)}
                disabled={form.subjects.length <= 1}
                className="min-h-11 rounded-md border border-gray-300 px-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleAddSubjectRow}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            + Add another subject
          </button>
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
                  <p className="mb-2 text-sm text-gray-500">
                    {subjectsLabel(s.id, s.subject) || "—"}
                    {s.lesson_duration_hours != null &&
                      ` · ${s.lesson_duration_hours}h lessons`}
                  </p>
                  <span
                    className={`mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${progressFor(s).classes}`}
                  >
                    {progressFor(s).label}
                  </span>
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
                    <th className="px-4 py-2 font-medium">Progress</th>
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
                          {subjectsLabel(s.id, s.subject) || "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {s.hourly_rate != null ? `$${s.hourly_rate}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {s.lesson_duration_hours ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${progressFor(s).classes}`}
                          >
                            {progressFor(s).label}
                          </span>
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
    .filter((l) => !l.is_completed)
    .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
  const past = lessons
    .filter((l) => l.is_completed)
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
