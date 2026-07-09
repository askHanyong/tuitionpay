import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
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

// Preset avatar colors — bg is the circle fill, text is the initial color.
export const AVATAR_PRESET_COLORS = [
  { bg: "#d1fae5", text: "#065f46", label: "Mint" },
  { bg: "#dbeafe", text: "#1e40af", label: "Sky blue" },
  { bg: "#ede9fe", text: "#5b21b6", label: "Soft purple" },
  { bg: "#fee2e2", text: "#991b1b", label: "Coral" },
  { bg: "#fef3c7", text: "#92400e", label: "Amber" },
  { bg: "#ccfbf1", text: "#0f766e", label: "Teal" },
  { bg: "#fce7f3", text: "#9d174d", label: "Rose" },
  { bg: "#f3f4f6", text: "#374151", label: "Slate" },
];

const emptyForm = {
  name: "",
  avatar_color: "",
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

function StudentActionsMenu({ student, onEdit, onArchive, onDelete }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target) &&
        menuRef.current && !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = confirmDelete ? 120 : 148;
      const openUpward = rect.bottom + menuHeight > window.innerHeight;
      setMenuPos({
        left: rect.right - 192,
        top: openUpward ? rect.top - menuHeight : rect.bottom + 4,
      });
    }
    if (open) setConfirmDelete(false);
    setOpen((o) => !o);
  };

  const close = () => { setOpen(false); setConfirmDelete(false); };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="More actions"
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        ⋯
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", left: menuPos.left, top: menuPos.top }}
          className="z-50 w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {confirmDelete ? (
            <div className="px-3 py-2">
              <p className="mb-2 text-sm text-gray-700">
                Delete <span className="font-semibold">{student.name}</span>?{" "}
                <span className="text-gray-500">Can be recovered within 30 days.</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { close(); onDelete(student); }}
                  className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { close(); onEdit(student); }}
                className="block w-full px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => { close(); onArchive(student); }}
                className="block w-full px-3 py-2.5 text-left text-sm text-gray-500 hover:bg-gray-50"
              >
                Archive
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="block w-full px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function Students() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const terms = useTerms();
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
  const [view, setView] = useState("active");
  const [undoDelete, setUndoDelete] = useState(null); // { id, name, timer }


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
      .is("deleted_at", null)
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
      avatar_color: student.avatar_color ?? "",
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
      avatar_color: form.avatar_color || null,
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
      showToast(editingId ? `${terms.student} updated.` : `${terms.student} added.`);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (student) => {
    setError(null);
    const { error } = await supabase
      .from("students")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", student.id)
      .eq("tutor_id", user.id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    if (editingId === student.id) resetForm();
    // Remove from local list immediately (optimistic)
    setStudents((prev) => prev.filter((s) => s.id !== student.id));
    // Clear any previous undo timer
    setUndoDelete((prev) => {
      if (prev?.timer) clearTimeout(prev.timer);
      return null;
    });
    const timer = setTimeout(() => setUndoDelete(null), 7000);
    setUndoDelete({ id: student.id, name: student.name, timer });
  };

  const handleUndoDelete = async () => {
    if (!undoDelete) return;
    clearTimeout(undoDelete.timer);
    const { error } = await supabase
      .from("students")
      .update({ deleted_at: null })
      .eq("id", undoDelete.id)
      .eq("tutor_id", user.id);
    setUndoDelete(null);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadStudents();
  };

  const handleArchive = async (student) => {
    setError(null);
    const { error } = await supabase
      .from("students")
      .update({ archived: true })
      .eq("id", student.id)
      .eq("tutor_id", user.id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    if (editingId === student.id) resetForm();
    await loadStudents();
    showToast(`${terms.student} archived.`);
  };

  const handleUnarchive = async (student) => {
    setError(null);
    const { error } = await supabase
      .from("students")
      .update({ archived: false })
      .eq("id", student.id)
      .eq("tutor_id", user.id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    await loadStudents();
    showToast(`${terms.student} unarchived.`);
  };

  const subjectsLabel = (studentId, fallback) =>
    (subjectsByStudent[studentId]?.length
      ? subjectsByStudent[studentId]
      : fallback
        ? [fallback]
        : []
    ).join(" · ");

  const archivedCount = students.filter((s) => s.archived).length;
  const viewStudents = students.filter((s) =>
    view === "archived" ? s.archived : !s.archived,
  );

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredStudents = normalizedSearch
    ? viewStudents.filter(
        (s) =>
          s.name?.toLowerCase().includes(normalizedSearch) ||
          subjectsLabel(s.id, s.subject)
            .toLowerCase()
            .includes(normalizedSearch),
      )
    : viewStudents;

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
      {/* Undo-delete toast */}
      {undoDelete && (
        <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-lg">
          <span className="text-sm text-gray-700">
            <span className="font-medium">{undoDelete.name}</span> deleted
          </span>
          <button
            type="button"
            onClick={handleUndoDelete}
            className="rounded-md bg-[#1b2d4f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#15243f]"
          >
            Undo
          </button>
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold text-gray-900">
          {editingId ? `Edit ${terms.student.toLowerCase()}` : `Add a ${terms.student.toLowerCase()}`}
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa] sm:max-w-sm"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Avatar colour
          </label>
          <div className="flex flex-wrap gap-2">
            {AVATAR_PRESET_COLORS.map((c) => {
              const selected = form.avatar_color === c.bg;
              return (
                <button
                  key={c.bg}
                  type="button"
                  aria-label={c.label}
                  title={c.label}
                  onClick={() =>
                    setForm({ ...form, avatar_color: selected ? "" : c.bg })
                  }
                  style={{ backgroundColor: c.bg }}
                  className={`relative flex h-9 w-9 items-center justify-center rounded-full transition ${
                    selected
                      ? "ring-2 ring-[#1b2d4f] ring-offset-2"
                      : "hover:ring-2 hover:ring-gray-300 hover:ring-offset-1"
                  }`}
                >
                  {selected && (
                    <span style={{ color: c.text }} className="text-xs font-bold">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            {form.avatar_color
              ? "Colour selected — tap again to clear."
              : "No colour selected — will use default based on payment status."}
          </p>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700">
            {terms.subjects}
          </label>
          {form.subjects.map((row, index) => (
            <div
              key={index}
              className="grid grid-cols-1 gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  {terms.subject}
                </label>
                <input
                  type="text"
                  required
                  value={row.subject}
                  onChange={(e) =>
                    handleSubjectRowChange(index, "subject", e.target.value)
                  }
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
            + Add another {terms.subject.toLowerCase()}
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
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                    className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
            className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
          >
            {submitting
              ? "Saving..."
              : editingId
                ? "Save changes"
                : `Add ${terms.student.toLowerCase()}`}
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
          Your {terms.students.toLowerCase()}
        </h2>

        <div className="mb-4 flex gap-2 border-b border-gray-200">
          <button
            type="button"
            onClick={() => setView("active")}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              view === "active"
                ? "border-[#1b2d4f] text-[#0f7a58]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setView("archived")}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              view === "archived"
                ? "border-[#1b2d4f] text-[#0f7a58]"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Archived ({archivedCount})
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400">
              🔍
            </span>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={`Search ${terms.students.toLowerCase()} by name or subject...`}
              className="min-h-11 w-full rounded-md border border-gray-300 px-9 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
            className="min-h-11 rounded-md border border-gray-300 px-3 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa] sm:w-56"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {normalizedSearch && !loading && (
          <p className="mb-4 inline-block rounded-full bg-[#d6ede6] px-3 py-1 text-xs font-medium text-[#1b2d4f]">
            Showing {sortedStudents.length} of {viewStudents.length} {terms.students.toLowerCase()}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : viewStudents.length === 0 ? (
          <p className="text-sm text-gray-500">
            {view === "archived"
              ? `No archived ${terms.students.toLowerCase()}.`
              : `No ${terms.students.toLowerCase()} yet.`}
          </p>
        ) : sortedStudents.length === 0 ? (
          <p className="text-sm text-gray-500">
            🔍 No {terms.students.toLowerCase()} found for &quot;{searchTerm.trim()}&quot; — try a
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
                  <div className="mb-2 flex items-center gap-3">
                    <StudentAvatar
                      name={s.name}
                      avatarColor={s.avatar_color}
                      tier={
                        s.archived
                          ? "grey"
                          : (paymentStatusByStudent[s.id]?.tier ?? "grey")
                      }
                    />
                    <div className="flex flex-1 items-center justify-between">
                      <Link
                        to={`/students/${s.id}`}
                        className="font-medium text-gray-900 hover:text-[#1b2d4f]"
                      >
                        {s.name}
                      </Link>
                      <span className="text-sm text-gray-700">
                        {s.hourly_rate != null ? `$${s.hourly_rate}/hr` : "—"}
                      </span>
                    </div>
                  </div>
                  <p className="mb-2 text-sm text-gray-500">
                    {subjectsLabel(s.id, s.subject) || "—"}
                    {s.lesson_duration_hours != null &&
                      ` · ${s.lesson_duration_hours}h ${terms.lessons.toLowerCase()}`}
                  </p>
                  <span
                    className={`mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${progressFor(s).classes}`}
                  >
                    {progressFor(s).label}
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {view === "archived" ? (
                      <button
                        onClick={() => handleUnarchive(s)}
                        className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
                      >
                        Unarchive
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleLessons(s.id)}
                          className="text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                          {expandedId === s.id ? `Hide ${terms.lessons.toLowerCase()}` : `View ${terms.lessons.toLowerCase()}`}
                        </button>
                        <button
                          onClick={() => setScheduleStudent(s)}
                          className="text-sm font-medium text-gray-700 hover:text-gray-900"
                        >
                          Schedule
                        </button>
                        <StudentActionsMenu
                          student={s}
                          onEdit={handleEdit}
                          onArchive={handleArchive}
                          onDelete={handleDelete}
                        />
                      </div>
                    )}
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
                    <th className="px-4 py-2 font-medium">{terms.subject}</th>
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
                          <div className="flex items-center gap-3">
                            <StudentAvatar
                              name={s.name}
                              avatarColor={s.avatar_color}
                              tier={
                                s.archived
                                  ? "grey"
                                  : (paymentStatusByStudent[s.id]?.tier ?? "grey")
                              }
                            />
                            <Link
                              to={`/students/${s.id}`}
                              className="hover:text-[#1b2d4f]"
                            >
                              {s.name}
                            </Link>
                          </div>
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
                          {view === "archived" ? (
                            <button
                              onClick={() => handleUnarchive(s)}
                              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
                            >
                              Unarchive
                            </button>
                          ) : (
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => toggleLessons(s.id)}
                                className="text-sm font-medium text-gray-700 hover:text-gray-900"
                              >
                                {expandedId === s.id ? `Hide ${terms.lessons.toLowerCase()}` : `View ${terms.lessons.toLowerCase()}`}
                              </button>
                              <button
                                onClick={() => setScheduleStudent(s)}
                                className="text-sm font-medium text-gray-700 hover:text-gray-900"
                              >
                                Schedule
                              </button>
                              <StudentActionsMenu
                                student={s}
                                onEdit={handleEdit}
                                onArchive={handleArchive}
                                onDelete={handleDelete}
                              />
                            </div>
                          )}
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

function getInitials(name) {
  const clean = (name ?? "").replace(/\s*\(.*?\)\s*/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = {
  red: { bg: "#fee2e2", color: "#991b1b" },
  amber: { bg: "#fef3c7", color: "#92400e" },
  green: { bg: "#d1fae5", color: "#065f46" },
  blue: { bg: "#d1fae5", color: "#065f46" },
  grey: { bg: "#f3f4f6", color: "#6b7280" },
};

function StudentAvatar({ name, tier, avatarColor }) {
  // avatarColor is the stored bg hex (e.g. "#d1fae5"). Look up its matching
  // text color from the preset list; fall back to tier-based colors if unset.
  const preset = avatarColor
    ? AVATAR_PRESET_COLORS.find((c) => c.bg === avatarColor)
    : null;
  const { bg, color } = preset
    ? { bg: preset.bg, color: preset.text }
    : (AVATAR_COLORS[tier] ?? AVATAR_COLORS.grey);
  return (
    <span
      style={{
        width: 44,
        height: 44,
        minWidth: 44,
        borderRadius: "50%",
        backgroundColor: bg,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 15,
        fontWeight: 500,
        userSelect: "none",
      }}
    >
      {getInitials(name)}
    </span>
  );
}

function StudentLessonsPanel({ loading, lessons }) {
  const terms = useTerms();
  if (loading) {
    return <p className="text-sm text-gray-500">Loading {terms.lessons.toLowerCase()}...</p>;
  }

  const upcoming = lessons
    .filter((l) => !l.is_completed)
    .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
  const past = lessons
    .filter((l) => l.is_completed)
    .sort((a, b) => (a.lesson_date > b.lesson_date ? -1 : 1));

  if (lessons.length === 0) {
    return <p className="text-sm text-gray-500">No {terms.lessons.toLowerCase()} logged yet.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-900">
          Upcoming ({upcoming.length})
        </h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500">No upcoming {terms.lessons.toLowerCase()}.</p>
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
          <p className="text-sm text-gray-500">No past {terms.lessons.toLowerCase()}.</p>
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
