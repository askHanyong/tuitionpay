import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { deleteCalendarEvent, getValidAccessToken } from "../lib/googleCalendar";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";
import Onboarding from "../components/Onboarding";
import GettingStartedChecklist from "../components/GettingStartedChecklist";
import MonthlyRecapCard from "../components/MonthlyRecapCard";
import NotificationPrompt from "../components/NotificationPrompt";
import LessonDetailModal from "../components/LessonDetailModal";

const todayKey = () => toDateKey(new Date());
const tomorrowKey = () => toDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
const nDaysFromNow = (n) =>
  toDateKey(new Date(Date.now() + n * 24 * 60 * 60 * 1000));

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
}

// Update this in one place to ship a new "What's new" banner -- bumping
// the id makes it reappear for everyone even if they dismissed a past one.
const ANNOUNCEMENT = {
  id: "whats-new-2026-07-06",
  headline: "What's new in ChopeAndPay ✨",
  bullets: [
    "🌐 Online or face-to-face — mark lessons as online or in-person; online lessons automatically generate a Google Meet link",
    "✨ AI lesson summaries — turn your rough lesson notes into a clean, parent-friendly summary with one tap",
    "💰 Smarter monthly recap — see your projected earnings for the month based on your full lesson schedule, regardless of payment cycle",
    "💬 We'd love your feedback — reach us anytime via the floating feedback button (WhatsApp or email)",
    "📅 More reliable calendar sync — smoother syncing when editing lessons or scheduling in bulk",
    "🔜 Coming up — Sync to Google Calendar (currently in review with Google, opening to all users soon!)",
  ],
};

