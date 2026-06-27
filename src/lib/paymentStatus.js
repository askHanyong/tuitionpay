import { formatSGD } from "./paymentNotice";
import { formatDate, formatMonth } from "../utils/dateFormat";
import { ordinal, lessonAmount as amountForLesson } from "./paymentMode";

const TIER_RANK = { red: 0, amber: 1, blue: 2, grey: 2, green: 3 };

export const TIER_BADGE_CLASSES = {
  red: "bg-red-100 text-red-800",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-800",
  grey: "bg-gray-100 text-gray-600",
  green: "bg-green-100 text-green-800",
};

export const TIER_BAR_CLASSES = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  grey: "bg-gray-300",
  green: "bg-green-500",
};

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysUntil(target, now) {
  return Math.round(
    (startOfDay(target) - startOfDay(now)) / (1000 * 60 * 60 * 24),
  );
}

function isSameMonth(dateStr, ref) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  return (
    d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth()
  );
}

function lastDayOfMonth(year, month0) {
  return new Date(year, month0 + 1, 0);
}

function customDueDateFor(year, month0, customDay) {
  const lastDay = lastDayOfMonth(year, month0).getDate();
  return new Date(year, month0, Math.min(customDay ?? 1, lastDay));
}

function isPrevCalendarMonth(dateStr, now) {
  if (!dateStr) return false;
  const d = new Date(`${dateStr}T00:00:00`);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return (
    d.getFullYear() === prevMonth.getFullYear() &&
    d.getMonth() === prevMonth.getMonth()
  );
}

function sortByDueAsc(cycles) {
  return [...cycles].sort((a, b) =>
    a.period_end < b.period_end ? -1 : a.period_end > b.period_end ? 1 : 0,
  );
}

function sortByDueDesc(cycles) {
  return [...cycles].sort((a, b) =>
    a.period_end > b.period_end ? -1 : a.period_end < b.period_end ? 1 : 0,
  );
}

