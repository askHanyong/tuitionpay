import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { formatSGD } from "../lib/paymentNotice";
import { formatLessonTime, toDateKey } from "../lib/date";
import {
  formatDate,
  formatDateFull,
  formatMonth,
  formatRelative,
} from "../utils/dateFormat";
import {
  computeStudentPaymentStatus,
  tierRank,
  TIER_BADGE_CLASSES,
} from "../lib/paymentStatus";
import { getWeekSummaryKey, showAppNotification } from "../lib/notifications";
import { buildGoogleMapsUrl } from "../lib/maps";
import { lessonAmount } from "../lib/paymentMode";
import {
  buildPaymentRequestMessage,
  buildPaymentSummaryUrl,
} from "../lib/whatsapp";
import { deleteCalendarEvent, getValidAccessToken } from "../lib/googleCalendar";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";
import { confirmClosedMonthChange, latestUnbilledLessonDate, lessonToggleDates, studentOwedDates } from "../lib/closedMonths";
import { activityMonths, monthName, shiftMonth, sgtTodayKey } from "../lib/monthClose";
import Onboarding from "../components/Onboarding";
import GettingStartedChecklist from "../components/GettingStartedChecklist";
import { buildOwedRows, owedInvariantHolds, sumOwed } from "../lib/owed";
import MonthlyRecapCard from "../components/MonthlyRecapCard";
import NotificationPrompt from "../components/NotificationPrompt";
import LessonDetailModal from "../components/LessonDetailModal";
import LessonTopicsModal from "../components/LessonTopicsModal";
import { useTopicTrackedStudents } from "../hooks/useTopicTrackedStudents";
import MessagePreviewModal from "../components/MessagePreviewModal";
import PendingBreakdownModal from "../components/PendingBreakdownModal";
import PracticeBadge from "../components/PracticeBadge";
import { excludePractice, isPractice } from "../lib/practice";

const todayKey = () => toDateKey(new Date());

const STALLED_CYCLE_THRESHOLD_DAYS = 21;

