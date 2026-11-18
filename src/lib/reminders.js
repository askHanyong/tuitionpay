// Payment reminders (spec: today-briefing-and-reminders 4.4, 6.2-6.6).
// Templates, stage logic and the reminder log. Nothing here sends anything:
// the app only opens WhatsApp with the text filled in.
import { monthName } from "./monthClose";
import { sgtDateKey } from "../utils/sgt";

export const STAGES = ["first", "followup", "overdue"];
export const STAGE_LABELS = {
  first: "First request",
  followup: "Gentle follow-up",
  overdue: "Overdue",
};

export const DEFAULT_TEMPLATES = {
  first: `{greeting}, hope you're doing well! 😊
Here is the fee summary for {student}: {period}.
Amount: {amount}
PayNow: {paynow}
Details: {link}
Thank you!
— {tutor}`,
  followup: `{greeting}, just a gentle reminder on {student}'s fees for {period}: {amount}.
If it's already on the way, please ignore this. 🙏
PayNow: {paynow}
Details: {link}
Thank you!
— {tutor}`,
  overdue: `{greeting}, hope all is well. I'm following up on {student}'s fees for {period} ({amount}), outstanding since {due_date}.
Could you let me know when I can expect payment? If anything looks off, happy to go through the lessons together.
PayNow: {paynow}
Details: {link}
Thank you for your understanding.
— {tutor}`,
};

const KNOWN = ["greeting", "student", "period", "amount", "due_date", "paynow", "link", "tutor"];

// A line containing a known placeholder whose value is empty is dropped entirely.
// Then placeholders are replaced, 3+ newlines collapse, unknown {words} stay.
export function renderTemplate(template, values) {
  const kept = String(template)
    .split("\n")
    .filter((line) => {
      for (const name of KNOWN) {
        if (line.includes(`{${name}}`) && !String(values[name] ?? "").trim()) return false;
      }
      return true;
    });
  let out = kept.join("\n");
  for (const name of KNOWN) out = out.split(`{${name}}`).join(String(values[name] ?? ""));
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// ── {period} (4.4) ───────────────────────────────────────────────────────────
const MAX_DATES = 8;
const dayMonth = (d) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });
const nLessons = (n) => `${n} ${n === 1 ? "lesson" : "lessons"}`;
const dateList = (dates) => (dates.length <= MAX_DATES ? ` (${dates.map(dayMonth).join(", ")})` : "");

// One notice: { mode, isManualCloseout, dates[], periodStart, periodEnd }.
export function buildPeriodPhrase({ mode = "lessons", isManualCloseout = false, dates = [], periodStart, periodEnd }) {
  if (dates.length === 0) return `lessons up to ${dayMonth(periodEnd)}`;
  if (isManualCloseout || mode === "lessons") return `${nLessons(dates.length)}${dateList(dates)}`;
  if (mode === "per_lesson") {
    return dates.length === 1 ? `the lesson on ${dayMonth(dates[0])}` : `${nLessons(dates.length)}${dateList(dates)}`;
  }
  // monthly / custom_date: named after the month of period_start
  const month = monthName(String(periodStart).slice(0, 7));
  const inner = dates.length <= MAX_DATES ? `${nLessons(dates.length)}: ${dates.map(dayMonth).join(", ")}` : nLessons(dates.length);
  return `${month} lessons (${inner})`;
}

// Several notices: per-lesson notices merge into one phrase, others joined by "; ".
export function buildCombinedPeriod(notices) {
  if (notices.length === 1) return buildPeriodPhrase(notices[0]);
  const perLesson = notices.filter((n) => n.mode === "per_lesson" && !n.isManualCloseout);
  const others = notices.filter((n) => !perLesson.includes(n));
  const parts = [];
  if (perLesson.length > 0) {
    const dates = perLesson.flatMap((n) => n.dates).sort();
    parts.push(dates.length === 0 ? `lessons up to ${dayMonth(perLesson[0].periodEnd)}` : `${nLessons(dates.length)}${dateList(dates)}`);
  }
  for (const n of others) parts.push(buildPeriodPhrase(n));
  return parts.join("; ");
}

// ── Matching and stage (6.2) ─────────────────────────────────────────────────
export const noticeKey = (studentId, periodStart, periodEnd) => `${studentId}|${periodStart}|${periodEnd}`;

