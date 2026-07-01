import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { buildPaymentNoticeMessage, formatSGD } from "../lib/paymentNotice";
import { formatDate, formatDateTime } from "../utils/dateFormat";
import { buildLessonIcs, downloadIcs } from "../lib/ics";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  findCalendarConflict,
  getValidAccessToken,
  updateCalendarEvent,
} from "../lib/googleCalendar";
import { showAppNotification } from "../lib/notifications";
import AppShell from "../components/AppShell";

const today = () => new Date().toISOString().slice(0, 10);

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const PAGE_SIZE = 20;

const emptyForm = (students, prefillDate, defaultTime) => ({
  student_id: students[0]?.id ?? "",
  subject_id: "",
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
  const [menuPos, setMenuPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = 124;
      const openUpward = rect.bottom + menuHeight > window.innerHeight;
      setMenuPos({
        left: rect.right - 176,
        top: openUpward ? rect.top - menuHeight : rect.bottom + 4,
      });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Lesson actions"
        className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        ⋯
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", left: menuPos.left, top: menuPos.top }}
            className="z-50 w-44 rounded-md border border-gray-200 bg-white py-1 shadow-lg"
          >
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
          </div>,
          document.body,
        )}
    </>
  );
}

export default function Lessons() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const prefillDate = location.state?.lessonDate;
  const editLessonId = location.state?.editLessonId;
  const [students, setStudents] = useState([]);
  const [subjectsByStudent, setSubjectsByStudent] = useState({});
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState(emptyForm([], prefillDate));
  const [submitting, setSubmitting] = useState(false);
  const [newCycle, setNewCycle] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState(null);
  const [checkingConflict, setCheckingConflict] = useState(false);

  const [defaultDateFrom] = useState(() => daysAgo(30));
  const [defaultDateTo] = useState(() => today());
  const [studentFilter, setStudentFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom);
  const [dateTo, setDateTo] = useState(defaultDateTo);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filtersActive =
    studentFilter !== "all" ||
    dateFrom !== defaultDateFrom ||
    dateTo !== defaultDateTo ||
    statusFilter !== "all" ||
    searchQuery.trim() !== "";

  const handleClearFilters = () => {
    setStudentFilter("all");
    setDateFrom(defaultDateFrom);
    setDateTo(defaultDateTo);
    setStatusFilter("all");
    setSearchQuery("");
    setVisibleCount(PAGE_SIZE);
  };

  useEffect(() => {
    const load = async () => {
      const [
        { data: studentsData, error: studentsError },
        { data: lessonsData, error: lessonsError },
        { data: subjectsData },
      ] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .eq("tutor_id", user.id)
          .eq("archived", false)
          .order("name"),
        supabase
          .from("lessons")
          .select(
            "*, students(name, subject, hourly_rate, payment_mode, payment_cycle_count)",
          )
          .eq("tutor_id", user.id)
          .order("lesson_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase
          .from("student_subjects")
          .select("*")
          .eq("tutor_id", user.id)
          .order("created_at", { ascending: true }),
      ]);
      if (studentsError) setError(studentsError.message);
      if (lessonsError) setError(lessonsError.message);
      setStudents(studentsData ?? []);
      setLessons(lessonsData ?? []);
      const subjectsMap = {};
      for (const row of subjectsData ?? []) {
        if (!subjectsMap[row.student_id]) subjectsMap[row.student_id] = [];
        subjectsMap[row.student_id].push(row);
      }
      setSubjectsByStudent(subjectsMap);
      const firstStudentId = (studentsData ?? [])[0]?.id;
      const firstSubject = subjectsMap[firstStudentId]?.[0];
      setForm((f) => ({
        ...emptyForm(
          studentsData ?? [],
          f.lesson_date,
          mostRecentLessonTime(lessonsData ?? [], firstStudentId),
        ),
        subject_id: firstSubject?.id ?? "",
        duration_hours:
          firstSubject?.lesson_duration_hours ??
          (studentsData ?? [])[0]?.lesson_duration_hours ??
          "",
        rate: firstSubject?.hourly_rate ?? (studentsData ?? [])[0]?.hourly_rate ?? "",
      }));
      if (editLessonId) {
        const lesson = (lessonsData ?? []).find((l) => l.id === editLessonId);
        if (lesson) {
          setEditingId(lesson.id);
          setForm({
            student_id: lesson.student_id,
            subject_id: lesson.student_subject_id ?? "",
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
      .eq("tutor_id", user.id)
      .order("lesson_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
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
    const isPerLesson = (lesson) =>
      (lesson.students?.payment_mode ?? "lessons") === "per_lesson";
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
      const perLesson = isPerLesson(group[0]);
      const sorted = [...group].sort((a, b) =>
        a.lesson_date < b.lesson_date
          ? -1
          : a.lesson_date > b.lesson_date
            ? 1
            : 0,
      );
      sorted.forEach((lesson, i) =>
        positions.set(
          lesson.id,
          monthly || perLesson ? i + 1 : (i % cycleCount) + 1,
        ),
      );
    }
    return positions;
  }, [lessons]);

  const filteredLessons = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lessons.filter((l) => {
      if (studentFilter !== "all" && l.student_id !== studentFilter)
        return false;
      if (dateFrom && l.lesson_date < dateFrom) return false;
      if (dateTo && l.lesson_date > dateTo) return false;
      if (statusFilter === "completed" && !l.is_completed) return false;
      if (statusFilter === "scheduled" && l.is_completed) return false;
      if (q) {
        const name = l.students?.name?.toLowerCase() ?? "";
        const dateLabel = formatDate(l.lesson_date).toLowerCase();
        if (
          !name.includes(q) &&
          !dateLabel.includes(q) &&
          !l.lesson_date.includes(q)
        )
          return false;
      }
      return true;
    });
  }, [lessons, studentFilter, dateFrom, dateTo, statusFilter, searchQuery]);

  const filterKey = JSON.stringify([
    studentFilter,
    dateFrom,
    dateTo,
    statusFilter,
    searchQuery,
  ]);
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }

  const displayedLessons = filteredLessons.slice(0, visibleCount);

  const handleAddToCalendar = (lesson) => {
    const ics = buildLessonIcs({
      lesson,
      studentName: lesson.students?.name ?? "Lesson",
      subject: lesson.subject ?? lesson.students?.subject,
      lessonNumber: lessonPosition.get(lesson.id) ?? 1,
      rate: lesson.rate ?? lesson.students?.hourly_rate ?? null,
    });
    downloadIcs(
      `${lesson.students?.name ?? "lesson"}-${lesson.lesson_date}.ics`,
      ics,
    );
  };

  const getTutorGoogleTokens = async () => {
    const { data: tutor } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", user.id)
      .single();
    return tutor?.google_calendar_tokens ?? null;
  };

  // Looks for a conflicting Google Calendar event at the proposed lesson
  // time. Returns null if Google Calendar isn't connected, or if the check
  // itself fails -- a failed conflict check should never block logging a
  // lesson, since the conflict warning is only an extra confirmation step.
  const checkGoogleConflict = async ({
    lessonDate,
    lessonTime,
    durationMinutes,
  }) => {
    try {
      const tokens = await getTutorGoogleTokens();
      if (!tokens?.access_token) return null;
      const accessToken = await getValidAccessToken(user.id, tokens);
      const start = new Date(`${lessonDate}T${lessonTime || "09:00"}:00`);
      const end = new Date(start.getTime() + durationMinutes * 60000);
      return await findCalendarConflict(
        accessToken,
        start.toISOString(),
        end.toISOString(),
      );
    } catch {
      return null;
    }
  };

  const pushLessonToGoogleCalendar = async ({
    lessonId,
    studentId,
    lessonDate,
    lessonTime,
    durationMinutes,
    notes,
    lessonNumber,
    subject,
  }) => {
    const tokens = await getTutorGoogleTokens();
    if (!tokens?.access_token) return;

    const student = students.find((s) => s.id === studentId);
    const start = new Date(`${lessonDate}T${lessonTime || "09:00"}:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const mode = student?.payment_mode ?? "lessons";
    const isMonthlyBilled = mode === "monthly" || mode === "custom_date";
    const isPerLesson = mode === "per_lesson";
    const lessonLabel =
      isMonthlyBilled || isPerLesson
        ? `Lesson ${lessonNumber}`
        : `Lesson ${lessonNumber} of ${student?.payment_cycle_count ?? 4}`;

    console.log("Student address for calendar:", student?.address);

    const attempt = async () => {
      const accessToken = await getValidAccessToken(user.id, tokens);
      const event = await createCalendarEvent(accessToken, {
        summary: `${student?.name ?? "Lesson"} — ${subject || student?.subject || "Lesson"}`,
        description:
          notes || `${lessonLabel} for ${student?.name ?? "student"}`,
        location: student?.address || undefined,
        start: start.toISOString(),
        end: end.toISOString(),
      });
      await supabase
        .from("lessons")
        .update({ google_event_id: event.id })
        .eq("id", lessonId)
        .eq("tutor_id", user.id);
    };

    try {
      await attempt();
    } catch {
      // Retry once in case the access token expired between the read above
      // and the create call (e.g. a stale token cached client-side).
      try {
        await attempt();
      } catch {
        showToast("Lesson saved, but Google Calendar sync failed.", "error");
      }
    }
  };

  const updateLessonInGoogleCalendar = async ({
    eventId,
    studentId,
    lessonDate,
    lessonTime,
    durationMinutes,
    notes,
    lessonLabel,
    subject,
  }) => {
    const tokens = await getTutorGoogleTokens();
    if (!tokens?.access_token) return;

    const student = students.find((s) => s.id === studentId);
    const start = new Date(`${lessonDate}T${lessonTime || "09:00"}:00`);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    console.log("Student address for calendar:", student?.address);

    const attempt = async () => {
      const accessToken = await getValidAccessToken(user.id, tokens);
      await updateCalendarEvent(accessToken, eventId, {
        summary: `${student?.name ?? "Lesson"} — ${subject || student?.subject || "Lesson"}`,
        description:
          notes || lessonLabel || `Lesson for ${student?.name ?? "student"}`,
        location: student?.address || "",
        start: start.toISOString(),
        end: end.toISOString(),
      });
    };

    try {
      await attempt();
    } catch {
      try {
        await attempt();
      } catch {
        showToast("Lesson saved, but Google Calendar sync failed.", "error");
      }
    }
  };

  const deleteLessonFromGoogleCalendar = async (lesson) => {
    if (!lesson?.google_event_id) return;
    try {
      const tokens = await getTutorGoogleTokens();
      if (!tokens?.access_token) return;
      const accessToken = await getValidAccessToken(user.id, tokens);
      await deleteCalendarEvent(accessToken, lesson.google_event_id);
    } catch {
      // Best-effort -- proceed with deleting the lesson from Supabase
      // regardless of whether the Google Calendar event was removed.
    }
  };

  const handleStudentChange = (studentId) => {
    const student = students.find((s) => s.id === studentId);
    const firstSubject = subjectsByStudent[studentId]?.[0];
    setForm({
      ...form,
      student_id: studentId,
      subject_id: firstSubject?.id ?? "",
      duration_hours:
        firstSubject?.lesson_duration_hours ??
        student?.lesson_duration_hours ??
        "",
      rate: firstSubject?.hourly_rate ?? student?.hourly_rate ?? "",
      lesson_time: mostRecentLessonTime(lessons, studentId),
    });
  };

  const handleSubjectChange = (subjectId) => {
    const subject = (subjectsByStudent[form.student_id] ?? []).find(
      (s) => s.id === subjectId,
    );
    setForm((f) => ({
      ...f,
      subject_id: subjectId,
      duration_hours: subject?.lesson_duration_hours ?? f.duration_hours,
      rate: subject?.hourly_rate ?? f.rate,
    }));
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
      subject_id: lesson.student_subject_id ?? "",
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

    if (!editingId) {
      setCheckingConflict(true);
      const conflict = await checkGoogleConflict({
        lessonDate: form.lesson_date,
        lessonTime: form.lesson_time,
        durationMinutes: Math.round(Number(form.duration_hours) * 60),
      });
      setCheckingConflict(false);
      if (conflict) {
        setConflictWarning(conflict);
        return;
      }
    }

    await proceedSave();
  };

  const handleConfirmSaveAnyway = async () => {
    setConflictWarning(null);
    await proceedSave();
  };

  const proceedSave = async () => {
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
      const selectedSubject = (subjectsByStudent[form.student_id] ?? []).find(
        (s) => s.id === form.subject_id,
      );
      const subjectText =
        selectedSubject?.subject ??
        students.find((s) => s.id === form.student_id)?.subject ??
        null;
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
            student_subject_id: form.subject_id || null,
            subject: subjectText,
            lesson_date: form.lesson_date,
            lesson_time: form.lesson_time || null,
            duration_minutes: Math.round(durationHours * 60),
            rate: form.rate === "" ? null : Number(form.rate),
            notes: form.notes.trim() || null,
            status,
            is_completed,
          })
          .eq("id", editingId)
          .eq("tutor_id", user.id);
        if (error) throw error;

        if (original?.google_event_id) {
          await updateLessonInGoogleCalendar({
            eventId: original.google_event_id,
            studentId: form.student_id,
            lessonDate: form.lesson_date,
            lessonTime: form.lesson_time,
            durationMinutes: Math.round(durationHours * 60),
            notes: form.notes.trim(),
            subject: subjectText,
          });
        }

        setInfo("Lesson updated.");
        resetForm();
        await reloadLessons();
        return;
      }

      const { count: beforeCount } = await supabase
        .from("lessons")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", user.id)
        .eq("student_id", form.student_id)
        .is("payment_cycle_id", null)
        .eq("is_completed", true);

      const { data: inserted, error } = await supabase
        .from("lessons")
        .insert({
          tutor_id: user.id,
          student_id: form.student_id,
          student_subject_id: form.subject_id || null,
          subject: subjectText,
          lesson_date: form.lesson_date,
          lesson_time: form.lesson_time || null,
          duration_minutes: Math.round(durationHours * 60),
          rate: form.rate === "" ? null : Number(form.rate),
          notes: form.notes.trim() || null,
          status,
          is_completed,
        })
        .select()
        .single();
      if (error) throw error;

      await pushLessonToGoogleCalendar({
        lessonId: inserted.id,
        studentId: form.student_id,
        lessonDate: form.lesson_date,
        lessonTime: form.lesson_time,
        durationMinutes: Math.round(durationHours * 60),
        notes: form.notes.trim(),
        lessonNumber: ((beforeCount ?? 0) % 4) + 1,
        subject: subjectText,
      });

      if (isFuture) {
        setInfo(
          "Lesson scheduled. It'll count toward billing once its date arrives.",
        );
      } else if ((beforeCount ?? 0) + 1 >= 4) {
        const { data: cycle } = await supabase
          .from("payment_cycles")
          .select("*, students(name)")
          .eq("tutor_id", user.id)
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

  const handleDelete = (id) => {
    setDeleteTarget(id);
  };

  const confirmDelete = async () => {
    const id = deleteTarget;
    if (!id) return;
    setDeleting(true);
    setError(null);
    await deleteLessonFromGoogleCalendar(lessons.find((l) => l.id === id));
    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", id)
      .eq("tutor_id", user.id);
    setDeleting(false);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      setDeleteTarget(null);
      return;
    }
    if (editingId === id) resetForm();
    setLessons((prev) => prev.filter((l) => l.id !== id));
    setDeleteTarget(null);
    await reloadLessons();
    showToast("Lesson deleted successfully");
  };

  return (
    <AppShell>
      {students.length === 0 && !loading ? (
        <p className="rounded-md border border-gray-200 bg-white p-5 text-sm text-gray-500">
          Add a student first before logging lessons.{" "}
          <Link
            to="/students"
            className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {(subjectsByStudent[form.student_id] ?? []).length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Subject
                </label>
                <select
                  required
                  value={form.subject_id}
                  onChange={(e) => handleSubjectChange(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                >
                  {subjectsByStudent[form.student_id].map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-[#5ecfaa]">{info}</p>}

          {conflictWarning && (
            <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm text-amber-800">
                ⚠️ You have a conflict at that time in your Google Calendar.
                Save anyway?
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConflictWarning(null)}
                  disabled={submitting}
                  className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSaveAnyway}
                  disabled={submitting}
                  className="min-h-11 rounded-md bg-amber-600 px-4 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Yes, save anyway"}
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || checkingConflict}
              className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
              id="log-lesson-form-submit"
            >
              {checkingConflict
                ? "Checking calendar..."
                : submitting
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
              className="min-h-11 rounded-md bg-[#1b2d4f] px-3 text-sm font-medium text-white hover:bg-[#15243f]"
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

        {!loading && lessons.length > 0 && (
          <div className="mb-4 space-y-3 rounded-md border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Student
                </label>
                <select
                  value={studentFilter}
                  onChange={(e) => setStudentFilter(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-gray-300 px-2 text-sm"
                >
                  <option value="all">All students</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  From
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-gray-300 px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  To
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-gray-300 px-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Search
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Student name or date"
                  className="min-h-11 w-full rounded-md border border-gray-300 px-2 text-sm"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1">
                {[
                  { value: "all", label: "All" },
                  { value: "completed", label: "Completed" },
                  { value: "scheduled", label: "Scheduled" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatusFilter(opt.value)}
                    className={`min-h-9 rounded-md px-3 text-sm font-medium transition ${
                      statusFilter === opt.value
                        ? "bg-[#1b2d4f] text-white"
                        : "border border-gray-300 text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {filtersActive && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="text-sm font-medium text-[#0f7a58] hover:text-[#0f1e35]"
                >
                  Clear all filters
                </button>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Showing {displayedLessons.length} of {filteredLessons.length}{" "}
              lesson{filteredLessons.length === 1 ? "" : "s"}
            </p>
          </div>
        )}

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
              className="flex min-h-11 items-center rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Log Lesson
            </a>
          </div>
        ) : filteredLessons.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
            <p className="mb-4 text-5xl">🔍</p>
            <p className="mb-6 max-w-sm text-sm text-gray-600">
              No lessons match your filters.
            </p>
            <button
              type="button"
              onClick={handleClearFilters}
              className="flex min-h-11 items-center rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Clear all filters
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {displayedLessons.map((l) => (
                <li
                  key={l.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                      <Link
                        to={`/students/${l.student_id}`}
                        className="hover:text-[#1b2d4f]"
                      >
                        {l.students?.name}
                      </Link>
                      {isLessonCompleted(l) ? (
                        <span className="inline-block rounded-full bg-[#d6ede6] px-2 py-0.5 text-xs font-medium text-[#1b2d4f]">
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
                      <span className="inline-block rounded-full bg-[#d6ede6] px-2 py-0.5 text-xs font-medium text-[#1b2d4f]">
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
                  {displayedLessons.map((l) => (
                    <tr key={l.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {formatDateTime(l.lesson_date, l.lesson_time)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <Link
                          to={`/students/${l.student_id}`}
                          className="hover:text-[#1b2d4f]"
                        >
                          {l.students?.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {isLessonCompleted(l) ? (
                          <span className="inline-block rounded-full bg-[#d6ede6] px-2 py-0.5 text-xs font-medium text-[#1b2d4f]">
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
                          <span className="inline-block rounded-full bg-[#d6ede6] px-2 py-0.5 text-xs font-medium text-[#1b2d4f]">
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
            {visibleCount < filteredLessons.length && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="min-h-11 rounded-md border border-gray-300 px-5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-700">
              Are you sure you want to delete this lesson? This cannot be
              undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleting}
                className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
