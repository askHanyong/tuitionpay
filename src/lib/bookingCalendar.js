// Shared calendar-sync helper for booking-confirmed lessons.
// Mirrors the pattern in ScheduleLessonsModal.pushLessonToGoogleCalendar,
// but as an exported function that takes all needed data as arguments.
// Caller must treat failure as non-fatal and log the returned error.

import { supabase } from "./supabase";
import { createCalendarEvent, getValidAccessToken } from "./googleCalendar";

/**
 * Sync a newly created lesson to the tutor's Google Calendar.
 *
 * @param {object} p
 * @param {string} p.tutorId
 * @param {string} p.lessonId        — uuid of the created lessons row
 * @param {string} p.lessonDate      — "YYYY-MM-DD"
 * @param {string} p.lessonTime      — "HH:MM:SS" or "HH:MM" (may be null)
 * @param {number} p.durationMinutes
 * @param {string} p.studentName
 * @param {string} p.subject         — may be null
 * @param {string} p.address         — may be null (location)
 * @returns {Promise<string|null>}   error message, or null on success
 */
export async function syncBookingToCalendar({
  tutorId,
  lessonId,
  lessonDate,
  lessonTime,
  durationMinutes,
  studentName,
  subject,
  address,
}) {
  if (!lessonTime) return null; // no time set — skip calendar sync

  try {
    const { data: tutorRow, error: tokenErr } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", tutorId)
      .single();

    if (tokenErr || !tutorRow?.google_calendar_tokens) return null;

    const accessToken = await getValidAccessToken(tutorId, tutorRow.google_calendar_tokens);
    if (!accessToken) return null;

    const timeStr = lessonTime.slice(0, 5); // "HH:MM"
    const startStr = `${lessonDate}T${timeStr}:00+08:00`;

    const startMs = new Date(startStr).getTime();
    const endMs = startMs + durationMinutes * 60_000;
    // Build endStr from epoch: add 8h offset, slice UTC string, append +08:00
    const endStr =
      new Date(endMs + 8 * 3600_000).toISOString().slice(0, 19) + "+08:00";

    const subjectLabel = subject ?? "Lesson";
    const summary = `${subjectLabel} – ${studentName}`;
    const description = `Lesson with ${studentName}${subject ? ` (${subject})` : ""}`;

    const { id: eventId } = await createCalendarEvent(accessToken, {
      summary,
      description,
      location: address ?? "",
      start: startStr,
      end: endStr,
      timeZone: "Asia/Singapore",
    });

    if (eventId) {
      await supabase
        .from("lessons")
        .update({ google_event_id: eventId })
        .eq("id", lessonId)
        .eq("tutor_id", tutorId);
    }

    return null;
  } catch (e) {
    return e?.message ?? "Calendar sync failed";
  }
}