// Matches by cycle id (a hint) OR by (student, period_start, period_end).
export function remindersForNotice(reminders, cycle) {
  const key = noticeKey(cycle.student_id, cycle.period_start, cycle.period_end);
  return reminders.filter(
    (r) => r.payment_cycle_id === cycle.id || noticeKey(r.student_id, r.period_start, r.period_end) === key,
  );
}

export const reminderDayKey = (r) => sgtDateKey(new Date(r.reminded_at));
export const distinctDayKeys = (reminders) => [...new Set(reminders.map(reminderDayKey))].sort();

export function dayDiff(laterKey, earlierKey) {
  const t = (k) => Date.UTC(...k.split("-").map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((t(laterKey) - t(earlierKey)) / 86400000);
}

// Never-reminded notices always open on 'first'.
export function computeReminderStage({ reminderDayKeys, periodEnd, todayKey }) {
  const count = reminderDayKeys.length;
  const daysPastDue = dayDiff(todayKey, periodEnd);
  if (count >= 2 || (count >= 1 && daysPastDue >= 21)) return "overdue";
  if (count >= 1) return "followup";
  return "first";
}

export const mostAdvancedStage = (stages) =>
  stages.reduce((best, s) => (STAGES.indexOf(s) > STAGES.indexOf(best) ? s : best), "first");

const ago = (days) => (days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

// 4.2: what the row shows. Returns { text, reminded, count, newestToday,
// newestDaysAgo, todayIds[] } or null when there is nothing to say.
export function describeReminded({ reminders, cycle, todayKey }) {
  const mine = remindersForNotice(reminders, cycle);
  if (mine.length > 0) {
    const days = distinctDayKeys(mine);
    const newest = days[days.length - 1];
    const daysAgo = dayDiff(todayKey, newest);
    const todayIds = mine.filter((r) => reminderDayKey(r) === todayKey).map((r) => r.id);
    const text = `Reminded ${ago(daysAgo)}${days.length > 1 ? ` · ${days.length} reminders` : ""}`;
    return { text, reminded: true, count: days.length, newestToday: daysAgo === 0, newestDaysAgo: daysAgo, todayIds };
  }
  // Not reminded for this notice, but for another one of the same student in 30 days.
  const other = reminders.filter((r) => r.student_id === cycle.student_id);
  if (other.length > 0) {
    const days = distinctDayKeys(other);
    const daysAgo = dayDiff(todayKey, days[days.length - 1]);
    if (daysAgo <= 30) {
      return { text: `Last reminded ${ago(daysAgo)} (another notice)`, reminded: false, count: 0, newestToday: false, newestDaysAgo: daysAgo, todayIds: [] };
    }
  }
  return null;
}

// ── The log (6.6). Every query is scoped to the tutor. ───────────────────────
const PAGE = 1000;
export async function loadReminders(supabase, tutorId) {
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("payment_reminders")
      .select("id, student_id, payment_cycle_id, period_start, period_end, stage, reminded_at")
      .eq("tutor_id", tutorId)
      .gte("reminded_at", since)
      .order("reminded_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

// One row per notice included. reminded_at is the database default (now()).
export async function logReminders(supabase, { tutorId, notices, stage, channel }) {
  const payload = notices.map((c) => ({
    tutor_id: tutorId,
    student_id: c.student_id,
    payment_cycle_id: c.id ?? null,
    period_start: c.period_start,
    period_end: c.period_end,
    amount_due: Number(c.amount_due),
    stage,
    channel,
  }));
  return supabase
    .from("payment_reminders")
    .insert(payload)
    .select("id, student_id, payment_cycle_id, period_start, period_end, stage, reminded_at");
}

// Deletes today's (Singapore) log rows for one notice. Returns { error, ids }.
export async function undoTodayReminders(supabase, { tutorId, cycle, reminders, todayKey }) {
  const ids = remindersForNotice(reminders, cycle)
    .filter((r) => reminderDayKey(r) === todayKey)
    .map((r) => r.id);
  if (ids.length === 0) return { error: null, ids };
  const { error } = await supabase.from("payment_reminders").delete().eq("tutor_id", tutorId).in("id", ids);
  return { error, ids };
}