function AnnouncementBanner() {
  const dismissKey = `dismissed_${ANNOUNCEMENT.id}`;
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(dismissKey) === "true",
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, "true");
    setDismissed(true);
  };

  return (
    <div className="relative rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 pr-10 shadow-sm sm:p-5">
      <button
        onClick={handleDismiss}
        aria-label="Dismiss announcement"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-[#0f7a58] hover:bg-[#d6ede6]"
      >
        ✕
      </button>
      <p className="text-sm font-semibold text-[#0f1e35]">
        🍀 {ANNOUNCEMENT.headline}
      </p>
      <ul className="mt-2 space-y-1">
        {ANNOUNCEMENT.bullets.map((bullet) => (
          <li key={bullet} className="text-sm text-[#1b2d4f]">
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FEEDBACK_PROMPT_KEY = "feedback-prompt-shown";
const FEEDBACK_PROMPT_THRESHOLD = 5;

function FeedbackPromptCard({ lessonCount }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(FEEDBACK_PROMPT_KEY) === "true",
  );
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (hidden || lessonCount < FEEDBACK_PROMPT_THRESHOLD) return null;

  const dismiss = () => {
    localStorage.setItem(FEEDBACK_PROMPT_KEY, "true");
    setHidden(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("feedback")
      .insert({ tutor_id: user.id, message: text.trim() });
    setSubmitting(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    localStorage.setItem(FEEDBACK_PROMPT_KEY, "true");
    setDone(true);
    setTimeout(() => setHidden(true), 2500);
  };

  return (
    <div className="relative rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 pr-10 shadow-sm sm:p-5">
      <button
        onClick={dismiss}
        aria-label="Dismiss feedback prompt"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-[#0f7a58] hover:bg-[#d6ede6]"
      >
        ✕
      </button>
      {done ? (
        <p className="text-sm font-medium text-[#0f7a58]">
          ✅ Thanks for your feedback!
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm font-semibold text-[#0f1e35]">
            💬 How&apos;s ChopeAndPay working for you?
          </p>
          <p className="text-sm text-[#1b2d4f]">
            Anything you wish it did? We read every message.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Your thoughts..."
            rows={3}
            className="w-full rounded-md border border-[#93d9c4] bg-white px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
          />
          <button
            type="submit"
            disabled={submitting || !text.trim()}
            className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
          >
            {submitting ? "Sending..." : "Send feedback"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const terms = useTerms();
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [todayLessons, setTodayLessons] = useState([]);
  const [nextWeekLessons, setNextWeekLessons] = useState([]);
  const [scheduledLessons, setScheduledLessons] = useState([]);
  const [hasScheduledLesson, setHasScheduledLesson] = useState(false);
  const [overdueLessons, setOverdueLessons] = useState([]);
  const [detailOverdueLesson, setDetailOverdueLesson] = useState(null);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [subscriptionPeriodEnd, setSubscriptionPeriodEnd] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // "monthly" | "annual" | null
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
  // Practitioners skip the onboarding popup entirely — they go straight to
  // the normal empty-state Dashboard ("Add your first client").
  const showOnboarding =
    !loading && students.length === 0 && !onboardingDismissed && !isPractitioner;

  const loadAll = async () => {
    const [
      { data: studentsData },
      { data: lessonsData },
      { data: initialCyclesData },
      { data: todayData },
      { data: tomorrowData },
      { data: scheduledData },
      { data: overdueData },
    ] = await Promise.all([
      supabase
        .from("students")
        .select("*")
        .eq("tutor_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("lessons")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
        .lt("lesson_date", todayKey())
        .order("created_at", { ascending: true }),
      supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
        .order("period_end", { ascending: false }),
      supabase
        .from("lessons")
        .select("*, students(name, subject, address)")
        .eq("tutor_id", user.id)
        .eq("lesson_date", todayKey())
        .order("lesson_time", { ascending: true }),
      supabase
        .from("lessons")
        .select("id, lesson_date, lesson_time, student_id, subject, students(name, subject)")
        .eq("tutor_id", user.id)
        .gt("lesson_date", todayKey())
        .lte("lesson_date", nDaysFromNow(7))
        .order("lesson_date", { ascending: true })
        .order("lesson_time", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, is_completed, duration_minutes, rate, rate_type, students(name)",
        )
        .eq("tutor_id", user.id)
        .gte("lesson_date", todayKey()),
      // Lessons whose scheduled date has already passed and that the tutor
      // has not yet marked Done -- surfaced in the "needs a status update"
      // banner below. Includes today's date since a lesson earlier today
      // may already be past its scheduled time; filtered precisely below.
      supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, subject, duration_minutes, notes, is_completed, google_event_id, students(name, subject, address, payment_mode)",
        )
        .eq("tutor_id", user.id)
        .eq("is_completed", false)
        .lte("lesson_date", todayKey())
        .order("lesson_date", { ascending: true })
        .order("lesson_time", { ascending: true }),
    ]);
    const nonDeletedStudents = (studentsData ?? []).filter((s) => !s.deleted_at);
    const archivedStudentIds = new Set(
      nonDeletedStudents.filter((s) => s.archived).map((s) => s.id),
    );
    const excludeArchived = (rows) =>
      (rows ?? []).filter((r) => !archivedStudentIds.has(r.student_id));
    const deletedStudentIds = new Set(
      (studentsData ?? []).filter((s) => s.deleted_at).map((s) => s.id),
    );
    const excludeDeleted = (rows) =>
      (rows ?? []).filter((r) => !deletedStudentIds.has(r.student_id));

    // Backfill missing payment_cycles rows for monthly/custom_date students
    // whose prior-month lessons haven't triggered DB cycle creation yet
    // (the trigger only fires on lesson activity, not on the passage of time).
    const todayMonthKey = todayKey().slice(0, 7);
    const pendingCycleStudentIds = new Set(
      (initialCyclesData ?? [])
        .filter((c) => c.status === "pending")
        .map((c) => c.student_id),
    );
    const studentsNeedingBackfill = nonDeletedStudents.filter((s) => {
      if (s.archived || pendingCycleStudentIds.has(s.id)) return false;
      const mode = s.payment_mode ?? "lessons";
      if (mode !== "monthly" && mode !== "custom_date") return false;
      return (lessonsData ?? []).some(
        (l) =>
          l.student_id === s.id &&
          l.is_completed &&
          !l.payment_cycle_id &&
          l.lesson_date.slice(0, 7) < todayMonthKey,
      );
    });
    let cyclesData = initialCyclesData;
    if (studentsNeedingBackfill.length > 0) {
      await Promise.all(
        studentsNeedingBackfill.map((s) =>
          supabase.rpc("recompute_payment_cycles", {
            p_student_id: s.id,
            p_tutor_id: user.id,
          }),
        ),
      );
      const { data: refreshedCycles } = await supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
        .order("period_end", { ascending: false });
      cyclesData = refreshedCycles;
    }

    setStudents(nonDeletedStudents.filter((s) => !s.archived));
    setLessons(excludeDeleted(excludeArchived(lessonsData)));
    setPaymentCycles(excludeDeleted(excludeArchived(cyclesData)));
    setTodayLessons(excludeDeleted(excludeArchived(todayData)));
    setNextWeekLessons(excludeDeleted(excludeArchived(tomorrowData)));
    setScheduledLessons(excludeDeleted(excludeArchived(scheduledData)));
    setHasScheduledLesson(excludeDeleted(excludeArchived(scheduledData)).length > 0);
    const nowTimeKey = new Date().toTimeString().slice(0, 5);
    const isInThePast = (l) =>
      l.lesson_date < todayKey() ||
      (l.lesson_date === todayKey() &&
        (!l.lesson_time || l.lesson_time.slice(0, 5) <= nowTimeKey));
    setOverdueLessons(
      excludeDeleted(excludeArchived(overdueData)).filter(isInThePast),
    );
    setLoading(false);
  };

  useEffect(() => {
    const load = async () => {
      const { data: tutorData } = await supabase
        .from("tutors")
        .select(
          "notify_lesson_reminders, notify_payment_due, notify_weekly_summary, onboarding_dismissed, google_calendar_tokens, subscription_status, current_period_end",
        )
        .eq("id", user.id)
        .single();
      if (tutorData) {
        setNotifyPrefs(tutorData);
        setChecklistDismissed(isPractitioner || Boolean(tutorData.onboarding_dismissed));
        setGoogleCalendarConnected(
          Boolean(tutorData.google_calendar_tokens?.access_token),
        );
        setSubscriptionStatus(tutorData.subscription_status ?? null);
        setSubscriptionPeriodEnd(tutorData.current_period_end ?? null);
      }
      await loadAll();
    };
    load();
  }, [user.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "success") {
      showToast("Subscription activated! Thank you 🎉", "celebrate");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (checkout === "canceled") {
      showToast("Checkout cancelled — you can subscribe anytime.", "info");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

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
    const d = new Date(`${dateStr}T00:00:00`);
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
      // Monthly/custom-date students are still "accumulating" for most of the
      // month -- only start showing them as pending once the month is almost
      // over (last 3 days), so the dashboard doesn't nag about a balance
      // that's still growing.
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const daysToEnd = Math.round(
        (endOfMonth -
          new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
          (1000 * 60 * 60 * 24),
      );
      if (daysToEnd > 3) return sum;
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
    // The cycle is only "imminent" enough to count toward this month's
    // pending if the scheduled lesson that would complete it (the next
    // lesson needed to reach payment_cycle_count) actually falls within
    // this month -- otherwise the cycle won't close until a later month.
    const nextScheduled = (scheduledLessonsByStudent.get(studentId) ?? [])
      .slice()
      .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1));
    const lessonsNeeded = cycleCount - unbilledCount;
    const completingLesson = nextScheduled[lessonsNeeded - 1];
    if (completingLesson && !isThisMonth(completingLesson.lesson_date)) {
      return sum;
    }
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
  const lessonsCompletedThisMonth = lessons.filter(
    (l) => l.is_completed && isThisMonth(l.lesson_date),
  ).length;
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
  // Compute all outstanding pending using the same projection the Payments
  // page uses: actual payment_cycles rows first, then mid-cycle lessons-mode
  // students who are 1 lesson away from completion, projecting their full
  // cycle amount so the figure matches what the Payments page shows.
  const allPendingAmount = (() => {
    const pendingStudentIds = new Set(
      paymentCycles
        .filter((c) => c.status === "pending")
        .map((c) => c.student_id),
    );
    const fromCycles = paymentCycles
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + Number(c.amount_due), 0);
    const fromMidCycle = students
      .filter(
        (stu) =>
          (stu.payment_mode ?? "lessons") === "lessons" &&
          !pendingStudentIds.has(stu.id),
      )
      .reduce((sum, stu) => {
        const openLessons = (lessonsByStudent.get(stu.id) ?? []).filter(
          (l) => !l.payment_cycle_id,
        );
        const openCount = openLessons.length;
        if (openCount === 0) return sum;
        const cycleCount = stu.payment_cycle_count ?? 4;
        if (openCount < cycleCount - 1) return sum;
        const cycleLessons = [...openLessons]
          .sort((a, b) => (a.lesson_date < b.lesson_date ? -1 : 1))
          .slice(-cycleCount);
        const cycleAmount = cycleLessons.reduce(
          (s, l) => s + lessonAmount(l, stu),
          0,
        );
        const expectedAmount =
          openCount === cycleCount - 1
            ? (cycleAmount / openCount) * cycleCount
            : cycleAmount;
        return sum + expectedAmount;
      }, 0);
    return fromCycles + fromMidCycle;
  })();

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
      return `Lesson ${pos}`;
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
      .eq("id", lessonId)
      .eq("tutor_id", user.id);
    if (error) {
      setTodayLessons((prev) =>
        prev.map((l) =>
          l.id === lessonId ? { ...l, is_completed: false } : l,
        ),
      );
      showToast(error.message, "error");
      return;
    }
    showToast(`${terms.lesson} marked complete ✓`, "celebrate");
    await loadAll();
    if (notifyPrefs.notify_payment_due) {
      const { data: newCycles } = await supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
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

  const handleUndoDone = async (lessonId) => {
    setTodayLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, is_completed: false } : l)),
    );
    const { error } = await supabase
      .from("lessons")
      .update({ is_completed: false })
      .eq("id", lessonId)
      .eq("tutor_id", user.id);
    if (error) {
      setTodayLessons((prev) =>
        prev.map((l) =>
          l.id === lessonId ? { ...l, is_completed: true } : l,
        ),
      );
      showToast(error.message, "error");
      return;
    }
    await loadAll();
  };

  const handleCollectPayment = async (cycleId) => {
    const { error } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", cycleId)
      .eq("tutor_id", user.id);
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

  // Best-effort: deleting the Google Calendar event must never block
  // deleting the lesson from Supabase, even if the tutor's token is stale
  // or Google's API errors out.
  const deleteOverdueLessonFromGoogleCalendar = async (lesson) => {
    if (!lesson?.google_event_id) return;
    try {
      const { data: tutor } = await supabase
        .from("tutors")
        .select("google_calendar_tokens")
        .eq("id", user.id)
        .single();
      const tokens = tutor?.google_calendar_tokens;
      if (!tokens?.access_token) return;
      const accessToken = await getValidAccessToken(user.id, tokens);
      await deleteCalendarEvent(accessToken, lesson.google_event_id);
    } catch {
      // ignore -- proceed with Supabase delete regardless
    }
  };

  const handleMarkOverdueLessonDone = async (lesson) => {
    setDetailOverdueLesson(null);
    const { error } = await supabase
      .from("lessons")
      .update({ is_completed: true })
      .eq("id", lesson.id)
      .eq("tutor_id", user.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    showToast(`${terms.lesson} marked complete ✓`, "celebrate");
    await loadAll();
  };

  const handleEditOverdueLesson = (lesson) => {
    setDetailOverdueLesson(null);
    navigate("/lessons", { state: { editLessonId: lesson.id } });
  };

  const handleDeleteOverdueLesson = async (lessonId) => {
    await deleteOverdueLessonFromGoogleCalendar(
      overdueLessons.find((l) => l.id === lessonId),
    );
    const { error } = await supabase
      .from("lessons")
      .delete()
      .eq("id", lessonId)
      .eq("tutor_id", user.id);
    if (error) throw new Error(error.message);
    setDetailOverdueLesson(null);
    await loadAll();
  };

  const handleSubscribe = async (plan) => {
    setCheckoutLoading(plan);
    try {
      const { data: { user: freshUser } } = await supabase.auth.getUser();
      if (!freshUser) {
        showToast("Please sign in again to subscribe.", "error");
        return;
      }
      const res = await fetch("/.netlify/functions/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, tutorId: freshUser.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.url) {
        showToast(json.error ?? "Could not start checkout. Please try again.", "error");
        return;
      }
      window.location.href = json.url;
    } catch (err) {
      console.error("handleSubscribe:", err);
      showToast("Could not start checkout. Please try again.", "error");
    } finally {
      setCheckoutLoading(null);
    }
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
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#b8e8d9] bg-[#edf6f3] px-6 py-20 text-center shadow-sm">
          <p className="mb-4 text-6xl">🎓</p>
          <h2 className="mb-2 text-xl font-semibold text-[#1b2d4f]">
            Let&apos;s get started!
          </h2>
          <p className="mb-8 max-w-xs text-sm text-gray-600">
            Add your first {terms.student.toLowerCase()} to begin tracking {terms.lessons.toLowerCase()} and payments.
          </p>
          <Link
            to="/students"
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-[#1b2d4f] px-6 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
          >
            + Add {terms.student}
          </Link>
        </div>

        {!isPractitioner && !["active", "trialing", "grandfathered"].includes(subscriptionStatus) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">Subscribe to ChopeAndPay</p>
            <p className="mt-1 text-sm text-amber-800">
              Keep tracking lessons, payments, and students with a simple subscription.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => handleSubscribe("monthly")}
                disabled={checkoutLoading !== null}
                className="flex min-h-10 items-center rounded-md bg-amber-600 px-5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
              >
                {checkoutLoading === "monthly" ? "Redirecting…" : "SGD 9.99 / month"}
              </button>
              <button
                onClick={() => handleSubscribe("annual")}
                disabled={checkoutLoading !== null}
                className="flex min-h-10 items-center rounded-md border border-amber-600 px-5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
              >
                {checkoutLoading === "annual" ? "Redirecting…" : "SGD 99.00 / year · save 17%"}
              </button>
            </div>
          </div>
        )}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <NotificationPrompt />

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* ── LEFT PANEL — Today & upcoming (60%) ── */}
        <div className="min-w-0 flex-1 space-y-6 md:flex-[3]">
          {/* Summary banner */}
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#1b2d4f] p-4 text-white shadow-sm sm:grid-cols-4">
            <div>
              <p className="text-2xl font-semibold">{students.length}</p>
              <p className="text-xs text-[#5ecfaa]">Active {terms.students.toLowerCase()}</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">{lessonsCompletedThisMonth}</p>
              <p className="text-xs text-[#5ecfaa]">{terms.lessons} this month</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">
                {formatSGD(collectedThisMonth)}
              </p>
              <p className="text-xs text-[#5ecfaa]">Collected this month</p>
            </div>
            <div>
              <p className="text-2xl font-semibold">
                {formatSGD(allPendingAmount)}
              </p>
              <p className="text-xs text-[#5ecfaa]">Pending payment</p>
            </div>
          </div>

          {!isPractitioner && <AnnouncementBanner />}

          {/* Subscription upsell — shown only when there is no active/trialing subscription */}
          {!loading && !isPractitioner && !["active", "trialing", "grandfathered"].includes(subscriptionStatus) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <p className="text-sm font-semibold text-amber-900">
                Subscribe to ChopeAndPay
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Keep tracking lessons, payments, and students with a simple subscription.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => handleSubscribe("monthly")}
                  disabled={checkoutLoading !== null}
                  className="flex min-h-10 items-center rounded-md bg-amber-600 px-5 text-sm font-medium text-white transition hover:bg-amber-700 disabled:opacity-60"
                >
                  {checkoutLoading === "monthly" ? "Redirecting…" : "SGD 9.99 / month"}
                </button>
                <button
                  onClick={() => handleSubscribe("annual")}
                  disabled={checkoutLoading !== null}
                  className="flex min-h-10 items-center rounded-md border border-amber-600 px-5 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                >
                  {checkoutLoading === "annual" ? "Redirecting…" : "SGD 99.00 / year · save 17%"}
                </button>
              </div>
            </div>
          )}

          {/* Subscription status — shown when active so tutor knows their plan */}
          {!loading && subscriptionStatus === "past_due" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
              <p className="text-sm font-semibold text-red-800">Payment past due</p>
              <p className="mt-1 text-sm text-red-700">
                Please update your payment method to keep your subscription active.
              </p>
            </div>
          )}

          <FeedbackPromptCard lessonCount={lessons.length} />

          {!loading && !checklistDismissed && (
            <GettingStartedChecklist
              tutorId={user.id}
              hasStudent={students.length > 0}
              hasLesson={lessons.length > 0}
              googleCalendarConnected={googleCalendarConnected}
              dismissed={checklistDismissed}
              onDismissed={() => setChecklistDismissed(true)}
            />
          )}

          {/* Today's lessons */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <h2 className="mb-4 text-base font-semibold text-gray-900">
              Today&apos;s {terms.lessons.toLowerCase()}
            </h2>
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : todayLessons.length === 0 ? (
              <p className="text-sm text-gray-500">
                🎉 No {terms.lessons.toLowerCase()} today — enjoy your day off!
              </p>
            ) : (
              <ul className="space-y-3">
                {todayLessons.map((l) => {
                  const done = l.is_completed;
                  return (
                    <li
                      key={l.id}
                      className={`flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors ${
                        done
                          ? "border-[#b8e8d9] bg-[#edf6f3]"
                          : "border-gray-100 bg-white"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1.5">
                          <p className="text-sm font-semibold text-gray-900">
                            {l.students?.name}
                          </p>
                          {l.lesson_time && (
                            <span className="text-sm text-gray-500">
                              {formatLessonTime(l.lesson_time)}
                            </span>
                          )}
                          {(l.subject ?? l.students?.subject) && (
                            <span className="text-sm text-gray-500">
                              · {l.subject ?? l.students?.subject}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-gray-400">
                          {lessonBadgeLabel(l)}
                        </p>
                        {l.students?.address && !done && (
                          <p className="mt-0.5 flex items-center gap-2 text-xs text-gray-400">
                            <span>📍 {l.students.address}</span>
                            <a
                              href={buildGoogleMapsUrl(l.students.address)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
                            >
                              Open in Maps
                            </a>
                          </p>
                        )}
                      </div>
                      {done ? (
                        <div className="flex flex-none items-center gap-2">
                          <span className="rounded-md bg-[#d1fae5] px-3 py-1.5 text-xs font-semibold text-[#065f46]">
                            ✓ Done
                          </span>
                          <button
                            onClick={() => handleUndoDone(l.id)}
                            className="text-xs text-gray-400 hover:text-gray-600 underline"
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleMarkDone(l.id)}
                          className="min-h-11 flex-none rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                        >
                          ✓ Done
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Next 7 days */}
          {!loading && (
            <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
              <h2 className="mb-4 text-base font-semibold text-gray-900">Next 7 days</h2>
              <ul className="divide-y divide-gray-100">
                {Array.from({ length: 7 }, (_, i) => {
                  const dateStr = nDaysFromNow(i + 1);
                  const dayLessons = nextWeekLessons.filter(
                    (l) => l.lesson_date === dateStr,
                  );
                  return (
                    <li key={dateStr} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="w-24 flex-none pt-0.5">
                        <span className="text-sm font-medium text-[#1b2d4f]">
                          {formatDayLabel(dateStr)}
                        </span>
                      </div>
                      {dayLessons.length === 0 ? (
                        <span className="text-sm text-gray-400">No {terms.lessons.toLowerCase()}</span>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {dayLessons.map((l) => {
                            const subject = l.subject ?? l.students?.subject;
                            return (
                              <li key={l.id} className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                                <span className="font-medium text-gray-900">{l.students?.name}</span>
                                {subject && (
                                  <span className="text-gray-500">· {subject}</span>
                                )}
                                {l.lesson_time && (
                                  <span className="text-[#0f7a58]">
                                    · {formatLessonTime(l.lesson_time)}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Monthly recap — mobile only (desktop version lives in right panel) */}
          <div className="md:hidden">
            <MonthlyRecapCard
              lessons={lessons}
              paymentCycles={paymentCycles}
              students={students}
              scheduledLessons={scheduledLessons}
              tutorName={user?.user_metadata?.full_name}
              currentMonthPendingOverride={allPendingAmount}
            />
          </div>

          {/* Overdue notices */}
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
                          className="text-sm font-medium text-gray-900 hover:text-[#1b2d4f]"
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
                          className="min-h-11 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f] hover:shadow"
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

          {/* Lessons past their scheduled time that haven't been marked Done */}
          {!isPractitioner && !loading && overdueLessons.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-amber-800">
                📝 {overdueLessons.length} {terms.lesson.toLowerCase()}
                {overdueLessons.length === 1 ? "" : "s"} need
                {overdueLessons.length === 1 ? "s" : ""} a status update
              </h2>
              <ul className="divide-y divide-amber-200/70">
                {overdueLessons.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => setDetailOverdueLesson(l)}
                      className="flex w-full flex-col gap-0.5 py-3 text-left sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-sm font-medium text-gray-900">
                        {l.students?.name}
                      </span>
                      <span className="text-xs text-amber-800">
                        {l.subject ?? l.students?.subject ?? "—"} ·{" "}
                        {formatDate(l.lesson_date)}
                        {l.lesson_time &&
                          ` · ${formatLessonTime(l.lesson_time)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Student payment progress */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {terms.student} payment progress
              </h2>
              <Link
                to="/students"
                className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                Manage {terms.students.toLowerCase()} →
              </Link>
            </div>
            {!loading && students.length > 0 && (
              <p className="mb-3 text-sm">
                {overdueCount === 0 && dueSoonCount === 0 ? (
                  <span className="font-medium text-[#0f7a58]">
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
                    <span className="font-medium text-[#0f7a58]">
                      ✅ {upToDateCount} up to date
                    </span>
                  </>
                )}
              </p>
            )}
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : students.length === 0 ? (
              <p className="text-sm text-gray-500">No {terms.students.toLowerCase()} yet.</p>
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
                            className="text-sm font-medium text-gray-900 hover:text-[#1b2d4f]"
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
                            ? `Last ${terms.lesson.toLowerCase()}: ${formatRelative(lastLessonDate, { includeTime: false })}`
                            : `No ${terms.lessons.toLowerCase()} yet`}
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
                                      className="h-full bg-[#1b2d4f]"
                                      style={{ width: `${completedFrac * 100}%` }}
                                    />
                                    <div
                                      className="h-full bg-[#b8e8d9]"
                                      style={{
                                        width: `${scheduledFrac * 100}%`,
                                        backgroundImage:
                                          "repeating-linear-gradient(45deg, #5ecfaa 0, #5ecfaa 2px, transparent 2px, transparent 6px)",
                                      }}
                                    />
                                  </div>
                                );
                              })()}
                            {status.badge && (
                              <span
                                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE_CLASSES[status.tier]}`}
                              >
                                {status.badge}
                              </span>
                            )}
                          </div>
                          {status.collectCycle && (
                            <button
                              onClick={() =>
                                handleCollectPayment(status.collectCycle.id)
                              }
                              className="min-h-11 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                            >
                              Collect Payment
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {isPractitioner && status.label === "No lessons yet"
                            ? `No ${terms.lessons.toLowerCase()} yet`
                            : status.label}
                        </p>
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

          {/* Payment cycles */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Payment cycles
              </h2>
              <Link
                to="/payments"
                className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
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
        </div>

        {/* ── RIGHT PANEL — Money (40%) ── */}
        <div className="space-y-6 md:sticky md:top-4 md:flex-none md:w-[40%] md:self-start">
          {/* Monthly recap — desktop only (mobile version is in left panel) */}
          <div className="hidden md:block">
            <MonthlyRecapCard
              lessons={lessons}
              paymentCycles={paymentCycles}
              students={students}
              scheduledLessons={scheduledLessons}
              tutorName={user?.user_metadata?.full_name}
              currentMonthPendingOverride={allPendingAmount}
            />
          </div>

          {/* Upcoming lessons */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                Upcoming {terms.lessons}
              </h2>
              <Link
                to="/lessons"
                className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                Log a {terms.lesson.toLowerCase()} →
              </Link>
            </div>
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : upcomingLessons.length === 0 ? (
              <p className="text-sm text-gray-500">
                No upcoming {terms.lessons.toLowerCase()} this week 🎉
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
                    <span className="rounded-full bg-[#edf6f3] px-2.5 py-1 text-xs font-medium text-[#0f7a58]">
                      {lessonBadgeLabel(l)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Earnings */}
          {!loading && (
            <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                {monthLabel} earnings
              </h2>
              <p className="text-sm text-gray-700">
                <span className="font-medium text-[#0f7a58]">
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
        </div>
      </div>

      {detailOverdueLesson && (
        <LessonDetailModal
          key={detailOverdueLesson.id}
          lesson={detailOverdueLesson}
          lessonLabel={lessonBadgeLabel(detailOverdueLesson)}
          paymentCycle={null}
          companyName={null}
          onClose={() => setDetailOverdueLesson(null)}
          onEdit={() => handleEditOverdueLesson(detailOverdueLesson)}
          onMarkDone={() => handleMarkOverdueLessonDone(detailOverdueLesson)}
          onMarkPaid={() => {}}
          onDelete={handleDeleteOverdueLesson}
        />
      )}
    </AppShell>
  );
}
