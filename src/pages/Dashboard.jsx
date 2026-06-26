import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { formatSGD } from "../lib/paymentNotice";
import { formatLessonTime, toDateKey } from "../lib/date";
import { formatDate, formatMonth, formatRelative } from "../utils/dateFormat";
import {
  computeStudentPaymentStatus,
  tierRank,
  TIER_BADGE_CLASSES,
} from "../lib/paymentStatus";
import { getWeekSummaryKey, showAppNotification } from "../lib/notifications";
import { buildGoogleMapsUrl } from "../lib/maps";
import { lessonAmount } from "../lib/paymentMode";
import { useToast } from "../contexts/ToastContext";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";
import Onboarding from "../components/Onboarding";
import GettingStartedChecklist from "../components/GettingStartedChecklist";
import MonthlyRecapCard from "../components/MonthlyRecapCard";
import NotificationPrompt from "../components/NotificationPrompt";

const todayKey = () => toDateKey(new Date());
const tomorrowKey = () => toDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));

export default function Dashboard() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [todayLessons, setTodayLessons] = useState([]);
  const [tomorrowLessons, setTomorrowLessons] = useState([]);
  const [scheduledLessons, setScheduledLessons] = useState([]);
  const [hasScheduledLesson, setHasScheduledLesson] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [notifyPrefs, setNotifyPrefs] = useState({
    notify_lesson_reminders: true,
    notify_payment_due: true,
    notify_weekly_summary: true,
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("chopeandpay_onboarding_dismissed") === "true",
  );
  const pendingCount = paymentCycles.filter(
    (c) => c.status === "pending",
  ).length;
  const showOnboarding =
    !loading && students.length === 0 && !onboardingDismissed;

  const loadAll = async () => {
    const [
      { data: studentsData },
      { data: lessonsData },
      { data: cyclesData },
      { data: todayData },
      { data: tomorrowData },
      { data: scheduledData },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("lessons")
        .select("*, students(name)")
        .eq("is_completed", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .order("period_end", { ascending: false }),
      supabase
        .from("lessons")
        .select("*, students(name, subject, address)")
        .eq("lesson_date", todayKey())
        .order("lesson_time", { ascending: true }),
      supabase
        .from("lessons")
        .select("*, students(name)")
        .eq("lesson_date", tomorrowKey())
        .order("lesson_time", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, is_completed, students(name)",
        )
        .eq("is_completed", false),
    ]);
    setStudents(studentsData ?? []);
    setLessons(lessonsData ?? []);
    setPaymentCycles(cyclesData ?? []);
    setTodayLessons(todayData ?? []);
    setTomorrowLessons(tomorrowData ?? []);
    setScheduledLessons(scheduledData ?? []);
    setHasScheduledLesson((scheduledData ?? []).length > 0);
    setLoading(false);
  };

  useEffect(() => {
    const load = async () => {
      const { data: tutorData } = await supabase
        .from("tutors")
        .select(
          "notify_lesson_reminders, notify_payment_due, notify_weekly_summary, onboarding_dismissed",
        )
        .eq("id", user.id)
        .single();
      if (tutorData) {
        setNotifyPrefs(tutorData);
        setChecklistDismissed(Boolean(tutorData.onboarding_dismissed));
      }
      await loadAll();
    };
    load();
  }, [user.id]);

  useEffect(() => {
    if (!notifyPrefs.notify_lesson_reminders) return;
    const timers = [];
    const now = Date.now();
    for (const lesson of todayLessons) {
      if (lesson.is_completed || !lesson.lesson_time) continue;
      const [h, m] = lesson.lesson_time.split(":").map(Number);
      const lessonTime = new Date();
      lessonTime.setHours(h, m, 0, 0);
      const fireAt = lessonTime.getTime() - 30 * 60 * 1000;
      const delay = fireAt - now;
      if (delay <= 0 || delay > 24 * 60 * 60 * 1000) continue;
      timers.push(
        setTimeout(() => {
          showAppNotification(
            `${lesson.students?.name} at ${formatLessonTime(lesson.lesson_time)} in 30 minutes 📚`,
          );
        }, delay),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [todayLessons, notifyPrefs.notify_lesson_reminders]);

  useEffect(() => {
    if (!notifyPrefs.notify_weekly_summary || loading) return;
    const now = new Date();
    if (now.getDay() !== 0 || now.getHours() < 20) return;
    const key = getWeekSummaryKey(now);
    if (localStorage.getItem(key) === "1") return;
    const weekStart = new Date(now);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - 6);
    const weekStartKey = toDateKey(weekStart);
    const todayK = todayKey();
    const weekLessons = lessons.filter(
      (l) => l.lesson_date >= weekStartKey && l.lesson_date <= todayK,
    );
    const weekEarnings = paymentCycles
      .filter((c) => c.period_end >= weekStartKey && c.period_end <= todayK)
      .reduce((sum, c) => sum + Number(c.amount_due), 0);
    showAppNotification(
      `This week: ${weekLessons.length} lessons · ${formatSGD(weekEarnings)} earned 🎉`,
    );
    localStorage.setItem(key, "1");
  }, [notifyPrefs.notify_weekly_summary, loading, lessons, paymentCycles]);

  const cycleCountByStudent = new Map(
    students.map((s) => [s.id, s.payment_cycle_count ?? 4]),
  );

  const lessonsByStudent = new Map();
  for (const lesson of lessons) {
    if (!lessonsByStudent.has(lesson.student_id))
      lessonsByStudent.set(lesson.student_id, []);
    lessonsByStudent.get(lesson.student_id).push(lesson);
  }

  // Position each lesson within its running billing sequence (sized to the
  // student's own payment_cycle_count, not a fixed 4), based purely on
  // chronological lesson_date -- covers both completed and still-scheduled
  // lessons so the "Lesson X of Y" badge works everywhere it's shown,
  // including upcoming/scheduled lessons in Recent Lessons.
  const lessonPositionByStudent = new Map();
  for (const lesson of [...lessons, ...scheduledLessons]) {
    if (!lessonPositionByStudent.has(lesson.student_id))
      lessonPositionByStudent.set(lesson.student_id, []);
    lessonPositionByStudent.get(lesson.student_id).push(lesson);
  }
  const lessonPosition = new Map();
  for (const [studentId, group] of lessonPositionByStudent) {
    const cycleCount = cycleCountByStudent.get(studentId) ?? 4;
    const sorted = [...group].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    sorted.forEach((lesson, i) =>
      lessonPosition.set(lesson.id, (i % cycleCount) + 1),
    );
  }

  // Monthly/custom-date billing has no fixed cycle size, so a lesson's
  // position there is simply its place within that calendar month, not a
  // running mod-N cycle position.
  const monthlyLessonPosition = new Map();
  const monthlyGroups = new Map();
  for (const lesson of [...lessons, ...scheduledLessons]) {
    const key = `${lesson.student_id}|${lesson.lesson_date?.slice(0, 7)}`;
    if (!monthlyGroups.has(key)) monthlyGroups.set(key, []);
    monthlyGroups.get(key).push(lesson);
  }
  for (const group of monthlyGroups.values()) {
    const sorted = [...group].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    sorted.forEach((lesson, i) => monthlyLessonPosition.set(lesson.id, i + 1));
  }
  const studentsLookup = new Map(students.map((s) => [s.id, s]));
  const isMonthlyBilled = (studentId) => {
    const mode = studentsLookup.get(studentId)?.payment_mode ?? "lessons";
    return mode === "monthly" || mode === "custom_date";
  };
  const isPerLesson = (studentId) =>
    (studentsLookup.get(studentId)?.payment_mode ?? "lessons") === "per_lesson";

  // Per-lesson billing has no fixed cycle size, so a lesson's position is
  // simply its cumulative place among all of that student's lessons.
  const perLessonPosition = new Map();
  const perLessonGroups = new Map();
  for (const lesson of [...lessons, ...scheduledLessons]) {
    if (!perLessonGroups.has(lesson.student_id))
      perLessonGroups.set(lesson.student_id, []);
    perLessonGroups.get(lesson.student_id).push(lesson);
  }
  for (const group of perLessonGroups.values()) {
    const sorted = [...group].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    sorted.forEach((lesson, i) => perLessonPosition.set(lesson.id, i + 1));
  }

  const openCountByStudent = new Map();
  for (const lesson of lessons) {
    if (lesson.payment_cycle_id) continue;
    openCountByStudent.set(
      lesson.student_id,
      (openCountByStudent.get(lesson.student_id) ?? 0) + 1,
    );
  }

  // Upcoming Lessons only shows future, scheduled lessons within the next 7
  // days, soonest first -- past lessons (completed or not) are excluded
  // entirely.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
  const sevenDaysOutStr = sevenDaysOut.toISOString().slice(0, 10);
  const upcomingLessons = scheduledLessons
    .filter((l) => l.lesson_date > todayStr && l.lesson_date <= sevenDaysOutStr)
    .sort((a, b) => {
      if (a.lesson_date !== b.lesson_date) {
        return a.lesson_date < b.lesson_date ? -1 : 1;
      }
      const aTime = a.lesson_time ?? "";
      const bTime = b.lesson_time ?? "";
      return aTime < bTime ? -1 : aTime > bTime ? 1 : 0;
    });

  const lastLessonByStudent = new Map();
  for (const lesson of lessons) {
    const existing = lastLessonByStudent.get(lesson.student_id);
    if (!existing || lesson.lesson_date > existing) {
      lastLessonByStudent.set(lesson.student_id, lesson.lesson_date);
    }
  }

  const scheduledLessonsByStudent = new Map();
  for (const lesson of scheduledLessons) {
    if (!scheduledLessonsByStudent.has(lesson.student_id))
      scheduledLessonsByStudent.set(lesson.student_id, []);
    scheduledLessonsByStudent.get(lesson.student_id).push(lesson);
  }

  const pendingCyclesByStudent = new Map();
  const paidCyclesByStudent = new Map();
  for (const c of paymentCycles) {
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

  const now = new Date();
  const monthLabel = formatMonth(now);
  const isThisMonth = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  };
  const studentsById = new Map(students.map((s) => [s.id, s]));
  const collectedThisMonth = paymentCycles
    .filter((c) => c.status === "paid" && isThisMonth(c.period_end))
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  // A cycle only exists once its full lesson group has landed, so a student
  // mid-cycle has no payment_cycles row at all yet. Their full cycle amount
  // only counts as pending once the cycle is far enough along to be
  // imminent -- at least (payment_cycle_count - 1) completed unbilled
  // lessons -- not from the very first lesson of the cycle.
  const pendingFromCyclesThisMonth = paymentCycles
    .filter((c) => c.status === "pending" && isThisMonth(c.period_end))
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const midCycleStudentIdsThisMonth = new Set(
    lessons
      .filter((l) => !l.payment_cycle_id && isThisMonth(l.lesson_date))
      .map((l) => l.student_id),
  );
  const pendingFromMidCycleLessonsThisMonth = [
    ...midCycleStudentIdsThisMonth,
  ].reduce((sum, studentId) => {
    const student = studentsById.get(studentId);
    if (!student) return sum;
    const mode = student.payment_mode ?? "lessons";
    // Monthly/custom-date billing has no fixed cycle size -- every unbilled
    // lesson this month accumulates toward that month's total, regardless
    // of payment_cycle_count (which only applies to "lessons" mode). Sum
    // each lesson's actual duration_minutes * rate rather than assuming a
    // fixed per-lesson amount.
    if (mode === "monthly" || mode === "custom_date") {
      const unbilledThisMonthLessons = lessons.filter(
        (l) =>
          l.student_id === studentId &&
          !l.payment_cycle_id &&
          isThisMonth(l.lesson_date),
      );
      const total = unbilledThisMonthLessons.reduce(
        (s, l) => s + lessonAmount(l, student),
        0,
      );
      return sum + total;
    }
    const cycleCount = student.payment_cycle_count ?? 4;
    const unbilledCount = openCountByStudent.get(studentId) ?? 0;
    if (unbilledCount < cycleCount - 1) return sum;
    const unbilledLessons = lessons
      .filter(
        (l) =>
          l.student_id === studentId && !l.payment_cycle_id && l.is_completed,
      )
      .sort((a, b) =>
        a.lesson_date < b.lesson_date
          ? -1
          : a.lesson_date > b.lesson_date
            ? 1
            : 0,
      )
      .slice(-cycleCount);
    const cycleAmount = unbilledLessons.reduce(
      (s, l) => s + lessonAmount(l, student),
      0,
    );
    return sum + cycleAmount;
  }, 0);
  const pendingThisMonth =
    pendingFromCyclesThisMonth + pendingFromMidCycleLessonsThisMonth;

  const paymentStatusByStudent = new Map();
  for (const s of students) {
    paymentStatusByStudent.set(
      s.id,
      computeStudentPaymentStatus(s, {
        pendingCycles: pendingCyclesByStudent.get(s.id) ?? [],
        paidCycles: paidCyclesByStudent.get(s.id) ?? [],
        completedLessons: lessonsByStudent.get(s.id) ?? [],
        scheduledLessons: scheduledLessonsByStudent.get(s.id) ?? [],
        openCount: openCountByStudent.get(s.id) ?? 0,
        now,
      }),
    );
  }

  const sortedStudents = [...students].sort((a, b) => {
    const sa = paymentStatusByStudent.get(a.id);
    const sb = paymentStatusByStudent.get(b.id);
    const rankDiff = tierRank(sa.tier) - tierRank(sb.tier);
    if (rankDiff !== 0) return rankDiff;
    if (sb.amountDue !== sa.amountDue) return sb.amountDue - sa.amountDue;
    return a.name.localeCompare(b.name);
  });

  const overdueStudents = sortedStudents.filter(
    (s) => paymentStatusByStudent.get(s.id).tier === "red",
  );
  const dueSoonCount = sortedStudents.filter(
    (s) => paymentStatusByStudent.get(s.id).tier === "amber",
  ).length;
  const overdueCount = overdueStudents.length;
  const upToDateCount = students.length - overdueCount - dueSoonCount;

  const todayLessonNumber = (lesson) =>
    lesson.is_completed
      ? (lessonPosition.get(lesson.id) ?? "?")
      : ((openCountByStudent.get(lesson.student_id) ?? 0) %
          (cycleCountByStudent.get(lesson.student_id) ?? 4)) +
        1;

  // Monthly/custom-date students have no fixed cycle size, so their badge
  // shows the lesson's place within its calendar month instead of "of N".
  const lessonBadgeLabel = (lesson) => {
    if (isMonthlyBilled(lesson.student_id)) {
      const pos = monthlyLessonPosition.get(lesson.id) ?? "?";
      const monthLabel = lesson.lesson_date
        ? formatMonth(new Date(`${lesson.lesson_date}T00:00:00`))
        : "";
      return `Lesson ${pos} · ${monthLabel}`;
    }
    if (isPerLesson(lesson.student_id)) {
      const pos = perLessonPosition.get(lesson.id) ?? "?";
      const dateLabel = lesson.lesson_date
        ? formatDate(lesson.lesson_date)
        : "";
      return `Lesson ${pos} · ${dateLabel}`;
    }
    return `Lesson ${todayLessonNumber(lesson)} of ${
      cycleCountByStudent.get(lesson.student_id) ?? 4
    }`;
  };

  const handleMarkDone = async (lessonId) => {
    const previouslyPendingIds = new Set(
      paymentCycles.filter((c) => c.status === "pending").map((c) => c.id),
    );
    setTodayLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, is_completed: true } : l)),
    );
    const { error } = await supabase
      .from("lessons")
      .update({ is_completed: true })
      .eq("id", lessonId);
    if (error) {
      setTodayLessons((prev) =>
        prev.map((l) =>
          l.id === lessonId ? { ...l, is_completed: false } : l,
        ),
      );
      showToast(error.message, "error");
      return;
    }
    showToast("Lesson marked as done.");
    await loadAll();
    if (notifyPrefs.notify_payment_due) {
      const { data: newCycles } = await supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("status", "pending");
      const newlyCreated = (newCycles ?? []).find(
        (c) => !previouslyPendingIds.has(c.id),
      );
      if (newlyCreated) {
        showAppNotification(
          `${newlyCreated.students?.name} has completed 4 lessons — ${formatSGD(newlyCreated.amount_due)} due! 💰`,
        );
      }
    }
  };

  const handleCollectPayment = async (cycleId) => {
    const { error } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", cycleId);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setPaymentCycles((prev) =>
      prev.map((c) =>
        c.id === cycleId
          ? { ...c, status: "paid", paid_at: new Date().toISOString() }
          : c,
      ),
    );
    showToast("Marked as paid.");
  };

  if (!loading && students.length === 0) {
    return (
      <AppShell>
        <NotificationPrompt />
        {showOnboarding && (
          <Onboarding
            onDismiss={() => setOnboardingDismissed(true)}
            onDone={loadAll}
          />
        )}
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <p className="mb-4 text-5xl">🎓</p>
          <p className="mb-6 max-w-sm text-sm text-gray-600">
            Welcome! Add your first student to get started.
          </p>
          <Link
            to="/students"
            className="flex min-h-11 items-center rounded-md bg-green-600 px-5 text-sm font-medium text-white hover:bg-green-700"
          >
            Add Student
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <NotificationPrompt />

      {!loading && !checklistDismissed && (
        <GettingStartedChecklist
          tutorId={user.id}
          hasStudent={students.length > 0}
          hasScheduledLesson={hasScheduledLesson}
          hasCompletedLesson={lessons.length > 0}
          hasPaidCycle={paymentCycles.some((c) => c.status === "paid")}
          dismissed={checklistDismissed}
          onDismissed={() => setChecklistDismissed(true)}
        />
      )}

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Today&apos;s lessons
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : todayLessons.length === 0 ? (
          <p className="text-sm text-gray-500">
            🎉 No lessons today — enjoy your day off!
          </p>
        ) : (
          <ul className="space-y-3">
            {todayLessons.map((l) => {
              const done = l.is_completed;
              return (
                <li
                  key={l.id}
                  className="flex flex-col gap-3 rounded-lg border border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {l.students?.name}
                      {l.lesson_time && ` · ${formatLessonTime(l.lesson_time)}`}
                      {l.students?.subject && ` · ${l.students.subject}`}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {lessonBadgeLabel(l)}
                    </p>
                    {l.students?.address && (
                      <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                        <span>📍 {l.students.address}</span>
                        <a
                          href={buildGoogleMapsUrl(l.students.address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-green-600 hover:text-green-700"
                        >
                          Open in Maps
                        </a>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => !done && handleMarkDone(l.id)}
                    disabled={done}
                    className={
                      done
                        ? "min-h-11 w-full rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-500 sm:w-auto"
                        : "min-h-11 w-full rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow sm:w-auto"
                    }
                  >
                    {done ? "✓ Done" : "✅ Mark as Done"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && tomorrowLessons.length > 0 && (
          <p className="mt-4 text-xs text-gray-400">
            Tomorrow:{" "}
            {tomorrowLessons
              .map(
                (l) =>
                  `${l.students?.name} at ${formatLessonTime(l.lesson_time)}`,
              )
              .join(" · ")}
          </p>
        )}
      </section>

      <MonthlyRecapCard
        lessons={lessons}
        paymentCycles={paymentCycles}
        students={students}
        tutorName={user?.user_metadata?.full_name}
      />

      {!loading && overdueStudents.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-5 shadow-sm">
          <h2 className="mb-3 text-base font-semibold text-red-800">
            ⚠️ Action needed — payments overdue
          </h2>
          <ul className="divide-y divide-red-200/70">
            {overdueStudents.map((s) => {
              const status = paymentStatusByStudent.get(s.id);
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <Link
                      to={`/students/${s.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-green-700"
                    >
                      {s.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-red-800">
                      {status.label}
                    </p>
                  </div>
                  {status.collectCycle && (
                    <button
                      onClick={() =>
                        handleCollectPayment(status.collectCycle.id)
                      }
                      className="min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white transition hover:bg-green-700 hover:shadow"
                    >
                      Collect Payment
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md lg:col-span-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              Student payment progress
            </h2>
            <Link
              to="/students"
              className="text-sm font-medium text-green-600 hover:text-green-700"
            >
              Manage students →
            </Link>
          </div>
          {!loading && students.length > 0 && (
            <p className="mb-3 text-sm">
              {overdueCount === 0 && dueSoonCount === 0 ? (
                <span className="font-medium text-green-700">
                  ✅ All payments up to date
                </span>
              ) : (
                <>
                  <span className="font-medium text-red-600">
                    🔴 {overdueCount} overdue
                  </span>{" "}
                  ·{" "}
                  <span className="font-medium text-amber-600">
                    ⚠️ {dueSoonCount} due soon
                  </span>{" "}
                  ·{" "}
                  <span className="font-medium text-green-700">
                    ✅ {upToDateCount} up to date
                  </span>
                </>
              )}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : students.length === 0 ? (
            <p className="text-sm text-gray-500">No students yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {sortedStudents.map((s) => {
                const status = paymentStatusByStudent.get(s.id);
                const lastLessonDate = lastLessonByStudent.get(s.id);
                return (
                  <li
                    key={s.id}
                    className="flex flex-col gap-3 rounded-lg px-2 py-3 transition hover:bg-gray-50 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/students/${s.id}`}
                          className="text-sm font-medium text-gray-900 hover:text-green-700"
                        >
                          {s.name}
                        </Link>
                        {s.subject && (
                          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            {s.subject}
                          </span>
                        )}
                      </div>
                      {(s.level || s.subject) && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {[s.level, s.subject].filter(Boolean).join(" ")}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-400">
                        {lastLessonDate
                          ? `Last lesson: ${formatRelative(lastLessonDate, { includeTime: false })}`
                          : "No lessons yet"}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 sm:items-end">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3">
                          {status.showProgressBar &&
                            (() => {
                              const cycleCount = s.payment_cycle_count ?? 4;
                              const completedFrac =
                                Math.min(
                                  status.completedCount ?? 0,
                                  cycleCount,
                                ) / cycleCount;
                              const scheduledFrac =
                                Math.min(
                                  (status.completedCount ?? 0) +
                                    (status.scheduledCount ?? 0),
                                  cycleCount,
                                ) /
                                  cycleCount -
                                completedFrac;
                              return (
                                <div
                                  title={`${formatSGD(status.cycleAmount ?? 0)} due at completion`}
                                  className="flex h-2 w-full max-w-40 flex-1 overflow-hidden rounded-full bg-gray-100 sm:w-24 sm:flex-none"
                                >
                                  <div
                                    className="h-full bg-green-600"
                                    style={{ width: `${completedFrac * 100}%` }}
                                  />
                                  <div
                                    className="h-full bg-green-200"
                                    style={{
                                      width: `${scheduledFrac * 100}%`,
                                      backgroundImage:
                                        "repeating-linear-gradient(45deg, #16a34a 0, #16a34a 2px, transparent 2px, transparent 6px)",
                                    }}
                                  />
                                </div>
                              );
                            })()}
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE_CLASSES[status.tier]}`}
                          >
                            {status.label}
                          </span>
                        </div>
                        {status.collectCycle && (
                          <button
                            onClick={() =>
                              handleCollectPayment(status.collectCycle.id)
                            }
                            className="min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white transition hover:bg-green-700 hover:shadow"
                          >
                            Collect Payment
                          </button>
                        )}
                      </div>
                      {status.nextPaymentInfo && (
                        <p
                          className={`text-xs ${status.nextPaymentInfo.tone === "red" ? "text-red-700" : "text-gray-500"}`}
                        >
                          {status.nextPaymentInfo.text}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="grid grid-cols-1 gap-6 lg:col-span-5 xl:grid-cols-2">
          {!loading && (
            <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md xl:order-2">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                {monthLabel} earnings
              </h2>
              <p className="text-sm text-gray-700">
                <span className="font-medium text-green-700">
                  ✅ Collected: {formatSGD(collectedThisMonth)}
                </span>
                {" · "}
                <span className="font-medium text-amber-700">
                  ⏳ Pending: {formatSGD(pendingThisMonth)}
                </span>
                {" · "}
                <span className="font-semibold text-gray-900">
                  Total: {formatSGD(collectedThisMonth + pendingThisMonth)}
                </span>
              </p>
            </section>
          )}

          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md xl:order-1">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Upcoming Lessons
              </h2>
              <Link
                to="/lessons"
                className="text-sm font-medium text-green-600 hover:text-green-700"
              >
                Log a lesson →
              </Link>
            </div>
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : upcomingLessons.length === 0 ? (
              <p className="text-sm text-gray-500">
                No upcoming lessons this week 🎉
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {upcomingLessons.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between rounded-lg px-2 py-3 transition hover:bg-gray-50"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {l.students?.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(l.lesson_date)}
                      </p>
                    </div>
                    <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                      {lessonBadgeLabel(l)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Payment cycles
          </h2>
          <Link
            to="/payments"
            className="text-sm font-medium text-green-600 hover:text-green-700"
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
          <ul className="divide-y divide-gray-100">
            {[
              ...paymentCycles.filter((c) => c.status !== "paid"),
              ...paymentCycles.filter((c) => c.status === "paid"),
            ].map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition hover:bg-gray-50"
              >
                <span className="text-sm text-gray-700">
                  {c.students?.name}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-gray-900">
                    {formatSGD(c.amount_due)}
                  </span>
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
