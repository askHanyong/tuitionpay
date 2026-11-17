// Closed-month warnings (spec 4.7, 6.13). The browser only ASKS; the database
// triggers write the change log, so nothing here ever writes to a month table.

import { supabase } from "./supabase";
import { fetchPaged } from "./monthCloseData";
import { closedMonthMessage, lessonChangeDates, lessonToggleDates } from "./monthClose";

export { lessonChangeDates, lessonToggleDates };

// Closed months are kept in memory. They are re-read after at most CACHE_MS so a
// close made on another device is picked up without a reload (the trigger still
// logs a change if one slips through).
const CACHE_MS = 2 * 60 * 1000;
let cache = null; // { tutorId, at, months: Set<"YYYY-MM"> }

export function clearClosedMonthsCache() {
  cache = null;
}

// Set of "YYYY-MM" with status 'closed', or null if it could not be loaded.
export async function loadClosedMonths(tutorId) {
  if (cache && cache.tutorId === tutorId && Date.now() - cache.at < CACHE_MS) return cache.months;
  try {
    const rows = await fetchPaged(() =>
      supabase
        .from("month_closes")
        .select("month, status")
        .eq("tutor_id", tutorId)
        .order("month", { ascending: true }),
    );
    const months = new Set(
      rows.filter((r) => r.status === "closed").map((r) => String(r.month).slice(0, 7)),
    );
    cache = { tutorId, at: Date.now(), months };
    return months;
  } catch (e) {
    console.error("[closedMonths] could not load closed months", e);
    return null;
  }
}

// Resolves true when the change may go ahead. Asks (window.confirm, exact 4.7 copy)
// only when a date falls in a closed month. Fails open: if the closed list cannot
// be loaded the action is NOT blocked (the trigger still logs it).
//   dateKeys: array (falsy entries ignored) or a function returning one (sync or
//             async), only called when the tutor has at least one closed month.
//   skip:     true for changes that touch no figure (practice student, etc.).
export async function confirmClosedMonthChange({ tutorId, dateKeys, kind, skip = false }) {
  if (skip || !tutorId) return true;
  const closed = await loadClosedMonths(tutorId);
  if (!closed || closed.size === 0) return true;
  let keys;
  try {
    keys = typeof dateKeys === "function" ? await dateKeys() : dateKeys;
  } catch (e) {
    console.error("[closedMonths] could not work out which months this touches", e);
    return true;
  }
  const list = Array.isArray(keys) ? keys : [keys];
  const months = [
    ...new Set(list.filter(Boolean).map((k) => String(k).slice(0, 7))),
  ]
    .filter((m) => closed.has(m))
    .sort();
  if (months.length === 0) return true;
  return window.confirm(closedMonthMessage(kind, months));
}

// ── Lookups used to work out which months a write touches (read-only) ────────
const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// Bill now bills ALL of a student's unbilled completed lessons: the month it touches
// is that of the latest one.
export async function latestUnbilledLessonDate(tutorId, studentId) {
  const { data, error } = await supabase
    .from("lessons")
    .select("lesson_date")
    .eq("tutor_id", tutorId)
    .eq("student_id", studentId)
    .eq("is_completed", true)
    .is("payment_cycle_id", null)
    .order("lesson_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.lesson_date ?? null;
}

// period_end of notices by id (a notice belongs to the month of its period_end).
export async function periodEndsOf(tutorId, cycleIds) {
  const out = [];
  for (const ids of chunk(cycleIds ?? [], 100)) {
    const { data, error } = await supabase
      .from("payment_cycles")
      .select("period_end")
      .eq("tutor_id", tutorId)
      .in("id", ids);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []).map((r) => r.period_end));
  }
  return out;
}

// Everything "write off all" touches for a student: the unbilled lessons about to be
// billed, plus every pending / overdue notice about to be written off.
export async function studentOwedDates(tutorId, studentId) {
  const { data, error } = await supabase
    .from("payment_cycles")
    .select("period_end")
    .eq("tutor_id", tutorId)
    .eq("student_id", studentId)
    .in("status", ["pending", "overdue"]);
  if (error) throw new Error(error.message);
  return [
    await latestUnbilledLessonDate(tutorId, studentId),
    ...(data ?? []).map((r) => r.period_end),
  ];
}

// Dates of the COMPLETED, non-practice lessons among these ids (bulk edits and
// replace-deletes only matter for lessons that count).
export async function completedLessonDates(tutorId, lessonIds) {
  const out = [];
  for (const ids of chunk(lessonIds ?? [], 100)) {
    const { data, error } = await supabase
      .from("lessons")
      .select("lesson_date, is_completed, students(is_practice)")
      .eq("tutor_id", tutorId)
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const l of data ?? []) {
      if (l.is_completed && !l.students?.is_practice) out.push(l.lesson_date);
    }
  }
  return out;
}
