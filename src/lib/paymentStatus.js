import { formatSGD } from "./paymentNotice";
import {
  formatDate,
  formatMonthName,
  formatDayMonth,
} from "../utils/dateFormat";
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
    if (pending.length > 0) {
      const earliest = pending[0];
      const lessonDateLabel = formatDayMonth(earliest.period_end);
      const daysSince = daysUntil(
        now,
        new Date(`${earliest.period_end}T00:00:00`),
      );
      const moreSuffix =
        pending.length > 1 ? ` (+${pending.length - 1} more)` : "";
      if (daysSince > 7) {
        return {
          tier: "red",
          badge: "🔴 Overdue",
          amountDue,
          label: `🔴 ${formatSGD(amountDue)} overdue — lesson on ${lessonDateLabel} unpaid${moreSuffix}`,
          showProgressBar: false,
          progressFraction: null,
          collectCycle: earliest,
        };
      }
      return {
        tier: "amber",
        badge: "⚠️ Payment due",
        amountDue,
        label: `⚠️ ${formatSGD(amountDue)} due — lesson on ${lessonDateLabel} unpaid${moreSuffix}`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: earliest,
      };
    }

    if (completedLessons.length > 0) {
      return {
        tier: "green",
        badge: "✅ Paid",
        amountDue: 0,
        label: "✅ Paid",
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    const nextLesson = sortLessonsByWhen(scheduledLessons ?? [])[0];
    return {
      tier: "grey",
      badge: null,
      amountDue: 0,
      label: nextLesson
        ? `Next lesson on ${formatDayMonth(nextLesson.lesson_date)}`
        : "No lessons yet",
      showProgressBar: false,
      progressFraction: null,
      collectCycle: null,
    };
  }

  if (mode === "monthly") {
    const pending = sortByDueAsc(pendingCycles);
    const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
    const monthLabel = formatMonthName(now);

    if (pending.length > 0) {
      const overdueMonthLabel = formatMonthName(pending[0].period_start);
      return {
        tier: "red",
        badge: "🔴 Overdue",
        amountDue,
        label: `🔴 ${formatSGD(amountDue)} overdue — ${overdueMonthLabel} unpaid`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: pending[0],
      };
    }

    const recentPaid = sortByDueDesc(paidCycles)[0];
    if (recentPaid && isSameMonth(recentPaid.period_end, now)) {
      return {
        tier: "green",
        badge: "✅ Paid",
        amountDue: 0,
        label: `✅ ${monthLabel} paid`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
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
    const scheduledThisMonth = (scheduledLessons ?? []).filter((l) =>
      isSameMonth(l.lesson_date, now),
    );
    const scheduledCount = scheduledThisMonth.length;
    const scheduledAmount = scheduledThisMonth.reduce(
      (sum, l) => sum + amountForLesson(l, student),
      0,
    );

    const dueDate = lastDayOfMonth(now.getFullYear(), now.getMonth());
    const dueIn = daysUntil(dueDate, now);
    const dueDateLabel = formatDayMonth(dueDate);

    if (dueIn > 3) {
      const total = thisMonthAmount + scheduledAmount;
      return {
        tier: "blue",
        badge: "Accumulating",
        amountDue: total,
        label: `${thisMonthCount} done · ${scheduledCount} upcoming · ${formatSGD(total)} expected end of ${monthLabel}`,
        showProgressBar: false,
        progressFraction: null,
        collectCycle: null,
      };
    }

    let label = `⚠️ ${formatSGD(thisMonthAmount)} due ${dueDateLabel}`;
    if (scheduledAmount > 0) {
      label += ` · +${formatSGD(scheduledAmount)} on ${dueDateLabel}`;
    }
    return {
      tier: "amber",
      badge: "⚠️ Due soon",
      amountDue: thisMonthAmount,
      label,
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
    // Once a completed-but-unpaid cycle's lessons are billed (payment_cycle_id
    // assigned), openCount tracks the *next* cycle. If it's already > 0, a
    // new cycle has started while the previous one still sits unpaid.
    if (openCount > 0) {
      return {
        tier: "red",
        badge: "🔴 Overdue",
        amountDue,
        cycleAmount,
        label: `🔴 ${formatSGD(amountDue)} overdue`,
        showProgressBar: false,
        progressFraction: 1,
        collectCycle: pending[0],
        completedCount: cycleCount,
        scheduledCount: 0,
        nextPaymentInfo: {
          text: `💰 Payment overdue — ${formatSGD(amountDue)} · ${ordinal(cycleCount)} lesson was on ${formatDate(completedDate)}`,
          tone: "red",
        },
      };
    }
    return {
      tier: "amber",
      badge: "⚠️ Payment due",
      amountDue,
      cycleAmount,
      label: `⚠️ ${formatSGD(amountDue)} due — ${cycleCount} lessons completed`,
      showProgressBar: false,
      progressFraction: 1,
      collectCycle: pending[0],
      completedCount: cycleCount,
      scheduledCount: 0,
      nextPaymentInfo: {
        text: `💰 Payment due — ${formatSGD(amountDue)} · ${ordinal(cycleCount)} lesson was on ${formatDate(completedDate)}`,
        tone: "amber",
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
      badge: hasPaidBefore ? "✅ Paid" : null,
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

  let label;
  let badge;
  if (fourthLessonDate) {
    if (isSameMonth(fourthLessonDate, now)) {
      label = `${openCount}/${cycleCount} lessons done · Payment due after lesson ${cycleCount} on ${formatDayMonth(fourthLessonDate)}`;
      badge = "⚠️ Due soon";
    } else {
      label = `${openCount}/${cycleCount} lessons done · Payment due in ${formatMonthName(fourthLessonDate)}`;
      badge = "In progress";
    }
  } else {
    const nextLesson = sortLessonsByWhen(scheduledLessons ?? [])[0];
    label = nextLesson
      ? `${openCount}/${cycleCount} lessons done · Next lesson on ${formatDayMonth(nextLesson.lesson_date)}`
      : `${openCount}/${cycleCount} lessons done`;
    badge = "In progress";
  }

  return {
    tier,
    badge,
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