function sortLessonsByWhen(lessons) {
  return [...lessons].sort((a, b) => {
    if (a.lesson_date !== b.lesson_date) {
      return a.lesson_date < b.lesson_date ? -1 : 1;
    }
    const at = a.lesson_time ?? "";
    const bt = b.lesson_time ?? "";
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

export function computeStudentPaymentStatus(student, ctx) {
  const {
    pendingCycles,
    paidCycles,
    completedLessons,
    scheduledLessons,
    openCount,
    now,
  } = ctx;
  const mode = student.payment_mode ?? "lessons";

  if (mode === "per_lesson") {
    const pending = sortByDueAsc(pendingCycles);
    const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
    if (pending.length === 1) {
      return {
        tier: "red",
        amountDue,
        label: `🔴 ${formatSGD(amountDue)} due — last lesson unpaid`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: pending[0],
      };
    }
    if (pending.length > 1) {
      return {
        tier: "red",
        amountDue,
        label: `🔴 ${formatSGD(amountDue)} due — ${pending.length} lessons unpaid`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: pending[0],
      };
    }
    return {
      tier: completedLessons.length > 0 ? "green" : "grey",
      amountDue: 0,
      label: completedLessons.length > 0 ? "✅ Up to date" : "No lessons yet",
      showProgressBar: false,
      progressFraction: null,
      collectCycle: null,
    };
  }

  if (mode === "monthly") {
    const pending = sortByDueAsc(pendingCycles);
    const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
    if (pending.length > 0) {
      const monthLabel = formatMonth(pending[0].period_start);
      const label =
        pending.length === 1
          ? `🔴 ${monthLabel} payment due — ${formatSGD(amountDue)}`
          : `🔴 ${pending.length} months payment due — ${formatSGD(amountDue)}`;
      return {
        tier: "red",
        amountDue,
        label,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: pending[0],
      };
    }

    const thisMonthLessons = completedLessons.filter((l) =>
      isSameMonth(l.lesson_date, now),
    );
    const thisMonthCount = thisMonthLessons.length;
    const thisMonthAmount = thisMonthLessons.reduce(
      (sum, l) => sum + amountForLesson(l, student),
      0,
    );
    const thisMonthLabel = formatMonth(now);
    const dueDate = lastDayOfMonth(now.getFullYear(), now.getMonth());
    const dueIn = daysUntil(dueDate, now);

    const recentPaid = sortByDueDesc(paidCycles)[0];
    // Only show the "accumulating" green state if we're not yet in the
    // due-soon window -- once dueIn drops to 3 days or fewer, the amber
    // "payment due soon" check below should take over even if last month
    // was already paid.
    if (
      recentPaid &&
      isPrevCalendarMonth(recentPaid.period_end, now) &&
      !(dueIn >= 0 && dueIn <= 3)
    ) {
      const prevMonthLabel = formatMonth(recentPaid.period_end);
      return {
        tier: "green",
        amountDue: 0,
        label:
          thisMonthCount > 0
            ? `✅ ${prevMonthLabel} paid · ${thisMonthLabel} accumulating`
            : `✅ ${prevMonthLabel} paid`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    if (dueIn >= 0 && dueIn <= 3) {
      return {
        tier: "amber",
        amountDue: thisMonthAmount,
        label: `⚠️ ${thisMonthLabel} payment due in ${dueIn} day${dueIn === 1 ? "" : "s"} · ${formatSGD(thisMonthAmount)} accumulating`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    return {
      tier: "blue",
      amountDue: thisMonthAmount,
      label: `📅 ${thisMonthLabel}: ${thisMonthCount} lesson${thisMonthCount === 1 ? "" : "s"} · ${formatSGD(thisMonthAmount)} accumulating`,
      showProgressBar: false,
      progressFraction: null,
      collectCycle: null,
    };
  }

  if (mode === "custom_date") {
    const pending = sortByDueAsc(pendingCycles);
    const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
    if (pending.length > 0) {
      return {
        tier: "red",
        amountDue,
        label: `🔴 Payment overdue since ${formatDate(pending[0].period_end)} — ${formatSGD(amountDue)}`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: pending[0],
      };
    }

    const customDay = student.payment_custom_day ?? 1;
    const candidateThisMonth = customDueDateFor(
      now.getFullYear(),
      now.getMonth(),
      customDay,
    );
    const nextDue =
      startOfDay(candidateThisMonth) >= startOfDay(now)
        ? candidateThisMonth
        : customDueDateFor(now.getFullYear(), now.getMonth() + 1, customDay);
    const dueIn = daysUntil(nextDue, now);

    const thisMonthLessons = completedLessons.filter((l) =>
      isSameMonth(l.lesson_date, now),
    );
    const thisMonthCount = thisMonthLessons.length;
    const thisMonthAmount = thisMonthLessons.reduce(
      (sum, l) => sum + amountForLesson(l, student),
      0,
    );

    const recentPaid = sortByDueDesc(paidCycles)[0];
    if (recentPaid && thisMonthCount === 0) {
      return {
        tier: "green",
        amountDue: 0,
        label: `✅ Paid on ${formatDate(recentPaid.paid_at ?? recentPaid.period_end)}`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    if (dueIn <= 3) {
      return {
        tier: "amber",
        amountDue: thisMonthAmount,
        label: `⚠️ Payment due in ${dueIn} day${dueIn === 1 ? "" : "s"} · ${formatSGD(thisMonthAmount)} accumulating`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    return {
      tier: "blue",
      amountDue: thisMonthAmount,
      label: `📅 Payment due in ${dueIn} days · ${formatSGD(thisMonthAmount)} accumulating`,
      showProgressBar: false,
      progressFraction: null,
      collectCycle: null,
    };
  }

  // "lessons" mode (every N lessons) — default
  const cycleCount = student.payment_cycle_count ?? 4;
  const openLessons = sortLessonsByWhen(
    completedLessons.filter((l) => !l.payment_cycle_id),
  ).slice(-cycleCount);
  const cycleAmount = openLessons.reduce(
    (sum, l) => sum + amountForLesson(l, student),
    0,
  );
  const pending = sortByDueAsc(pendingCycles);
  const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
  const progressFraction = Math.min(openCount, cycleCount) / cycleCount;

  const scheduledNeeded = Math.max(cycleCount - openCount, 0);
  const upcoming = sortLessonsByWhen(scheduledLessons ?? []);
  const scheduledInCycle = upcoming.slice(0, scheduledNeeded);
  const scheduledCount = scheduledInCycle.length;
  const fourthLessonDate =
    scheduledCount === scheduledNeeded && scheduledNeeded > 0
      ? scheduledInCycle[scheduledCount - 1].lesson_date
      : null;

  if (pending.length > 0) {
    const completedDate = pending[0].period_end;
    return {
      tier: "red",
      amountDue,
      cycleAmount,
      label: `🔴 ${cycleCount} lessons completed on ${formatDate(completedDate)} · Payment due now — ${formatSGD(amountDue)}`,
      showProgressBar: true,
      progressFraction: 1,
      collectCycle: pending[0],
      completedCount: cycleCount,
      scheduledCount: 0,
      nextPaymentInfo: {
        text: `💰 Payment due — ${formatSGD(amountDue)} · ${ordinal(cycleCount)} lesson was on ${formatDate(completedDate)}`,
        tone: "red",
      },
    };
  }

  const nextPaymentInfo = fourthLessonDate
    ? {
        text: `📅 Next payment due after lesson on ${formatDate(fourthLessonDate)}`,
        tone: "blue",
      }
    : scheduledCount === 0
      ? { text: "📅 No upcoming lessons scheduled", tone: "blue" }
      : {
          text: `📅 ${scheduledCount} of ${scheduledNeeded} more lesson${scheduledNeeded === 1 ? "" : "s"} scheduled`,
          tone: "blue",
        };

  if (openCount === 0) {
    const hasPaidBefore = paidCycles.length > 0;
    const label = hasPaidBefore
      ? "✅ Paid"
      : scheduledCount > 0
        ? `0/${cycleCount} lessons · ${scheduledCount} scheduled`
        : `0/${cycleCount} lessons`;
    return {
      tier: hasPaidBefore ? "green" : "grey",
      amountDue: 0,
      cycleAmount,
      label,
      showProgressBar: true,
      progressFraction: 0,
      collectCycle: null,
      completedCount: 0,
      scheduledCount,
      nextPaymentInfo,
    };
  }

  const tier =
    openCount === cycleCount - 1
      ? "amber"
      : openCount >= cycleCount / 2
        ? "blue"
        : "grey";

  const label = fourthLessonDate
    ? `${openCount} lesson${openCount === 1 ? "" : "s"} done · Payment due after lesson ${cycleCount} on ${formatDate(fourthLessonDate)}`
    : `${openCount}/${cycleCount} lessons · ${formatSGD(cycleAmount)} due at completion`;

  return {
    tier,
    amountDue: cycleAmount,
    cycleAmount,
    label,
    showProgressBar: true,
    progressFraction,
    collectCycle: null,
    completedCount: openCount,
    scheduledCount,
    nextPaymentInfo,
  };
}

export function tierRank(tier) {
  return TIER_RANK[tier] ?? 4;
}
