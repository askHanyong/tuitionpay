import { formatSGD } from "./paymentNotice";
import { formatDate, formatMonth } from "../utils/dateFormat";

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

export function computeStudentPaymentStatus(student, ctx) {
  const { pendingCycles, paidCycles, completedLessons, openCount, now } = ctx;
  const rate = student.hourly_rate ?? 0;
  const duration = student.lesson_duration_hours ?? 0;
  const lessonAmount = rate * duration;
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

    const thisMonthCount = completedLessons.filter((l) =>
      isSameMonth(l.lesson_date, now),
    ).length;
    const thisMonthAmount = thisMonthCount * lessonAmount;
    const thisMonthLabel = formatMonth(now);
    const dueDate = lastDayOfMonth(now.getFullYear(), now.getMonth());
    const dueIn = daysUntil(dueDate, now);

    const recentPaid = sortByDueDesc(paidCycles)[0];
    if (recentPaid && isPrevCalendarMonth(recentPaid.period_end, now)) {
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

    const thisMonthCount = completedLessons.filter((l) =>
      isSameMonth(l.lesson_date, now),
    ).length;
    const thisMonthAmount = thisMonthCount * lessonAmount;

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
  const pending = sortByDueAsc(pendingCycles);
  const amountDue = pending.reduce((sum, c) => sum + Number(c.amount_due), 0);
  const progressFraction = Math.min(openCount, cycleCount) / cycleCount;

  if (pending.length > 0) {
    return {
      tier: "red",
      amountDue,
      label: "🔴 Payment due — collect now!",
      showProgressBar: true,
      progressFraction: 1,
      collectCycle: pending[0],
    };
  }

  if (openCount === 0) {
    const hasPaidBefore = paidCycles.length > 0;
    return {
      tier: hasPaidBefore ? "green" : "grey",
      amountDue: 0,
      label: hasPaidBefore ? "✅ Paid" : `0/${cycleCount} lessons`,
      showProgressBar: true,
      progressFraction: 0,
      collectCycle: null,
    };
  }

  if (openCount === cycleCount - 1) {
    return {
      tier: "amber",
      amountDue: openCount * lessonAmount,
      label: "⚠️ Next lesson triggers payment",
      showProgressBar: true,
      progressFraction,
      collectCycle: null,
    };
  }

  const tier = openCount >= cycleCount / 2 ? "blue" : "grey";
  return {
    tier,
    amountDue: openCount * lessonAmount,
    label: `${openCount}/${cycleCount} lessons · ${formatSGD(openCount * lessonAmount)} due at completion`,
    showProgressBar: true,
    progressFraction,
    collectCycle: null,
  };
}

export function tierRank(tier) {
  return TIER_RANK[tier] ?? 4;
}