// Update this in one place to ship a new "What's new" banner -- bumping
// the id makes it reappear for everyone even if they dismissed a past one.
const ANNOUNCEMENT = {
  id: "whats-new-2026-12-month-close",
  headline: "What's New in ChopeAndPay",
  bullets: [
    "🔒 Month-end close — once a month is over, close it to lock in your figures. You'll get a warning if you change a closed month, and the year-end report uses your closed months. Open Month-end close from the Payments page.",
    "💸 Write off unpaid amounts — use the new Write off button on the Payments page to remove amounts you won't collect. It won't count as Collected. Undo anytime from the Written off section.",
    "📋 Pending now includes archived and deleted students — money they owe still shows up under Pending so you can write it off. Find their cycles on the Payments page.",
    "📆 Parent booking — set your open slots on the Availability page, share a private link from each student's profile, and parents can request a lesson.",
    "🏢 Agency statements — build a monthly claim statement with your share, expenses and placement fees, then download it as Excel. Find it from the Payments page.",
    "📊 Smarter monthly recap — see how each month splits between your take-home and what each agency earns.",
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
  const [recapStudents, setRecapStudents] = useState([]);
  const [payees, setPayees] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [recapLessons, setRecapLessons] = useState([]);
  const [paymentCycles, setPaymentCycles] = useState([]);
  const [recapPaymentCycles, setRecapPaymentCycles] = useState([]);
  const [todayLessons, setTodayLessons] = useState([]);
  const [scheduledLessons, setScheduledLessons] = useState([]);
  const [overdueLessons, setOverdueLessons] = useState([]);
  const [detailOverdueLesson, setDetailOverdueLesson] = useState(null);
  const [topicsLesson, setTopicsLesson] = useState(null);
  const topicTrackedStudentIds = useTopicTrackedStudents(user?.id);
  // Month-end close: "YYYY-MM" -> month_closes row. undefined until loaded (or if
  // the load fails), so the recap card and nudge then behave as before.
  const [closedMonths, setClosedMonths] = useState(undefined);
  const [nudgeDismissed, setNudgeDismissed] = useState({});
  useEffect(() => {
    if (!user?.id || isPractitioner) return;
    let cancelled = false;
    supabase
      .from("month_closes")
      .select("id, month, status, closed_at, snapshot")
      .eq("tutor_id", user.id)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setClosedMonths(new Map((data ?? []).map((r) => [String(r.month).slice(0, 7), r])));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, isPractitioner]);
  const [checklistDismissed, setChecklistDismissed] = useState(true);
  const [googleCalendarConnected, setGoogleCalendarConnected] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // "monthly" | "annual" | null
  const [preview, setPreview] = useState(null); // WhatsApp message preview
  const [remindingStudentId, setRemindingStudentId] = useState(null);
  const [pendingBreakdownState, setPendingBreakdownState] = useState(null);
  const [stalledDismissed, setStalledDismissed] = useState(() => {
    try {
      const raw = localStorage.getItem("chopeandpay_stalled_dismissed");
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const now = Date.now();
      const valid = {};
      for (const [id, until] of Object.entries(parsed)) {
        if (until > now) valid[id] = until;
      }
      return valid;
    } catch {
      return {};
    }
  });
  const [grandfatheredBannerDismissed, setGrandfatheredBannerDismissed] = useState(() => {
    try { return localStorage.getItem("chope_grandfathered_banner_dismissed") === "1"; } catch { return false; }
  });
  const [loading, setLoading] = useState(true);
  const [pendingBookingCount, setPendingBookingCount] = useState(0);
  const [notifyPrefs, setNotifyPrefs] = useState({
    notify_lesson_reminders: true,
    notify_payment_due: true,
    notify_weekly_summary: true,
  });
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem("chopeandpay_onboarding_dismissed") === "true",
  );
  // Practice students stay visible (today's lessons, upcoming, Done, ...) but
  // never count in money figures. The lookup covers ALL students, archived and
  // deleted included, so their lessons and notices are caught too.
  const studentsById = useMemo(
    () => new Map(recapStudents.map((s) => [s.id, s])),
    [recapStudents],
  );
  const moneyStudents = useMemo(
    () => excludePractice(students, studentsById),
    [students, studentsById],
  );
  const moneyRecapStudents = useMemo(
    () => excludePractice(recapStudents, studentsById),
    [recapStudents, studentsById],
  );
  const moneyLessons = useMemo(
    () => excludePractice(lessons, studentsById),
    [lessons, studentsById],
  );
  const moneyRecapLessons = useMemo(
    () => excludePractice(recapLessons, studentsById),
    [recapLessons, studentsById],
  );
  const moneyCycles = useMemo(
    () => excludePractice(paymentCycles, studentsById),
    [paymentCycles, studentsById],
  );
  const moneyRecapCycles = useMemo(
    () => excludePractice(recapPaymentCycles, studentsById),
    [recapPaymentCycles, studentsById],
  );
  const moneyScheduledLessons = useMemo(
    () => excludePractice(scheduledLessons, studentsById),
    [scheduledLessons, studentsById],
  );
  const isPracticeLesson = (l) => isPractice(studentsById.get(l.student_id));

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
      { data: scheduledData },
      { data: overdueData },
      { data: payeesData },
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
        .select("*, students(name, subject, address, is_practice)")
        .eq("tutor_id", user.id)
        .eq("lesson_date", todayKey())
        .order("lesson_time", { ascending: true }),
      supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, is_completed, duration_minutes, rate, rate_type, students(name, is_practice)",
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
          "id, student_id, lesson_date, lesson_time, subject, duration_minutes, notes, is_completed, google_event_id, students(name, subject, address, payment_mode, is_practice)",
        )
        .eq("tutor_id", user.id)
        .eq("is_completed", false)
        .lte("lesson_date", todayKey())
        .order("lesson_date", { ascending: true })
        .order("lesson_time", { ascending: true }),
      supabase.from("payees").select("id, name").eq("tutor_id", user.id),
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
    setRecapStudents(studentsData ?? []);
    setPayees(payeesData ?? []);
    setLessons(excludeDeleted(excludeArchived(lessonsData)));
    setRecapLessons(lessonsData ?? []);
    setPaymentCycles(excludeDeleted(excludeArchived(cyclesData)));
    setRecapPaymentCycles(cyclesData ?? []);
    setTodayLessons(excludeDeleted(excludeArchived(todayData)));
    setScheduledLessons(excludeDeleted(excludeArchived(scheduledData)));
    const nowTimeKey = new Date().toTimeString().slice(0, 5);
    const isInThePast = (l) =>
      l.lesson_date < todayKey() ||
      (l.lesson_date === todayKey() &&
        (!l.lesson_time || l.lesson_time.slice(0, 5) <= nowTimeKey));
    setOverdueLessons(
      excludeDeleted(excludeArchived(overdueData)).filter(isInThePast),
    );
    setLoading(false);

    // Load pending booking request count (unexpired only)
    const now = new Date().toISOString();
    const { count: bookingCount } = await supabase
      .from("booking_requests")
      .select("id", { count: "exact", head: true })
      .eq("tutor_id", user.id)
      .eq("status", "pending")
      .gt("expires_at", now);
    setPendingBookingCount(bookingCount ?? 0);
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
    const weekLessons = moneyLessons.filter(
      (l) => l.lesson_date >= weekStartKey && l.lesson_date <= todayK,
    );
    const weekEarnings = moneyCycles
      .filter((c) => c.period_end >= weekStartKey && c.period_end <= todayK)
      .reduce((sum, c) => sum + Number(c.amount_due), 0);
    showAppNotification(
      `This week: ${weekLessons.length} lessons · ${formatSGD(weekEarnings)} earned 🎉`,
    );
    localStorage.setItem(key, "1");
  }, [notifyPrefs.notify_weekly_summary, loading, moneyLessons, moneyCycles]);

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
      c.status === "pending" || c.status === "overdue"
        ? pendingCyclesByStudent
        : c.status === "paid"
          ? paidCyclesByStudent
          : null;
    if (!map) continue;
    if (!map.has(c.student_id)) map.set(c.student_id, []);
    map.get(c.student_id).push(c);
  }

  const now = new Date();
  const paymentStatusByStudent = new Map();
  for (const s of moneyStudents) {
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

  const sortedStudents = [...moneyStudents].sort((a, b) => {
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
  const upToDateCount = moneyStudents.length - overdueCount - dueSoonCount;
  // Compute all outstanding pending using recapPaymentCycles (includes archived
  // and deleted students) so their owed money counts. Both 'pending' and
  // 'overdue' cycles are owed; 'waived' cycles are excluded.
  const owedRows = buildOwedRows({
    cycles: moneyRecapCycles,
    allStudents: recapStudents,
    activeStudents: moneyStudents,
    allLessons: moneyRecapLessons,
    payees,
  });
  const allPendingAmount = sumOwed(owedRows);
  if (import.meta.env.DEV && !owedInvariantHolds(owedRows, allPendingAmount)) {
    console.error("[owed] owed to tutor + via agency + not yet billed does not equal Pending", allPendingAmount);
  }

  // Pending breakdown rows — computed only when the modal is open.
  const pendingBreakdownRows = (() => {
    if (!pendingBreakdownState) return [];
    const { monthDate, isCurrentMonth } = pendingBreakdownState;

    function isSameMonthLocal(dateStr, ref) {
      if (!dateStr) return false;
      const d = new Date(`${dateStr}T00:00:00`);
      return (
        d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
      );
    }

    const rows = [];

    if (isCurrentMonth) {
      return owedRows;
    } else {
      const owedCycles = moneyRecapCycles.filter(
        (c) =>
          (c.status === "pending" || c.status === "overdue") &&
          isSameMonthLocal(c.period_end, monthDate),
      );
      for (const c of owedCycles) {
        const student = recapStudents.find((s) => s.id === c.student_id) ?? null;
        rows.push({
          type: "cycle",
          studentId: c.student_id,
          studentName: student?.name ?? c.students?.name ?? "—",
          amount: Number(c.amount_due),
          tag: c.status === "overdue" ? "Overdue" : "Pending",
          archived: student ? !!student.archived : false,
          deleted: student ? !!student.deleted_at : false,
          cycleId: c.id,
          cycleStatus: c.status,
          cycle: c,
          student,
        });
      }
    }

    return rows;
  })();

  // Stalled cycles: lessons-mode students with open unbilled lessons, last
  // lesson > STALLED_CYCLE_THRESHOLD_DAYS ago, no scheduled future lessons.
  // Include archived; exclude deleted.
  const stalledItems = (() => {
    const now = new Date();
    const recapLessonsByStudent = new Map();
    for (const l of moneyRecapLessons) {
      if (!recapLessonsByStudent.has(l.student_id))
        recapLessonsByStudent.set(l.student_id, []);
      recapLessonsByStudent.get(l.student_id).push(l);
    }
    const scheduledStudentIds = new Set(
      moneyScheduledLessons.map((l) => l.student_id),
    );

    const items = [];
    for (const stu of moneyRecapStudents) {
      if (stu.deleted_at) continue;
      if ((stu.payment_mode ?? "lessons") !== "lessons") continue;
      const openLessons = (recapLessonsByStudent.get(stu.id) ?? []).filter(
        (l) => l.is_completed && !l.payment_cycle_id,
      );
      if (openLessons.length === 0) continue;
      const lastLesson = openLessons.reduce(
        (latest, l) =>
          !latest || l.lesson_date > latest ? l.lesson_date : latest,
        null,
      );
      if (!lastLesson) continue;
      const daysSinceLast = Math.floor(
        (now - new Date(`${lastLesson}T00:00:00`)) / (1000 * 60 * 60 * 24),
      );
      if (daysSinceLast <= STALLED_CYCLE_THRESHOLD_DAYS) continue;
      if (scheduledStudentIds.has(stu.id)) continue;
      const amount = openLessons.reduce((s, l) => s + lessonAmount(l, stu), 0);
      items.push({
        student: stu,
        openLessons,
        lastLesson,
        amount,
        count: openLessons.length,
      });
    }
    return items;
  })();

  const visibleStalledItems = stalledItems.filter(
    (item) => !stalledDismissed[item.student.id],
  );

  // "Needs your attention" lists every unpaid cycle once. For tutors, a cycle
  // that belongs to an overdue student is flagged red with the reason from the
  // student's payment status (e.g. "September unpaid") and sorted first.
  // Practitioners keep their separate overdue card and see no flags here.
  const overdueReasonByCycleId = new Map();
  if (!isPractitioner) {
    for (const st of overdueStudents) {
      const status = paymentStatusByStudent.get(st.id);
      if (!status?.collectCycle) continue;
      const label = status.label ?? "";
      overdueReasonByCycleId.set(
        status.collectCycle.id,
        label.includes(" — ") ? label.split(" — ").slice(1).join(" — ") : label,
      );
    }
  }
  const unpaidCycles = moneyCycles
    .filter((c) => c.status === "pending" || c.status === "overdue")
    .sort(
      (a, b) =>
        (overdueReasonByCycleId.has(b.id) ? 1 : 0) -
        (overdueReasonByCycleId.has(a.id) ? 1 : 0),
    );
  const unpaidTotal = unpaidCycles.reduce(
    (sum, c) => sum + Number(c.amount_due),
    0,
  );

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
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "lesson", dateKeys: lessonToggleDates(todayLessons.find((l) => l.id === lessonId), true) }))) return;
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
      const newlyCreated = excludePractice(newCycles ?? [], studentsById).find(
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
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "lesson", dateKeys: lessonToggleDates(todayLessons.find((l) => l.id === lessonId), false) }))) return;
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

  // Opens the same editable WhatsApp payment request the Payments page uses,
  // for the oldest unpaid cycle of an overdue student. PayNow details and the
  // cycle's lesson dates are fetched on tap so loadAll() stays unchanged.
  const handleRemind = async (student, cycle) => {
    setRemindingStudentId(student.id);
    try {
      const [{ data: tutor }, { data: cycleLessons }] = await Promise.all([
        supabase
          .from("tutors")
          .select("full_name, paynow_number")
          .eq("id", user.id)
          .single(),
        supabase
          .from("lessons")
          .select("lesson_date")
          .eq("tutor_id", user.id)
          .eq("student_id", cycle.student_id)
          .eq("is_completed", true)
          .gte("lesson_date", cycle.period_start)
          .lte("lesson_date", cycle.period_end)
          .order("lesson_date", { ascending: true }),
      ]);
      const message = buildPaymentRequestMessage({
        studentName: student.name,
        subject: student.subject,
        lessonDates: (cycleLessons ?? []).map((l) => l.lesson_date),
        amountDue: cycle.amount_due,
        tutorName: tutor?.full_name ?? user?.user_metadata?.full_name,
        paynowNumber: tutor?.paynow_number,
        paymentMode: student.payment_mode,
        monthLabel: formatMonth(cycle.period_end),
        dueDateLabel: formatDateFull(cycle.period_end),
        guardianName: student.guardian_name,
        paymentLink: buildPaymentSummaryUrl(student.payment_token),
      });
      setPreview({
        title: "Payment request",
        message,
        mode: "whatsapp",
        phone: student.guardian_contact,
      });
    } catch (err) {
      console.error("handleRemind:", err);
      showToast("Could not prepare the reminder. Please try again.", "error");
    } finally {
      setRemindingStudentId(null);
    }
  };

  const handleCollectPayment = async (cycleId) => {
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "paid", dateKeys: [unpaidCycles.find((c) => c.id === cycleId)?.period_end] }))) return;
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

  const handleWaiveCycle = async (cycleId, currentStatus) => {
    const cycle = unpaidCycles.find((c) => c.id === cycleId);
    const name = cycle?.students?.name ?? "this student";
    const amount = cycle ? formatSGD(Number(cycle.amount_due)) : "";
    if (
      !window.confirm(
        `Write off ${amount} from ${name}? This removes it from Pending. It won't count as Collected.`,
      )
    )
      return;
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "notice", dateKeys: [cycle?.period_end] }))) return;
    const { error } = await supabase
      .from("payment_cycles")
      .update({
        status: "waived",
        waived_from_status: currentStatus,
        waived_at: new Date().toISOString(),
      })
      .eq("id", cycleId)
      .eq("tutor_id", user.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadAll();
    showToast("Written off.");
  };

  const handlePendingTap = (monthDate, isCurrentMonth) => {
    setPendingBreakdownState({ monthDate, isCurrentMonth });
  };

  const handleBillNowMidCycle = async (student) => {
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "notice", dateKeys: () => latestUnbilledLessonDate(user.id, student.id) }))) return;
    const { error } = await supabase.rpc("create_manual_closeout_cycle", {
      p_student_id: student.id,
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setPendingBreakdownState(null);
    await loadAll();
    showToast("Invoice created.");
  };

  const handleDismissStalled = (studentId) => {
    const until = Date.now() + 30 * 24 * 60 * 60 * 1000;
    setStalledDismissed((prev) => {
      const next = { ...prev, [studentId]: until };
      try {
        localStorage.setItem(
          "chopeandpay_stalled_dismissed",
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  };

  const handleBillNowStalled = async (student) => {
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "notice", dateKeys: () => latestUnbilledLessonDate(user.id, student.id) }))) return;
    const { error } = await supabase.rpc("create_manual_closeout_cycle", {
      p_student_id: student.id,
    });
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadAll();
    showToast("Invoice created.");
  };

  const handleWriteOffStalled = async (student) => {
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "notice", dateKeys: () => studentOwedDates(user.id, student.id) }))) return;
    const { error: rpcErr } = await supabase.rpc("create_manual_closeout_cycle", {
      p_student_id: student.id,
    });
    if (rpcErr) {
      showToast(rpcErr.message, "error");
      return;
    }
    const { data: pendingCycles, error: fetchErr } = await supabase
      .from("payment_cycles")
      .select("id, status")
      .eq("tutor_id", user.id)
      .eq("student_id", student.id)
      .in("status", ["pending", "overdue"]);
    if (fetchErr) {
      showToast(fetchErr.message, "error");
      return;
    }
    if (pendingCycles && pendingCycles.length > 0) {
      const waivedAt = new Date().toISOString();
      const overdueCycleIds = pendingCycles
        .filter((c) => c.status === "overdue")
        .map((c) => c.id);
      const pendingCycleIds = pendingCycles
        .filter((c) => c.status === "pending")
        .map((c) => c.id);
      if (overdueCycleIds.length > 0) {
        const { error: e1 } = await supabase
          .from("payment_cycles")
          .update({ status: "waived", waived_from_status: "overdue", waived_at: waivedAt })
          .in("id", overdueCycleIds)
          .eq("tutor_id", user.id);
        if (e1) { showToast(e1.message, "error"); return; }
      }
      if (pendingCycleIds.length > 0) {
        const { error: e2 } = await supabase
          .from("payment_cycles")
          .update({ status: "waived", waived_from_status: "pending", waived_at: waivedAt })
          .in("id", pendingCycleIds)
          .eq("tutor_id", user.id);
        if (e2) { showToast(e2.message, "error"); return; }
      }
    }
    await loadAll();
    showToast("Written off.");
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
    if (!(await confirmClosedMonthChange({ tutorId: user.id, kind: "lesson", dateKeys: lessonToggleDates(lesson, true) }))) return;
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

  const dismissGrandfatheredBanner = () => {
    try { localStorage.setItem("chope_grandfathered_banner_dismissed", "1"); } catch { /* storage unavailable */ }
    setGrandfatheredBannerDismissed(true);
  };

  const GrandfatheredBanner = !isPractitioner && subscriptionStatus === "grandfathered" && !grandfatheredBannerDismissed && (
    <div className="relative rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <button
        type="button"
        onClick={dismissGrandfatheredBanner}
        aria-label="Dismiss"
        className="absolute right-3 top-3 text-emerald-500 hover:text-emerald-700 text-lg leading-none"
      >
        ×
      </button>
      <p className="pr-6 text-sm text-emerald-900">
        🎉 <span className="font-semibold">Thank you for being an early ChopeAndPay user!</span> As a thank-you, your account stays free — you won&rsquo;t be charged, ever. New subscription options are for new sign-ups only.
      </p>
    </div>
  );

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
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-20 text-center shadow-sm">
          <svg className="mb-4 h-14 w-14 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5zm0 0v6m-4-3.5l4 2 4-2" />
          </svg>
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
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-gray-900">Subscribe to ChopeAndPay</p>
            <p className="mt-1 text-sm text-gray-500">
              Keep tracking lessons, payments, and students with a simple subscription.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => handleSubscribe("monthly")}
                disabled={checkoutLoading !== null}
                className="flex min-h-10 items-center gap-2 rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-60"
              >
                {checkoutLoading === "monthly" && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {checkoutLoading === "monthly" ? "Redirecting…" : "SGD 9.99 / month"}
              </button>
              <button
                onClick={() => handleSubscribe("annual")}
                disabled={checkoutLoading !== null}
                className="flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                {checkoutLoading === "annual" && (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {checkoutLoading === "annual" ? "Redirecting…" : "SGD 59.99 / year · save 50%"}
              </button>
            </div>
          </div>
        )}

        {GrandfatheredBanner}
      </AppShell>
    );
  }

  return (
    <AppShell>
      <NotificationPrompt />

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        {/* ── LEFT PANEL — Today & upcoming (60%) ── */}
        <div className="min-w-0 flex-1 space-y-6 md:flex-[3]">
          {/* Subscription status — shown when active so tutor knows their plan */}
          {!loading && subscriptionStatus === "past_due" && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
              <p className="text-sm font-semibold text-red-800">Payment past due</p>
              <p className="mt-1 text-sm text-red-700">
                Please update your payment method to keep your subscription active.
              </p>
            </div>
          )}

          {/* Today's lessons */}
          <section className="rounded-xl border-2 border-[#5ecfaa] bg-gradient-to-b from-[#effaf6] to-white p-5 shadow-md ring-4 ring-[#5ecfaa]/15">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-bold text-[#1b2d4f]">
                <span className="rounded-md bg-[#1b2d4f] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[#5ecfaa]">
                  Today
                </span>
                {terms.lessons}
              </h2>
              {!loading && todayLessons.length > 0 && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    todayLessons.every((l) => l.is_completed)
                      ? "bg-[#d1fae5] text-[#065f46]"
                      : "bg-white text-[#1b2d4f] ring-1 ring-[#5ecfaa]"
                  }`}
                >
                  {todayLessons.every((l) => l.is_completed)
                    ? "All done ✓"
                    : `${todayLessons.filter((l) => l.is_completed).length} of ${todayLessons.length} done`}
                </span>
              )}
            </div>
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
                            {isPracticeLesson(l) && <PracticeBadge className="ml-2" />}
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
                          {topicTrackedStudentIds.has(l.student_id) && (
                            <button
                              onClick={() => setTopicsLesson(l)}
                              className="min-h-9 rounded-md border border-[#5ecfaa] px-2.5 text-xs font-medium text-[#0f7a58] hover:bg-white"
                            >
                              Topics
                            </button>
                          )}
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
                        {isPracticeLesson(l) && <PracticeBadge className="ml-2" />}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatDate(l.lesson_date)}
                        {l.lesson_time && ` · ${formatLessonTime(l.lesson_time)}`}
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

          {!isPractitioner && <AnnouncementBanner />}

          {/* Month-end close nudge: 1st-10th (Singapore time), last month has activity and is not closed */}
          {!isPractitioner && !loading && closedMonths && (() => {
            const today = sgtTodayKey();
            let flag = false;
            try { flag = new URLSearchParams(window.location.search).get("showCloseNudge") === "1"; } catch { /* no window */ }
            if (!flag && Number(today.slice(8)) > 10) return null;
            const last = shiftMonth(today.slice(0, 7), -1);
            if (closedMonths.get(last)?.status === "closed") return null;
            const key = `cnp_close_nudge_dismissed_${last}`;
            let stored = false;
            try { stored = localStorage.getItem(key) === "1"; } catch { /* storage unavailable */ }
            if (stored || nudgeDismissed[last]) return null;
            const active = activityMonths({ students: moneyRecapStudents, lessons: moneyRecapLessons, cycles: moneyRecapCycles });
            if (!active.has(last)) return null;
            return (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 pr-3 text-sm text-[#1b2d4f] shadow-sm">
                <p className="min-w-0 flex-1 font-medium">
                  {monthName(last)}'s done. Close the month — takes 2 minutes.
                </p>
                <Link
                  to={`/month-close?month=${last}`}
                  className="min-h-11 rounded-md bg-[#0f7a58] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#0c6a4c]"
                >
                  Close {monthName(last)}
                </Link>
                <button
                  onClick={() => {
                    try { localStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
                    setNudgeDismissed((d) => ({ ...d, [last]: true }));
                  }}
                  aria-label="Dismiss"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#0f7a58] hover:bg-[#d6ede6]"
                >
                  ✕
                </button>
              </div>
            );
          })()}

          {/* Subscription upsell — shown only when there is no active/trialing subscription */}
          {!loading && !isPractitioner && !["active", "trialing", "grandfathered"].includes(subscriptionStatus) && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-gray-900">
                Subscribe to ChopeAndPay
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Keep tracking lessons, payments, and students with a simple subscription.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  onClick={() => handleSubscribe("monthly")}
                  disabled={checkoutLoading !== null}
                  className="flex min-h-10 items-center gap-2 rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-60"
                >
                  {checkoutLoading === "monthly" && (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  )}
                  {checkoutLoading === "monthly" ? "Redirecting…" : "SGD 9.99 / month"}
                </button>
                <button
                  onClick={() => handleSubscribe("annual")}
                  disabled={checkoutLoading !== null}
                  className="flex min-h-10 items-center gap-2 rounded-md border border-gray-300 px-5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
                >
                  {checkoutLoading === "annual" && (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                  )}
                  {checkoutLoading === "annual" ? "Redirecting…" : "SGD 59.99 / year · save 50%"}
                </button>
              </div>
            </div>
          )}

          {!loading && GrandfatheredBanner}

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

          {/* Monthly recap — mobile only (desktop version lives in right panel) */}
          <div className="md:hidden">
            <MonthlyRecapCard
              lessons={moneyRecapLessons}
              paymentCycles={moneyRecapCycles}
              students={moneyRecapStudents}
              scheduledLessons={moneyScheduledLessons}
              tutorName={user?.user_metadata?.full_name}
              currentMonthPendingOverride={allPendingAmount}
              onPendingTap={handlePendingTap}
              closedMonths={closedMonths}
            />
          </div>

          {/* Overdue notices (practitioners only; tutors see overdue flags in "Needs your attention") */}
          {isPractitioner && !loading && overdueStudents.length > 0 && (
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
                        <div className="flex flex-wrap gap-2">
                          {!isPractitioner && (
                            <button
                              onClick={() => handleRemind(s, status.collectCycle)}
                              disabled={remindingStudentId === s.id}
                              className="min-h-11 rounded-md bg-orange-500 px-3 text-xs font-medium text-white transition hover:bg-orange-600 hover:shadow disabled:opacity-60"
                            >
                              {remindingStudentId === s.id ? "Preparing…" : "💬 Remind"}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              handleCollectPayment(status.collectCycle.id)
                            }
                            className="min-h-11 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                          >
                            Mark as paid
                          </button>
                        </div>
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
                        {isPracticeLesson(l) && <PracticeBadge className="ml-2" />}
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

          {/* Needs your attention: every unpaid cycle once; overdue ones flagged. Full history lives on the Payments page. */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Needs your attention
                </h2>
                {!loading && unpaidCycles.length > 0 && (
                  <p className="mt-0.5 text-sm text-gray-500">
                    {unpaidCycles.length} unpaid ·{" "}
                    <span className="font-semibold text-amber-700">
                      {formatSGD(unpaidTotal)}
                    </span>
                  </p>
                )}
              </div>
              <Link
                to="/payments"
                className="flex-none whitespace-nowrap text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                View all payments →
              </Link>
            </div>
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : unpaidCycles.length === 0 ? (
              <p className="text-sm text-gray-500">
                ✅ All paid up — nothing to collect.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {unpaidCycles.map((c) => {
                  const student = students.find((st) => st.id === c.student_id);
                  const overdueReason = overdueReasonByCycleId.get(c.id);
                  const isOverdue = overdueReasonByCycleId.has(c.id);
                  return (
                    <li
                      key={c.id}
                      className={`flex flex-col gap-2 rounded-lg px-2 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
                        isOverdue ? "bg-red-50/60 hover:bg-red-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          {student ? (
                            <Link
                              to={`/students/${student.id}`}
                              className="text-sm font-medium text-gray-900 hover:text-[#1b2d4f]"
                            >
                              {c.students?.name}
                            </Link>
                          ) : (
                            <span className="text-sm font-medium text-gray-900">
                              {c.students?.name}
                            </span>
                          )}
                          <span className="text-sm font-semibold text-gray-900">
                            {formatSGD(c.amount_due)}
                          </span>
                          {isOverdue ? (
                            <span
                              className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE_CLASSES.red}`}
                            >
                              🔴 Overdue
                            </span>
                          ) : (
                            <StatusBadge status={c.status} />
                          )}
                        </div>
                        {isOverdue && overdueReason && (
                          <p className="mt-0.5 text-xs text-red-700">
                            {overdueReason}
                          </p>
                        )}
                      </div>
                      {!isPractitioner && student && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => handleRemind(student, c)}
                            disabled={remindingStudentId === student.id}
                            className="min-h-11 rounded-md bg-orange-500 px-3 text-xs font-medium text-white transition hover:bg-orange-600 hover:shadow disabled:opacity-60"
                          >
                            {remindingStudentId === student.id
                              ? "Preparing…"
                              : "💬 Remind"}
                          </button>
                          <button
                            onClick={() => handleCollectPayment(c.id)}
                            className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                          >
                            Mark as paid
                          </button>
                          <button
                            onClick={() => handleWaiveCycle(c.id, c.status)}
                            className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
                          >
                            Write off
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!loading && !isPractitioner && stalledItems.length > visibleStalledItems.length && (
              <div className={unpaidCycles.length > 0 || visibleStalledItems.length > 0 ? "mt-3 border-t border-gray-100 pt-2" : "mt-1"}>
                <button
                  onClick={() => {
                    setStalledDismissed({});
                    try { localStorage.removeItem("chopeandpay_stalled_dismissed"); } catch {}
                  }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted underline-offset-2"
                >
                  Show {stalledItems.length - visibleStalledItems.length} dismissed
                </button>
              </div>
            )}
            {!loading && !isPractitioner && visibleStalledItems.length > 0 && (
              <div className={unpaidCycles.length > 0 ? "mt-3 border-t border-gray-100 pt-3" : ""}>
                {visibleStalledItems.map((item) => (
                  <div
                    key={item.student.id}
                    className="flex flex-col gap-2 rounded-lg px-2 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-medium text-gray-900">
                          {item.student.name}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">
                          {formatSGD(item.amount)}
                        </span>
                        <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          Not yet billed
                        </span>
                        {item.student.archived && (
                          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                            Archived
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {item.count}{" "}
                        {item.count === 1 ? "lesson" : "lessons"} unbilled ·
                        last lesson {formatDate(item.lastLesson)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handleBillNowStalled(item.student)}
                        className="min-h-11 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                      >
                        Bill now
                      </button>
                      <button
                        onClick={() => handleWriteOffStalled(item.student)}
                        className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
                      >
                        Write off
                      </button>
                      <button
                        onClick={() => handleDismissStalled(item.student.id)}
                        className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-400 transition hover:bg-gray-100"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ── RIGHT PANEL — Money (40%) ── */}
        <div className="space-y-6 md:flex-none md:w-[40%] md:self-start">
          {/* Booking requests alert */}
          {!loading && pendingBookingCount > 0 && (
            <Link
              to="/booking-requests"
              className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm hover:bg-amber-100 transition"
            >
              <div>
                <p className="text-sm font-semibold text-amber-900">
                  📬 {pendingBookingCount} pending booking {pendingBookingCount === 1 ? "request" : "requests"}
                </p>
                <p className="text-xs text-amber-700">Tap to confirm or decline</p>
              </div>
              <span className="text-amber-500">→</span>
            </Link>
          )}

          {/* Monthly recap — desktop only (mobile version is in left panel) */}
          <div className="hidden md:block">
            <MonthlyRecapCard
              lessons={moneyRecapLessons}
              paymentCycles={moneyRecapCycles}
              students={moneyRecapStudents}
              scheduledLessons={moneyScheduledLessons}
              tutorName={user?.user_metadata?.full_name}
              currentMonthPendingOverride={allPendingAmount}
              onPendingTap={handlePendingTap}
              closedMonths={closedMonths}
            />
          </div>

          {/* Student payment progress */}
          <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">
                {terms.student} payment progress
              </h2>
              <Link
                to="/students"
                className="flex-none whitespace-nowrap text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                Manage →
              </Link>
            </div>
            {!loading && moneyStudents.length > 0 && (
              <p className="mb-3 text-sm">
                <span className="font-medium text-gray-700">
                  {moneyStudents.length}{" "}
                  {(moneyStudents.length === 1
                    ? terms.student
                    : terms.students
                  ).toLowerCase()}
                </span>{" "}
                ·{" "}
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
            ) : moneyStudents.length === 0 ? (
              <p className="text-sm text-gray-500">
                {students.length === 0
                  ? `No ${terms.students.toLowerCase()} yet.`
                  : `No ${terms.students.toLowerCase()} to track payments for yet.`}
              </p>
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
                              Mark as paid
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

        </div>
      </div>

      {preview && (
        <MessagePreviewModal
          title={preview.title}
          initialMessage={preview.message}
          mode={preview.mode}
          phone={preview.phone}
          onClose={() => setPreview(null)}
        />
      )}

      {topicsLesson && (
        <LessonTopicsModal
          key={topicsLesson.id}
          lesson={topicsLesson}
          onClose={() => setTopicsLesson(null)}
        />
      )}

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

      {pendingBreakdownState && (
        <PendingBreakdownModal
          monthDate={pendingBreakdownState.monthDate}
          isCurrentMonth={pendingBreakdownState.isCurrentMonth}
          rows={pendingBreakdownRows}
          onClose={() => setPendingBreakdownState(null)}
          onMarkPaid={async (cycleId) => {
            await handleCollectPayment(cycleId);
          }}
          onWriteOff={async (cycleId, status) => {
            await handleWaiveCycle(cycleId, status);
          }}
          onBillNow={handleBillNowMidCycle}
          onRemind={handleRemind}
          remindingStudentId={remindingStudentId}
          isPractitioner={isPractitioner}
        />
      )}
    </AppShell>
  );
}
