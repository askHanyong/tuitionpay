// Today briefing (spec: today-briefing-and-reminders 3.1, 4.1, 6.7-6.9).
// Pure functions: no Supabase calls, no clock reads (callers pass `now`).
import { formatSGD } from "./paymentNotice";
import { monthName, shiftMonth } from "./monthClose";
import { sgtDateKey, sgtHour } from "../utils/sgt";

// Month-end close is built: the prompts link to its page.
export const MONTH_END_CLOSE_ROUTE = "/month-close";

const plural = (n, one, many) => (n === 1 ? one : many);

// "Monday 16 November" in Singapore time.
export function formatBriefingDate(now) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export function greetingFor(now, firstName) {
  const h = sgtHour(now);
  const word = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${word}, ${firstName}` : word;
}

export const firstNameOf = (...names) => {
  for (const n of names) {
    const w = String(n ?? "").trim().split(/\s+/)[0];
    if (w) return w;
  }
  return "";
};

// 6.7. Last 3 days of a month: "{Month} ends in {n} days · {k} notices still open".
// Days 1-5: "{Previous month} is ready to close" unless that month is closed (or had
// no activity: previousMonthHasActivity === false). isMonthClosed(monthStr) -> bool.
// Returns { text, to } or null.
export function getMonthEndPrompt({
  todayKey,
  openNoticeCount = 0,
  isMonthClosed,
  previousMonthHasActivity = true,
}) {
  const [y, m, d] = todayKey.split("-").map(Number);
  const monthStr = todayKey.slice(0, 7);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysLeft = lastDay - d;
  if (daysLeft <= 2) {
    const when = daysLeft === 0 ? "ends today" : `ends in ${daysLeft} ${plural(daysLeft, "day", "days")}`;
    const k = openNoticeCount;
    const tail = k > 0 ? ` · ${k} ${plural(k, "notice", "notices")} still open` : "";
    return {
      text: `${monthName(monthStr)} ${when}${tail}`,
      to: `${MONTH_END_CLOSE_ROUTE}?month=${monthStr}`,
    };
  }
  if (d <= 5) {
    const prev = shiftMonth(monthStr, -1);
    if (isMonthClosed?.(prev) || !previousMonthHasActivity) return null;
    return { text: `${monthName(prev)} is ready to close`, to: `${MONTH_END_CLOSE_ROUTE}?month=${prev}` };
  }
  return null;
}

function expiresIn(expiresAt, now) {
  const mins = Math.max(0, Math.round((new Date(expiresAt) - now) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

// Inputs are already free of practice students. todayLessons: [{ lesson_time,
// is_completed }]; owedRows: from buildOwedRows; formatTime: (hhmmss) => "3:30pm".
// Returns { dateLabel, greeting, sentence, items[], allClear }.
// Item: { key, icon, text, sub?, action? | to? } - action is a string the
// Dashboard maps to a scroll or modal; `to` is a route.
export function buildBriefing({
  now,
  firstName,
  todayLessons = [],
  overdueLessons = [],
  owedRows = [],
  stalledCount = 0,
  bookingCount = 0,
  bookingExpiresAt = null,
  monthEndPrompt = null,
  terms = { lesson: "Lesson", lessons: "Lessons" },
  formatTime = (t) => t,
}) {
  const lesson = terms.lesson.toLowerCase();
  const lessons = terms.lessons.toLowerCase();
  const word = (n) => (n === 1 ? lesson : lessons);

  const n = todayLessons.length;
  const done = todayLessons.filter((l) => l.is_completed).length;
  const next = todayLessons
    .filter((l) => !l.is_completed)
    .sort((a, b) => String(a.lesson_time ?? "").localeCompare(String(b.lesson_time ?? "")))[0];

  const cycleRows = owedRows.filter((r) => r.type === "cycle");
  const tutorRows = cycleRows.filter((r) => r.collector === "tutor");
  const owedToTutor = tutorRows.reduce((s, r) => s + r.amount, 0);
  const families = new Set(tutorRows.map((r) => r.studentId));
  const archivedFamilies = new Set(tutorRows.filter((r) => r.archived || r.deleted).map((r) => r.studentId));
  const owedViaAgency = cycleRows.filter((r) => r.collector === "agency").reduce((s, r) => s + r.amount, 0);
  const notYetBilled = owedRows.filter((r) => r.type === "mid_cycle").reduce((s, r) => s + r.amount, 0);
  const overdueCount = new Set(tutorRows.filter((r) => r.cycleStatus === "overdue").map((r) => r.studentId)).size;

  const f = families.size;
  const owedText = `${f} ${plural(f, "family", "families")} ${plural(f, "owes", "owe")} you ${formatSGD(owedToTutor)}`;
  const owedRowText = archivedFamilies.size > 0 ? `${owedText} (incl. ${archivedFamilies.size} archived)` : owedText;

  // ── Summary sentence: first three parts that apply (4.1) ──
  const parts = [];
  if (n === 0) parts.push(`No ${lessons} today.`);
  else if (done === n) parts.push(`All ${n} ${lessons} done today.`);
  else parts.push(`${n} ${word(n)} today${next?.lesson_time ? `, first at ${formatTime(next.lesson_time)}` : ""}.`);
  if (f > 0) parts.push(`${owedText}.`);
  if (bookingCount > 0) parts.push(`${bookingCount} booking ${plural(bookingCount, "request is", "requests are")} waiting.`);
  if (overdueLessons.length > 0) {
    const k = overdueLessons.length;
    parts.push(`${k} ${word(k)} ${plural(k, "needs", "need")} a status update.`);
  }
  if (monthEndPrompt) parts.push(`${monthEndPrompt.text}.`);
  const allClear = n === 0 && parts.length === 1;
  const sentence = allClear
    ? "All clear today. No lessons and nothing to chase. Enjoy your day!"
    : parts.slice(0, 3).join(" ");

  // ── Rows (zero rows are not rendered) ──
  const items = [];
  if (n > 0) {
    items.push({
      key: "lessons", icon: "📚", action: "scroll-today",
      text: `${n} ${word(n)} today${done > 0 ? ` · ${done} done` : ""}`,
    });
  }
  if (overdueLessons.length > 0) {
    const k = overdueLessons.length;
    items.push({
      key: "status", icon: "📝", action: "scroll-status",
      text: `${k} ${word(k)} ${plural(k, "needs", "need")} a status update`,
    });
  }
  if (f > 0) {
    items.push({
      key: "owed", icon: "💰", action: "owed", text: owedRowText,
      sub: overdueCount > 0 ? `${overdueCount} overdue` : null,
    });
  }
  if (owedViaAgency > 0) {
    items.push({
      key: "agency", icon: "🏢", action: "owed",
      text: `${formatSGD(owedViaAgency)} is being collected by agencies`,
    });
  }
  if (notYetBilled > 0 || stalledCount > 0) {
    const stalled = stalledCount > 0 ? `${stalledCount} stalled` : null;
    items.push({
      key: "unbilled", icon: "🧾", action: "scroll-attention",
      text: notYetBilled > 0
        ? `${formatSGD(notYetBilled)} not yet billed${stalled ? ` (${stalled})` : ""}`
        : stalled,
    });
  }
  if (bookingCount > 0) {
    items.push({
      key: "booking", icon: "📬", to: "/booking-requests",
      text: `${bookingCount} booking ${plural(bookingCount, "request", "requests")} waiting${
        bookingExpiresAt ? ` · expires in ${expiresIn(bookingExpiresAt, now)}` : ""
      }`,
    });
  }
  if (monthEndPrompt) {
    items.push({ key: "monthend", icon: "🗓️", to: monthEndPrompt.to, text: monthEndPrompt.text });
  }

  return {
    dateLabel: formatBriefingDate(now),
    greeting: greetingFor(now, firstName),
    sentence,
    items,
    allClear,
    todayKey: sgtDateKey(now),
  };
}
