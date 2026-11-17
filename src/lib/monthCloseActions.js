// Everything the month-end close page writes. It reuses the same calls as the rest
// of the app (Payments.jsx mark paid / write off, Dashboard bill now, Lessons.jsx
// delete) and the two RPCs. It NEVER writes month_closes or closed_month_changes
// directly: those tables are read-only for the browser.

import { supabase } from "./supabase";
import { lessonAmount } from "./paymentMode";
import { deleteCalendarEvent, getValidAccessToken } from "./googleCalendar";
import { fetchPaged } from "./monthCloseData";

const must = ({ error }) => {
  if (error) throw new Error(error.message);
};

// ── Carry draft (6.5): ids only, never amounts or names. Storage may be blocked,
// in which case the draft simply lives in memory (the caller keeps it in state).
const draftKey = (tutorId, monthStr) => `cnp_close_draft_${tutorId}_${monthStr}`;

export function readDraft(tutorId, monthStr) {
  try {
    const raw = localStorage.getItem(draftKey(tutorId, monthStr));
    const value = raw ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function writeDraft(tutorId, monthStr, draft) {
  try {
    localStorage.setItem(draftKey(tutorId, monthStr), JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft stays in memory */
  }
}

export function clearDraft(tutorId, monthStr) {
  try {
    localStorage.removeItem(draftKey(tutorId, monthStr));
  } catch {
    /* storage unavailable */
  }
}

// ── Checklist actions ────────────────────────────────────────────────────────
export async function markNoticePaid(tutorId, cycleId) {
  must(
    await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", cycleId)
      .eq("tutor_id", tutorId),
  );
}

export async function writeOffNotice(tutorId, cycle) {
  must(
    await supabase
      .from("payment_cycles")
      .update({
        status: "waived",
        waived_from_status: cycle.status,
        waived_at: new Date().toISOString(),
      })
      .eq("id", cycle.id)
      .eq("tutor_id", tutorId),
  );
}

export async function markLessonDone(tutorId, lessonId) {
  must(
    await supabase
      .from("lessons")
      .update({ is_completed: true })
      .eq("id", lessonId)
      .eq("tutor_id", tutorId),
  );
}

// "Didn't happen": remove the Google Calendar event (best effort, exactly like
// Lessons.jsx confirmDelete) and then delete the lesson.
export async function deleteLessonWithCalendar(tutorId, lessonId) {
  const { data: row, error } = await supabase
    .from("lessons")
    .select("google_event_id")
    .eq("id", lessonId)
    .eq("tutor_id", tutorId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (row?.google_event_id) {
    try {
      const { data: tutor } = await supabase
        .from("tutors")
        .select("google_calendar_tokens")
        .eq("id", tutorId)
        .single();
      const tokens = tutor?.google_calendar_tokens ?? null;
      if (tokens?.access_token) {
        const accessToken = await getValidAccessToken(tutorId, tokens);
        await deleteCalendarEvent(accessToken, row.google_event_id);
      }
    } catch {
      // Best-effort: carry on with deleting the lesson whether or not the event was removed.
    }
  }
  must(
    await supabase.from("lessons").delete().eq("id", lessonId).eq("tutor_id", tutorId),
  );
}

// All of a student's unbilled completed lessons, any date: "Bill now" bills every one.
export async function fetchUnbilledLessons(tutorId, studentId) {
  return fetchPaged(() =>
    supabase
      .from("lessons")
      .select("id, lesson_date, rate, rate_type, duration_minutes")
      .eq("tutor_id", tutorId)
      .eq("student_id", studentId)
      .eq("is_completed", true)
      .is("payment_cycle_id", null)
      .order("lesson_date", { ascending: true })
      .order("id", { ascending: true }),
  );
}

export const sumLessons = (lessons, student) =>
  lessons.reduce((t, l) => t + lessonAmount(l, student), 0);

export async function billStudentNow(studentId) {
  must(await supabase.rpc("create_manual_closeout_cycle", { p_student_id: studentId }));
}

// ── Close / reopen: the only way month_closes is written ─────────────────────
export async function closeMonthRpc(monthStr, snapshot) {
  must(await supabase.rpc("close_month", { p_month: `${monthStr}-01`, p_snapshot: snapshot }));
}

export async function reopenMonthRpc(monthStr, reason) {
  must(await supabase.rpc("reopen_month", { p_month: `${monthStr}-01`, p_reason: reason }));
}

// Read-only: the stored row, to compare with what was sent.
export async function readCloseRow(tutorId, monthStr) {
  const { data, error } = await supabase
    .from("month_closes")
    .select("id, month, status, revision, calc_version, snapshot, closed_at, reopened_at, reopen_reason")
    .eq("tutor_id", tutorId)
    .eq("month", `${monthStr}-01`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
