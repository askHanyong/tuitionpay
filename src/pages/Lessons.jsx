import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
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
import { computeStudentPaymentStatus } from "../lib/paymentStatus";
import { AVATAR_PRESET_COLORS } from "./Students";
import AppShell from "../components/AppShell";
import {
  CLIENT_TYPE_LABEL,
  CONSULTATION_TYPE_OPTIONS,
  CONSULTATION_TYPE_LABEL,
} from "../lib/practitioner";

function getInitials(name) {
  const clean = (name ?? "").replace(/\s*\(.*?\)\s*/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] ?? "").slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = {
  red:   { bg: "#fee2e2", color: "#991b1b" },
  amber: { bg: "#fef3c7", color: "#92400e" },
  green: { bg: "#d1fae5", color: "#065f46" },
  blue:  { bg: "#d1fae5", color: "#065f46" },
  grey:  { bg: "#f3f4f6", color: "#6b7280" },
};

function StudentAvatar({ name, tier, avatarColor }) {
  const preset = avatarColor
    ? AVATAR_PRESET_COLORS.find((c) => c.bg === avatarColor)
    : null;
  const { bg, color } = preset
    ? { bg: preset.bg, color: preset.text }
    : (AVATAR_COLORS[tier] ?? AVATAR_COLORS.grey);
  return (
    <span
      style={{
        width: 44, height: 44, minWidth: 44, borderRadius: "50%",
        backgroundColor: bg, color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, fontWeight: 500, userSelect: "none",
      }}
    >
      {getInitials(name)}
    </span>
  );
}

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
  lesson_mode: "f2f",
  consultation_type: "",
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
  const terms = useTerms();
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
        aria-label={`${terms.lesson} actions`}
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
  const terms = useTerms();
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";
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
  const [step, setStep] = useState(1);
  const [paymentTierByStudent, setPaymentTierByStudent] = useState(new Map());
  const [successCycle, setSuccessCycle] = useState(null);
  const [parentSummary, setParentSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [meetLinkCopied, setMeetLinkCopied] = useState(null);
  const [practitionerRates, setPractitionerRates] = useState([]);
  const [practitionerCompanies, setPractitionerCompanies] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);

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
        { data: cyclesData },
      ] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .eq("tutor_id", user.id)
          .eq("archived", false)
          .is("deleted_at", null)
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
        supabase
          .from("payment_cycles")
          .select("*")
          .eq("tutor_id", user.id),
      ]);
      if (studentsError) setError(studentsError.message);
      if (lessonsError) setError(lessonsError.message);
      if (isPractitioner) {
        const [{ data: ratesData }, { data: companiesData }] = await Promise.all([
          supabase
            .from("practitioner_rates")
            .select("company_id, client_type, consultation_type, rate_weekday, rate_saturday")
            .eq("tutor_id", user.id),
          supabase
            .from("practitioner_companies")
            .select("id, name")
            .eq("tutor_id", user.id)
            .order("created_at", { ascending: true }),
        ]);
        setPractitionerRates(ratesData ?? []);
        setPractitionerCompanies(companiesData ?? []);
      }
      setStudents(studentsData ?? []);
      setLessons(lessonsData ?? []);
      setPaymentCycles(cyclesData ?? []);
      const subjectsMap = {};
      for (const row of subjectsData ?? []) {
        if (!subjectsMap[row.student_id]) subjectsMap[row.student_id] = [];
        subjectsMap[row.student_id].push(row);
      }
      setSubjectsByStudent(subjectsMap);

      // Compute payment tier per student for avatar colour coding
      const pendingCyclesByStudent = new Map();
      const paidCyclesByStudent = new Map();
      const completedLessonsByStudent = new Map();
      const scheduledLessonsByStudent = new Map();
      const openCountByStudent = new Map();
      for (const c of cyclesData ?? []) {
        const map = c.status === "paid" ? paidCyclesByStudent : pendingCyclesByStudent;
        if (!map.has(c.student_id)) map.set(c.student_id, []);
        map.get(c.student_id).push(c);
      }
      for (const l of lessonsData ?? []) {
        const targetMap = l.is_completed ? completedLessonsByStudent : scheduledLessonsByStudent;
        if (!targetMap.has(l.student_id)) targetMap.set(l.student_id, []);
        targetMap.get(l.student_id).push(l);
        if (l.is_completed && !l.payment_cycle_id) {
          openCountByStudent.set(l.student_id, (openCountByStudent.get(l.student_id) ?? 0) + 1);
        }
      }
      const now = new Date();
      const tierMap = new Map();
      for (const s of studentsData ?? []) {
        const status = computeStudentPaymentStatus(s, {
          pendingCycles: pendingCyclesByStudent.get(s.id) ?? [],
          paidCycles: paidCyclesByStudent.get(s.id) ?? [],
          completedLessons: completedLessonsByStudent.get(s.id) ?? [],
          scheduledLessons: scheduledLessonsByStudent.get(s.id) ?? [],
          openCount: openCountByStudent.get(s.id) ?? 0,
          now,
        });
        tierMap.set(s.id, status?.tier ?? "grey");
      }
      setPaymentTierByStudent(tierMap);

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
            lesson_mode: lesson.lesson_mode ?? "f2f",
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
    isOnline,
  }) => {
    const tokens = await getTutorGoogleTokens();
    if (!tokens?.access_token) return null;

    const student = students.find((s) => s.id === studentId);
    // lesson_time from Supabase is "HH:MM:SS"; slice to "HH:MM" so appending
    // ":00" produces "HH:MM:00" not the invalid "HH:MM:SS:00".
    const timeStr = (lessonTime || "09:00").slice(0, 5);
    // Build SGT dateTime strings with explicit +08:00 offset so Google
    // Calendar always receives Singapore local time, regardless of what
    // timezone the browser is set to. toISOString() produces a UTC "Z"
    // string which causes Google to ignore the timeZone field.
    const startStr = `${lessonDate}T${timeStr}:00+08:00`;
    const startMs = new Date(startStr).getTime();
    const endMs = startMs + durationMinutes * 60000;
    const endStr = new Date(endMs + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";
    const mode = student?.payment_mode ?? "lessons";
    const isMonthlyBilled = mode === "monthly" || mode === "custom_date";
    const isPerLesson = mode === "per_lesson";
    const lessonLabel =
      isMonthlyBilled || isPerLesson
        ? `Lesson ${lessonNumber}`
        : `Lesson ${lessonNumber} of ${student?.payment_cycle_count ?? 4}`;

    console.log(
      "[Calendar create] lessonDate:", lessonDate,
      "| lessonTime raw:", JSON.stringify(lessonTime),
      "| startStr:", startStr,
      "| endStr:", endStr,
    );

    let meetLink = null;

    const attempt = async () => {
      const accessToken = await getValidAccessToken(user.id, tokens);
      console.log("[Calendar create] calling createCalendarEvent for lessonId:", lessonId);
      const event = await createCalendarEvent(accessToken, {
        summary: `${student?.name ?? "Lesson"} — ${subject || student?.subject || "Lesson"}`,
        description:
          notes || `${lessonLabel} for ${student?.name ?? "student"}`,
        location: student?.address || undefined,
        start: startStr,
        end: endStr,
        createMeetLink: isOnline,
        meetRequestId: lessonId,
      });
      meetLink =
        event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ?? null;
      const updates = { google_event_id: event.id };
      if (meetLink) updates.meet_link = meetLink;
      await supabase
        .from("lessons")
        .update(updates)
        .eq("id", lessonId)
        .eq("tutor_id", user.id);
    };

    try {
      await attempt();
    } catch (err) {
      console.error("[Calendar create] attempt 1 failed:", err?.name, err?.message, err);
      try {
        await attempt();
      } catch (err2) {
        console.error("[Calendar create] attempt 2 failed:", err2?.name, err2?.message, err2);
        const errMsg = String(err2?.message ?? "").toLowerCase();
        const msg =
          errMsg.includes("token") || errMsg.includes("auth") || errMsg.includes("401")
            ? `${terms.lesson} saved. Google Calendar sync failed — reconnect Google Calendar in Settings.`
            : `${terms.lesson} saved, but Google Calendar sync failed: ${err2?.message || "unknown error"}`;
        showToast(msg, "error");
      }
    }
    return meetLink;
  };

  const updateLessonInGoogleCalendar = async ({
    eventId,
    lessonId,
    studentId,
    lessonDate,
    lessonTime,
    durationMinutes,
    notes,
    lessonLabel,
    subject,
    isOnline,
  }) => {
    const tokens = await getTutorGoogleTokens();
    if (!tokens?.access_token) return null;

    const student = students.find((s) => s.id === studentId);
    // lesson_time from Supabase is "HH:MM:SS"; slice to "HH:MM" to avoid
    // producing the invalid string "HH:MM:SS:00" when appending ":00".
    // Use || (not ??) so an empty string also falls back to "09:00".
    const timeStr = (lessonTime || "09:00").slice(0, 5);
    const startStr = `${lessonDate}T${timeStr}:00+08:00`;
    const startMs = new Date(startStr).getTime();
    const endMs = startMs + durationMinutes * 60000;
    const endStr = new Date(endMs + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";

    console.log(
      "[Calendar update] lessonDate:", lessonDate,
      "| lessonTime raw:", JSON.stringify(lessonTime),
      "| startStr:", startStr,
      "| endStr:", endStr,
      "| eventId:", eventId,
    );

    let meetLink = null;

    const attempt = async () => {
      const accessToken = await getValidAccessToken(user.id, tokens);
      const event = await updateCalendarEvent(accessToken, eventId, {
        summary: `${student?.name ?? "Lesson"} — ${subject || student?.subject || "Lesson"}`,
        description:
          notes || lessonLabel || `Lesson for ${student?.name ?? "student"}`,
        location: student?.address || "",
        start: startStr,
        end: endStr,
        createMeetLink: isOnline,
        meetRequestId: lessonId,
      });
      meetLink =
        event.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ?? null;
    };

    try {
      await attempt();
    } catch (err) {
      console.error("[Calendar update] attempt 1 failed:", err?.name, err?.message, err);
      try {
        await attempt();
      } catch (err2) {
        console.error("[Calendar update] attempt 2 failed:", err2?.name, err2?.message, err2);
        const errMsg = String(err2?.message ?? "").toLowerCase();
        const msg =
          errMsg.includes("token") || errMsg.includes("auth") || errMsg.includes("401")
            ? `${terms.lesson} saved. Google Calendar sync failed — reconnect Google Calendar in Settings.`
            : `${terms.lesson} saved, but Google Calendar sync failed: ${err2?.message || "unknown error"}`;
        showToast(msg, "error");
      }
    }
    return meetLink;
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
      rate: isPractitioner ? "" : (firstSubject?.hourly_rate ?? student?.hourly_rate ?? ""),
      consultation_type: "",
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

  const handleSummarize = async () => {
    setSummarizing(true);
    setSummaryError(null);
    setParentSummary("");
    try {
      const res = await fetch("/.netlify/functions/summarize-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: form.notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      setParentSummary(data.summary ?? "");
    } catch (err) {
      setSummaryError(err.message || "Couldn't generate summary, please try again.");
    } finally {
      setSummarizing(false);
    }
  };

  const handleCopyMeetLink = async (lessonId, url) => {
    await navigator.clipboard.writeText(url);
    setMeetLinkCopied(lessonId);
    setTimeout(() => setMeetLinkCopied(null), 2000);
  };

  const handleCopySummary = async () => {
    if (!parentSummary) return;
    await navigator.clipboard.writeText(parentSummary);
    setSummaryCopied(true);
    setTimeout(() => setSummaryCopied(false), 2000);
  };

  const resetForm = () => {
    setEditingId(null);
    setStep(1);
    setParentSummary("");
    setSummaryError(null);
    setForm((f) =>
      emptyForm(
        students,
        f.lesson_date,
        mostRecentLessonTime(lessons, students[0]?.id),
      ),
    );
  };

  const handleSelectStudent = (student) => {
    const firstSubject = subjectsByStudent[student.id]?.[0];
    const hasExistingSessions = isPractitioner
      ? lessons.some((l) => l.student_id === student.id)
      : false;
    const defaultConsultationType = isPractitioner
      ? (hasExistingSessions ? "subsequent" : "initial")
      : "";
    setForm({
      student_id: student.id,
      subject_id: firstSubject?.id ?? "",
      lesson_date: prefillDate ?? today(),
      lesson_time: mostRecentLessonTime(lessons, student.id),
      duration_hours:
        firstSubject?.lesson_duration_hours ?? student.lesson_duration_hours ?? "",
      rate: isPractitioner ? "" : (firstSubject?.hourly_rate ?? student.hourly_rate ?? ""),
      notes: "",
      lesson_mode: "f2f",
      consultation_type: defaultConsultationType,
    });
    setSuccessCycle(null);
    setParentSummary("");
    setSummaryError(null);
    setStep(2);
  };

  const subjectsLabel = (student) => {
    const subs = subjectsByStudent[student.id] ?? [];
    return subs.map((s) => s.subject).filter(Boolean).join(" · ");
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
      lesson_mode: lesson.lesson_mode ?? "f2f",
      consultation_type: lesson.consultation_type ?? "",
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

    // Explicit validation with visible error messages
    if (!form.student_id) {
      setError(`Please select a ${terms.student.toLowerCase()}.`);
      return;
    }
    if (!form.lesson_date) {
      setError("Please enter a date.");
      return;
    }
    if (!form.duration_hours || Number(form.duration_hours) <= 0) {
      setError("Please enter a duration greater than 0.");
      return;
    }
    if (isPractitioner && !form.consultation_type) {
      setError("Please select a consultation type.");
      return;
    }

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
      // form.rate is pre-filled from the rate card lookup and may have been
      // manually edited by the practitioner for this specific session.
      const effectiveRate = form.rate === "" ? null : Number(form.rate);
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
        const isOnline = form.lesson_mode === "online";
        // f2f clears any existing meet link; online preserves existing link
        // (we'll try to get/refresh it from calendar below if possible)
        const existingMeetLink = isOnline ? (original?.meet_link ?? null) : null;

        const { error } = await supabase
          .from("lessons")
          .update({
            student_id: form.student_id,
            student_subject_id: form.subject_id || null,
            subject: subjectText,
            lesson_date: form.lesson_date,
            lesson_time: form.lesson_time || null,
            duration_minutes: Math.round(durationHours * 60),
            rate: effectiveRate,
            notes: form.notes.trim() || null,
            parent_summary: parentSummary.trim() || null,
            lesson_mode: form.lesson_mode,
            meet_link: existingMeetLink,
            consultation_type: form.consultation_type || null,
            status,
            is_completed,
          })
          .eq("id", editingId)
          .eq("tutor_id", user.id);
        if (error) throw error;

        if (original?.google_event_id) {
          console.log("[Calendar update] calling updateLessonInGoogleCalendar, eventId:", original.google_event_id, "lessonTime:", form.lesson_time);
          const calMeetLink = await updateLessonInGoogleCalendar({
            eventId: original.google_event_id,
            lessonId: editingId,
            studentId: form.student_id,
            lessonDate: form.lesson_date,
            lessonTime: form.lesson_time,
            durationMinutes: Math.round(durationHours * 60),
            notes: form.notes.trim(),
            subject: subjectText,
            isOnline,
          });
          if (isOnline && calMeetLink) {
            await supabase
              .from("lessons")
              .update({ meet_link: calMeetLink })
              .eq("id", editingId)
              .eq("tutor_id", user.id);
          }
        } else {
          // No Google Calendar event yet (original sync failed or lesson predates sync).
          // Try to create one now so future edits can update it.
          const student = students.find((s) => s.id === form.student_id);
          const mode = student?.payment_mode ?? "lessons";
          const isMonthlyBilled = mode === "monthly" || mode === "custom_date";
          const isPerLesson = mode === "per_lesson";
          const lessonCount = lessons.filter(
            (l) => l.student_id === form.student_id && l.is_completed,
          ).length;
          const lessonLabel =
            isMonthlyBilled || isPerLesson
              ? `Lesson ${lessonCount}`
              : `Lesson ${lessonCount} of ${student?.payment_cycle_count ?? 4}`;
          await pushLessonToGoogleCalendar({
            lessonId: editingId,
            studentId: form.student_id,
            lessonDate: form.lesson_date,
            lessonTime: form.lesson_time,
            durationMinutes: Math.round(durationHours * 60),
            notes: form.notes.trim(),
            lessonNumber: lessonCount,
            subject: subjectText,
            isOnline,
          });
        }

        setInfo(`${terms.lesson} updated.`);
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

      const isOnline = form.lesson_mode === "online";

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
          rate: effectiveRate,
          notes: form.notes.trim() || null,
          parent_summary: parentSummary.trim() || null,
          lesson_mode: form.lesson_mode,
          consultation_type: form.consultation_type || null,
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
        isOnline,
      });

      if (isFuture) {
        showToast(`${terms.lesson} scheduled. It'll count toward billing once its date arrives.`);
      } else if ((beforeCount ?? 0) + 1 >= 4) {
        const { data: cycle } = await supabase
          .from("payment_cycles")
          .select("*, students(name)")
          .eq("tutor_id", user.id)
          .eq("student_id", form.student_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        setSuccessCycle(cycle ?? null);
        showToast(`${terms.lesson} logged. Payment notice ready!`);
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
        showToast(`${terms.lesson} logged!`);
      }

      setStep(1);
      await reloadLessons();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyNotice = async () => {
    const cycle = successCycle ?? newCycle;
    if (!cycle) return;
    const message = buildPaymentNoticeMessage({
      studentName: cycle.students?.name,
      amountDue: cycle.amount_due,
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
      tutorName: user?.user_metadata?.full_name,
    });
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleComplete = async (lesson) => {
    const next = !lesson.is_completed;
    setLessons((prev) =>
      prev.map((l) => (l.id === lesson.id ? { ...l, is_completed: next } : l)),
    );
    const { error } = await supabase
      .from("lessons")
      .update({ is_completed: next })
      .eq("id", lesson.id)
      .eq("tutor_id", user.id);
    if (error) {
      setLessons((prev) =>
        prev.map((l) =>
          l.id === lesson.id ? { ...l, is_completed: !next } : l,
        ),
      );
      showToast("Something went wrong, please try again", "error");
    } else {
      if (next) showToast(`${terms.lesson} marked complete ✓`, "celebrate");
      await reloadLessons();
    }
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
    showToast(`${terms.lesson} deleted successfully`);
  };

  // Practitioner rate lookup — derived from form state
  const _pStudent = students.find((s) => s.id === form.student_id);
  const _pIsSaturday = form.lesson_date
    ? new Date(`${form.lesson_date}T00:00:00`).getDay() === 6
    : false;
  const _pRateRow = isPractitioner
    ? practitionerRates.find(
        (r) =>
          r.company_id === _pStudent?.company_id &&
          r.client_type === _pStudent?.client_type &&
          r.consultation_type === form.consultation_type,
      )
    : null;
  const lookedUpRate = _pRateRow
    ? (_pIsSaturday ? _pRateRow.rate_saturday : _pRateRow.rate_weekday)
    : null;
  const _pCompany = isPractitioner
    ? practitionerCompanies.find((c) => c.id === _pStudent?.company_id)
    : null;

  // Sync looked-up rate into form.rate so the editable field is pre-filled.
  // Only fires when the lookup result changes (student, consultation type, date).
  // Does not run if the user has already manually edited the field to a different value.
  useEffect(() => {
    if (!isPractitioner) return;
    if (lookedUpRate != null) {
      setForm((prev) => ({ ...prev, rate: String(lookedUpRate) }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookedUpRate]);

  const lessonFormFields = (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {!isPractitioner && (subjectsByStudent[form.student_id] ?? []).length > 1 && (
        <div className="sm:col-span-2">
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
          onChange={(e) => setForm({ ...form, lesson_date: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {isPractitioner ? "Session time (optional)" : "Lesson time (optional)"}
        </label>
        <input
          type="time"
          value={form.lesson_time}
          onChange={(e) => setForm({ ...form, lesson_time: e.target.value })}
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
          onChange={(e) => setForm({ ...form, duration_hours: e.target.value })}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        />
      </div>

      {isPractitioner ? (
        <div className="sm:col-span-2 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Consultation type
            </label>
            <select
              required
              value={form.consultation_type}
              onChange={(e) => setForm({ ...form, consultation_type: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa] sm:max-w-xs"
            >
              <option value="">Select type...</option>
              {CONSULTATION_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Rate (SGD/hr)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              placeholder={form.consultation_type ? "Enter rate" : "Select consultation type first"}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
            />
            {form.consultation_type && (
              <p className="mt-1 text-xs text-gray-400">
                {lookedUpRate != null
                  ? `Default from rate card: $${lookedUpRate}/hr · ${CLIENT_TYPE_LABEL[_pStudent?.client_type] || "—"} · ${CONSULTATION_TYPE_LABEL[form.consultation_type] || "—"} · ${_pIsSaturday ? "Saturday" : "Weekday"}`
                  : <><span className="text-amber-700">No rate set for {CLIENT_TYPE_LABEL[_pStudent?.client_type] || "this type"} · {CONSULTATION_TYPE_LABEL[form.consultation_type] || "this type"}{_pCompany ? ` at ${_pCompany.name}` : ""} — </span><Link to="/settings" className="underline text-amber-700">complete rate card in Settings</Link></>
                }
              </p>
            )}
          </div>
        </div>
      ) : (
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
      )}

      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {isPractitioner ? "Session mode" : "Lesson mode"}
        </label>
        <div className="flex overflow-hidden rounded-md border border-gray-300">
          {[
            { value: "f2f", label: "Face-to-face" },
            { value: "online", label: "Online" },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setForm({ ...form, lesson_mode: opt.value })}
              className={`flex-1 py-2 text-sm font-medium transition ${
                form.lesson_mode === opt.value
                  ? "bg-[#1b2d4f] text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="sm:col-span-2">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          {isPractitioner ? "Session notes (optional)" : "Lesson notes (optional)"}
        </label>
        <textarea
          value={form.notes}
          onChange={(e) => {
            setForm({ ...form, notes: e.target.value });
            if (parentSummary) setParentSummary("");
            if (summaryError) setSummaryError(null);
          }}
          placeholder={
            isPractitioner
              ? "e.g. Progress notes, observations..."
              : "e.g. Covered algebra chapter 3, struggling with fractions..."
          }
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        />

        <button
          type="button"
          onClick={handleSummarize}
          disabled={!form.notes.trim() || summarizing}
          className="mt-2 flex items-center gap-1.5 rounded-md border border-[#93d9c4] bg-[#edf6f3] px-3 py-1.5 text-xs font-medium text-[#0f7a58] transition hover:bg-[#d6ede6] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {summarizing ? (
            <>
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#5ecfaa] border-t-transparent" />
              Summarising…
            </>
          ) : isPractitioner ? (
            "✨ Summarise"
          ) : (
            "✨ Summarise for parent"
          )}
        </button>

        {summaryError && (
          <p className="mt-2 text-xs text-red-600">{summaryError}</p>
        )}

        {parentSummary && (
          <div className="mt-3 rounded-md border border-[#b8e8d9] bg-[#edf6f3] p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-[#0f7a58]">
                {isPractitioner ? "Summary" : "Parent summary"}
              </p>
              <button
                type="button"
                onClick={handleCopySummary}
                className="rounded px-2 py-0.5 text-xs font-medium text-[#0f7a58] hover:bg-[#d6ede6]"
              >
                {summaryCopied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-sm text-[#1b2d4f]">{parentSummary}</p>
          </div>
        )}
      </div>
    </div>
  );

  const conflictOverlay = conflictWarning && (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm text-amber-800">
        ⚠️ You have a conflict at that time in your Google Calendar. Save
        anyway?
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
  );

  return (
    <AppShell>
      {students.length === 0 && !loading ? (
        <p className="rounded-md border border-gray-200 bg-white p-5 text-sm text-gray-500">
          Add a {terms.student.toLowerCase()} first before logging {terms.lessons.toLowerCase()}.{" "}
          <Link
            to="/students"
            className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
          >
            Add a {terms.student.toLowerCase()} →
          </Link>
        </p>
      ) : editingId ? (
        /* ── Edit existing lesson ── */
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
        >
          <h2 className="text-base font-semibold text-gray-900">Edit {terms.lesson.toLowerCase()}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {terms.student}
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
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                required
                value={form.lesson_date}
                onChange={(e) => setForm({ ...form, lesson_date: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {isPractitioner ? "Session time (optional)" : "Lesson time (optional)"}
              </label>
              <input
                type="time"
                value={form.lesson_time}
                onChange={(e) => setForm({ ...form, lesson_time: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Duration (hours)</label>
              <input
                type="number"
                required
                min="0"
                step="0.25"
                value={form.duration_hours}
                onChange={(e) => setForm({ ...form, duration_hours: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            {isPractitioner && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Consultation type</label>
                  <select
                    required
                    value={form.consultation_type}
                    onChange={(e) => setForm({ ...form, consultation_type: e.target.value })}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                  >
                    <option value="">Select type...</option>
                    {CONSULTATION_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Rate (SGD/hr)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.rate}
                    onChange={(e) => setForm({ ...form, rate: e.target.value })}
                    placeholder="Enter rate"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                  />
                  {form.consultation_type && (
                    <p className="mt-1 text-xs text-gray-400">
                      {lookedUpRate != null
                        ? `Default from rate card: $${lookedUpRate}/hr · ${CLIENT_TYPE_LABEL[_pStudent?.client_type] || "—"} · ${CONSULTATION_TYPE_LABEL[form.consultation_type] || "—"} · ${_pIsSaturday ? "Saturday" : "Weekday"}`
                        : <><span className="text-amber-700">No rate set for {CLIENT_TYPE_LABEL[_pStudent?.client_type] || "this type"} · {CONSULTATION_TYPE_LABEL[form.consultation_type] || "this type"}{_pCompany ? ` at ${_pCompany.name}` : ""} — </span><Link to="/settings" className="underline text-amber-700">complete rate card in Settings</Link></>
                      }
                    </p>
                  )}
                </div>
              </>
            )}
            {!isPractitioner && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Rate (SGD/hr)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.rate}
                  onChange={(e) => setForm({ ...form, rate: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {isPractitioner ? "Session mode" : "Lesson mode"}
              </label>
              <div className="flex overflow-hidden rounded-md border border-gray-300">
                {[
                  { value: "f2f", label: "Face-to-face" },
                  { value: "online", label: "Online" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, lesson_mode: opt.value })}
                    className={`flex-1 py-2 text-sm font-medium transition ${
                      form.lesson_mode === opt.value
                        ? "bg-[#1b2d4f] text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {isPractitioner ? "Session notes (optional)" : "Lesson notes (optional)"}
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={
                  isPractitioner
                    ? "e.g. Progress notes, observations..."
                    : "e.g. Covered algebra chapter 3, struggling with fractions..."
                }
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-[#5ecfaa]">{info}</p>}
          {conflictOverlay}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || checkingConflict}
              className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
              id="log-lesson-form-submit"
            >
              {checkingConflict ? "Checking calendar..." : submitting ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : step === 1 ? (
        /* ── Step 1: Pick a student ── */
        <section id="log-lesson-picker" className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Log a {terms.lesson.toLowerCase()} — who did you see?</h2>

          {successCycle && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div>
                <p className="text-sm font-medium text-amber-900">Payment notice ready 💰</p>
                <p className="mt-0.5 text-sm text-amber-800">
                  {successCycle.students?.name} owes{" "}
                  <span className="font-semibold">{formatSGD(successCycle.amount_due)}</span>{" "}
                  for lessons {formatDate(successCycle.period_start)} to{" "}
                  {formatDate(successCycle.period_end)}.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={handleCopyNotice}
                    className="min-h-9 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white hover:bg-[#15243f]"
                  >
                    {copied ? "Copied!" : "Copy notice"}
                  </button>
                  <Link
                    to="/payments"
                    className="flex min-h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    View payments
                  </Link>
                </div>
              </div>
              <button
                onClick={() => setSuccessCycle(null)}
                className="flex-none text-amber-600 hover:text-amber-800"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {students.map((s) => {
                const tier = paymentTierByStudent.get(s.id) ?? "grey";
                const subs = subjectsLabel(s);
                const rateStr = s.hourly_rate ? `$${s.hourly_rate}/hr` : null;
                const durStr = s.lesson_duration_hours
                  ? `${s.lesson_duration_hours}h`
                  : null;
                const detail = [rateStr, durStr].filter(Boolean).join(" · ");
                const companyName = isPractitioner
                  ? (practitionerCompanies.find((c) => c.id === s.company_id)?.name ?? null)
                  : null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectStudent(s)}
                    className="flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-3 text-center transition hover:border-[#5ecfaa] hover:bg-[#edf6f3] focus:outline-none focus:ring-2 focus:ring-[#5ecfaa]"
                  >
                    <StudentAvatar name={s.name} tier={tier} avatarColor={s.avatar_color} />
                    <span className="text-sm font-semibold text-[#1b2d4f] leading-tight">
                      {s.name}
                    </span>
                    {subs && (
                      <span className="text-xs font-medium text-[#0f7a58] leading-tight">
                        {subs}
                      </span>
                    )}
                    {detail && (
                      <span className="text-xs text-gray-400">{detail}</span>
                    )}
                    {companyName && (
                      <span className="text-xs text-gray-400">{companyName}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : (
        /* ── Step 2: Fill in lesson details ── */
        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100"
              aria-label={`Back to ${terms.student.toLowerCase()} picker`}
            >
              ←
            </button>
            <div className="flex items-center gap-2">
              <StudentAvatar
                name={students.find((s) => s.id === form.student_id)?.name ?? ""}
                tier={paymentTierByStudent.get(form.student_id) ?? "grey"}
                avatarColor={students.find((s) => s.id === form.student_id)?.avatar_color}
              />
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  {students.find((s) => s.id === form.student_id)?.name ?? "Lesson"}
                </h2>
                {isPractitioner && (
                  <p className="text-xs text-gray-500">
                    {_pCompany?.name ?? "—"}
                  </p>
                )}
              </div>
            </div>
          </div>

          {lessonFormFields}

          {error && <p className="text-sm text-red-600">{error}</p>}
          {conflictOverlay}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting || checkingConflict}
              className="min-h-11 rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
              id="log-lesson-form-submit"
            >
              {checkingConflict
                ? "Checking calendar..."
                : submitting
                  ? "Logging..."
                  : `Log ${terms.lesson.toLowerCase()}`}
            </button>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
            >
              Back
            </button>
          </div>
        </form>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Recent {terms.lessons.toLowerCase()}
        </h2>

        {!loading && lessons.length > 0 && (
          <div className="mb-4 space-y-3 rounded-md border border-gray-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  {terms.student}
                </label>
                <select
                  value={studentFilter}
                  onChange={(e) => setStudentFilter(e.target.value)}
                  className="min-h-11 w-full rounded-md border border-gray-300 px-2 text-sm"
                >
                  <option value="all">All {terms.students.toLowerCase()}</option>
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
                  placeholder={`${terms.student} name or date`}
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
              {filteredLessons.length === 1 ? terms.lesson.toLowerCase() : terms.lessons.toLowerCase()}
            </p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : lessons.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
            <p className="mb-4 text-5xl">📚</p>
            <p className="mb-6 max-w-sm text-sm text-gray-600">
              No {terms.lessons.toLowerCase()} logged yet. Start by logging your first {terms.lesson.toLowerCase()}!
            </p>
            <button
              type="button"
              onClick={() => {
                if (isPractitioner) {
                  setStep(1);
                  setTimeout(() => {
                    document
                      .getElementById("log-lesson-picker")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 0);
                } else {
                  document
                    .querySelector('select, input[type="date"]')
                    ?.closest("form")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
              className="flex min-h-11 items-center rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Log {terms.lesson}
            </button>
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
              {displayedLessons.map((l) => {
                const isToday = l.lesson_date === today();
                const completed = isLessonCompleted(l);
                return (
                <li
                  key={l.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                      <span>{l.students?.name}</span>
                      {completed ? (
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
                    {!completed ? (
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
                  {l.meet_link && (
                    <div className="mt-2 flex items-center gap-2">
                      <a
                        href={l.meet_link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-medium text-[#0f7a58] underline"
                      >
                        🎥 Join Meet
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopyMeetLink(l.id, l.meet_link)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {meetLinkCopied === l.id ? "Copied!" : "Copy link"}
                      </button>
                    </div>
                  )}
                  {isToday && (
                    <div className="mt-3 flex items-center gap-2">
                      {completed ? (
                        <>
                          <span className="text-xs font-medium text-[#065f46]">✓ Marked complete</span>
                          <button
                            type="button"
                            onClick={() => handleToggleComplete(l)}
                            className="text-xs text-gray-400 underline hover:text-gray-600"
                          >
                            Undo
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleToggleComplete(l)}
                          className="rounded-md bg-[#1b2d4f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15243f]"
                        >
                          ✓ Mark as complete
                        </button>
                      )}
                    </div>
                  )}
                </li>
                );
              })}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">{terms.student}</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Duration</th>
                    <th className="px-4 py-2 font-medium">Rate</th>
                    <th className="px-4 py-2 font-medium">Payment</th>
                    <th className="px-4 py-2 font-medium">Meet</th>
                    <th className="px-4 py-2 font-medium">Today</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {displayedLessons.map((l) => {
                    const isToday = l.lesson_date === today();
                    const completed = isLessonCompleted(l);
                    return (
                    <tr key={l.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {formatDateTime(l.lesson_date, l.lesson_time)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {l.students?.name}
                      </td>
                      <td className="px-4 py-3">
                        {completed ? (
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
                      <td className="px-4 py-3">
                        {l.meet_link ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={l.meet_link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs font-medium text-[#0f7a58] underline"
                            >
                              🎥 Join
                            </a>
                            <button
                              type="button"
                              onClick={() => handleCopyMeetLink(l.id, l.meet_link)}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              {meetLinkCopied === l.id ? "Copied!" : "Copy"}
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isToday ? (
                          completed ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-[#065f46]">✓ Done</span>
                              <button
                                type="button"
                                onClick={() => handleToggleComplete(l)}
                                className="text-xs text-gray-400 underline hover:text-gray-600"
                              >
                                Undo
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleComplete(l)}
                              className="rounded-md bg-[#1b2d4f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15243f]"
                            >
                              ✓ Mark done
                            </button>
                          )
                        ) : (
                          <span className="text-gray-300">—</span>
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
                    );
                  })}
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

      {deleteTarget && (() => {
        const targetLesson = lessons.find((l) => l.id === deleteTarget);
        const targetCycleId = targetLesson?.payment_cycle_id;
        const targetCycle = targetCycleId
          ? paymentCycles.find((c) => c.id === targetCycleId)
          : null;
        const deletingPaid = targetCycle?.status === "paid";
        return (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <div
              className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {deletingPaid && (
                <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  ⚠️ This {terms.lesson.toLowerCase()} is part of a payment that&apos;s already been marked as paid. Deleting it won&apos;t reverse the payment — you&apos;ll need to handle that manually if needed.
                </div>
              )}
              <p className="text-sm text-gray-700">
                Are you sure you want to delete this {terms.lesson.toLowerCase()}? This cannot be
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
                  {deleting ? "Deleting…" : deletingPaid ? "Delete anyway" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </AppShell>
  );
}
