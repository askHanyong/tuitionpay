import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { toDateKey } from "../lib/date";
import { formatDate } from "../utils/dateFormat";
import {
  createCalendarEvent,
  getValidAccessToken,
} from "../lib/googleCalendar";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function formatDateWithDay(dateKey, time) {
  const d = new Date(`${dateKey}T00:00:00`);
  const dayName = d.toLocaleDateString("en-SG", { weekday: "short" });
  const timeLabel = formatTimeLabel(time);
  return `${dayName}, ${formatDate(dateKey)}${timeLabel ? `  ${timeLabel}` : ""}`;
}

function formatTimeLabel(time) {
  if (!time) return "";
  const [hStr, mStr] = time.split(":");
  let hour = Number(hStr);
  const period = hour >= 12 ? "pm" : "am";
  hour = hour % 12 || 12;
  return `${hour}:${(mStr ?? "00").padStart(2, "0")}${period}`;
}

const todayKey = () => toDateKey(new Date());

function nextOccurrence(dayName, from = new Date()) {
  const targetJsDay = (WEEKDAYS.indexOf(dayName) + 1) % 7; // Monday=1 ... Sunday=0
  const d = new Date(from);
  d.setDate(d.getDate() + ((targetJsDay - d.getDay() + 7) % 7));
  return toDateKey(d);
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function generateOccurrences({ startDate, endDate, frequency }) {
  if (!startDate || !endDate || startDate > endDate) return [];
  const stepDays = frequency === "fortnightly" ? 14 : 7;
  const dates = [];
  let cur = startDate;
  while (cur <= endDate) {
    dates.push(cur);
    cur = addDays(cur, stepDays);
  }
  return dates;
}

function generateOccurrencesByCount({ startDate, frequency, count }) {
  if (!startDate || !count || count < 1) return [];
  const stepDays = frequency === "fortnightly" ? 14 : 7;
  const dates = [];
  let cur = startDate;
  for (let i = 0; i < count; i++) {
    dates.push(cur);
    cur = addDays(cur, stepDays);
  }
  return dates;
}

export default function ScheduleLessonsModal({
  student,
  onClose,
  onScheduled,
}) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [dayOfWeek, setDayOfWeek] = useState(WEEKDAYS[0]);
  const [time, setTime] = useState("09:00");
  const [frequency, setFrequency] = useState("weekly");
  const [startDate, setStartDate] = useState(() => nextOccurrence(WEEKDAYS[0]));
  const [endMode, setEndMode] = useState("count"); // "count" | "date"
  const [occurrenceCount, setOccurrenceCount] = useState(10);
  const [endDate, setEndDate] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");

  useEffect(() => {
    const loadSubjects = async () => {
      const { data } = await supabase
        .from("student_subjects")
        .select("*")
        .eq("student_id", student.id)
        .eq("tutor_id", user.id)
        .order("created_at", { ascending: true });
      setSubjects(data ?? []);
      setSubjectId(data?.[0]?.id ?? "");
    };
    loadSubjects();
  }, [student.id, user.id]);

  const selectedSubject = subjects.find((s) => s.id === subjectId);
  const durationHours =
    selectedSubject?.lesson_duration_hours ?? student.lesson_duration_hours;
  const rate = selectedSubject?.hourly_rate ?? student.hourly_rate;
  const subjectText = selectedSubject?.subject ?? student.subject;

  const handleDayChange = (value) => {
    setDayOfWeek(value);
    setStartDate(nextOccurrence(value));
  };

  const buildRow = (date) => ({
    tutor_id: user.id,
    student_id: student.id,
    student_subject_id: subjectId || null,
    subject: subjectText ?? null,
    lesson_date: date,
    lesson_time: time || null,
    duration_minutes: Math.round(Number(durationHours) * 60),
    rate: rate ?? null,
    lesson_mode: "f2f",
    status: date > todayKey() ? "scheduled" : "completed",
    is_completed: false,
  });

  const getTutorGoogleTokens = async () => {
    const { data: tutor } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", user.id)
      .single();
    return tutor?.google_calendar_tokens ?? null;
  };

  // Fetches tokens fresh from Supabase each time so that if Google refreshes
  // (rotates) the token mid-batch, later lessons in the loop still get a valid
  // token rather than reusing a stale object from before the loop started.
  const pushLessonToGoogleCalendar = async (lesson) => {
    const tokens = await getTutorGoogleTokens();
    if (!tokens?.access_token) return { ok: false, reason: "not connected" };

    // lesson_time from Supabase is "HH:MM:SS"; slice to "HH:MM" before
    // appending ":00" to avoid producing the invalid string "HH:MM:SS:00".
    const timeStr = (lesson.lesson_time ?? "09:00").slice(0, 5);
    const startStr = `${lesson.lesson_date}T${timeStr}:00+08:00`;
    const startMs = new Date(startStr).getTime();
    const endMs = startMs + lesson.duration_minutes * 60000;
    const endStr = new Date(endMs + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";

    const attempt = async () => {
      const accessToken = await getValidAccessToken(user.id, tokens);
      const event = await createCalendarEvent(accessToken, {
        summary: `${student.name} — ${subjectText || "Lesson"}`,
        description: `Lesson for ${student.name}`,
        location: student.address || undefined,
        start: startStr,
        end: endStr,
      });
      await supabase
        .from("lessons")
        .update({ google_event_id: event.id })
        .eq("id", lesson.id)
        .eq("tutor_id", user.id);
    };

    try {
      await attempt();
      return { ok: true };
    } catch (err1) {
      try {
        await attempt();
        return { ok: true };
      } catch (err2) {
        console.error(
          `Calendar sync failed for lesson ${lesson.lesson_date}:`,
          err2,
        );
        return { ok: false, reason: err2?.message ?? "unknown error" };
      }
    }
  };

  const handlePreview = async () => {
    setError(null);
    if (durationHours == null) {
      setError(
        "Set this student's lesson duration in their profile before scheduling.",
      );
      return;
    }
    if (!startDate) {
      setError("Pick a start date.");
      return;
    }

    let dates;
    if (endMode === "count") {
      if (!occurrenceCount || occurrenceCount < 1) {
        setError("Enter how many lessons to schedule.");
        return;
      }
      dates = generateOccurrencesByCount({
        startDate,
        frequency,
        count: occurrenceCount,
      });
    } else {
      if (!endDate) {
        setError("Pick an end date.");
        return;
      }
      if (endDate < startDate) {
        setError("End date must be on or after the start date.");
        return;
      }
      dates = generateOccurrences({ startDate, endDate, frequency });
    }

    setLoadingPreview(true);
    const { data: existing, error: lookupError } = await supabase
      .from("lessons")
      .select("id, lesson_date")
      .eq("tutor_id", user.id)
      .eq("student_id", student.id)
      .in("lesson_date", dates);
    setLoadingPreview(false);
    if (lookupError) {
      setError(lookupError.message);
      return;
    }
    const existingByDate = new Map(
      (existing ?? []).map((l) => [l.lesson_date, l]),
    );
    setPreview(
      dates.map((date) => ({
        date,
        conflict: existingByDate.get(date) ?? null,
        action: "skip",
        excluded: false,
      })),
    );
  };

  const setConflictAction = (date, action) => {
    setPreview((prev) =>
      prev.map((item) => (item.date === date ? { ...item, action } : item)),
    );
  };

  const toggleExcluded = (date) => {
    setPreview((prev) =>
      prev.map((item) =>
        item.date === date ? { ...item, excluded: !item.excluded } : item,
      ),
    );
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const toDelete = [];
      const toInsert = [];
      for (const item of preview) {
        if (item.excluded) continue;
        if (item.conflict) {
          if (item.action === "replace") {
            toDelete.push(item.conflict.id);
            toInsert.push(buildRow(item.date));
          }
        } else {
          toInsert.push(buildRow(item.date));
        }
      }
      if (toDelete.length) {
        const { error } = await supabase
          .from("lessons")
          .delete()
          .in("id", toDelete)
          .eq("tutor_id", user.id);
        if (error) throw error;
      }
      let inserted = [];
      if (toInsert.length) {
        const { data, error } = await supabase
          .from("lessons")
          .insert(toInsert)
          .select();
        if (error) throw error;
        inserted = data ?? [];
      }

      if (inserted.length) {
        // Check once whether Google Calendar is connected before looping.
        // Each pushLessonToGoogleCalendar call fetches its own fresh tokens
        // internally — this check is just to skip the loop entirely when
        // Google Calendar hasn't been connected.
        const tokens = await getTutorGoogleTokens();
        if (tokens?.access_token) {
          const failedDates = [];
          for (const lesson of inserted) {
            const result = await pushLessonToGoogleCalendar(lesson);
            if (!result.ok) failedDates.push(lesson.lesson_date);
          }
          if (failedDates.length > 0) {
            const dateList = failedDates
              .map((d) => new Date(`${d}T00:00:00`).toLocaleDateString("en-SG", { day: "numeric", month: "short" }))
              .join(", ");
            showToast(
              `Lessons saved, but ${failedDates.length} failed to sync to Google Calendar: ${dateList}. Try reconnecting Google Calendar in Settings if this keeps happening.`,
              "error",
            );
          }
        }
      }

      showToast(
        inserted.length
          ? `✅ ${inserted.length} lesson${inserted.length === 1 ? "" : "s"} scheduled successfully.`
          : "No lessons were scheduled.",
      );
      onScheduled?.();
      onClose();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const conflictCount = preview?.filter((p) => p.conflict).length ?? 0;
  const createCount =
    preview?.filter(
      (p) => !p.excluded && (!p.conflict || p.action === "replace"),
    ).length ?? 0;

  const previewSummary = (() => {
    if (!preview || preview.length === 0) return "";
    const last = preview[preview.length - 1].date;
    return endMode === "count"
      ? `${preview.length} lesson${preview.length === 1 ? "" : "s"} scheduled, last on ${formatDate(last)}`
      : `${preview.length} lesson${preview.length === 1 ? "" : "s"} scheduled between ${formatDate(startDate)} and ${formatDate(endDate)}`;
  })();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Schedule lessons for {student.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        {!preview ? (
          <div className="space-y-4">
            {subjects.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Subject
                </label>
                <select
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Day of week
              </label>
              <select
                value={dayOfWeek}
                onChange={(e) => handleDayChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Time
              </label>
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Start date
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>

            <div className="space-y-2 rounded-md border border-gray-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="radio"
                  name="endMode"
                  checked={endMode === "count"}
                  onChange={() => setEndMode("count")}
                  className="h-4 w-4 text-[#5ecfaa] focus:ring-[#5ecfaa]"
                />
                End after ___ lessons
              </label>
              {endMode === "count" && (
                <input
                  type="number"
                  min={1}
                  value={occurrenceCount}
                  onChange={(e) =>
                    setOccurrenceCount(parseInt(e.target.value, 10) || "")
                  }
                  className="ml-6 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              )}

              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="radio"
                  name="endMode"
                  checked={endMode === "date"}
                  onChange={() => setEndMode("date")}
                  className="h-4 w-4 text-[#5ecfaa] focus:ring-[#5ecfaa]"
                />
                End by date
              </label>
              {endMode === "date" && (
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="ml-6 w-full max-w-[calc(100%-1.5rem)] rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              )}
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={loadingPreview}
                className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-50"
              >
                {loadingPreview ? "Checking..." : "Preview"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-900">
              Lessons to be scheduled ({preview.length} total):
            </p>
            <p className="text-xs text-gray-500">{previewSummary}</p>
            {conflictCount > 0 && (
              <p className="text-xs text-amber-700">
                {conflictCount} conflict{conflictCount === 1 ? "" : "s"} found —
                skip or replace below.
              </p>
            )}

            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {preview.map((item) => (
                <li
                  key={item.date}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                    item.excluded
                      ? "border-gray-200 bg-gray-100 opacity-60"
                      : item.conflict
                        ? "border-amber-200 bg-amber-50"
                        : "border-gray-100 bg-gray-50"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-gray-700">
                    <span aria-hidden="true">{item.excluded ? "●" : "○"}</span>
                    {formatDateWithDay(item.date, time)}
                    {item.excluded && (
                      <span className="rounded-full bg-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700">
                        Skipped
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-xs">
                    {item.conflict && !item.excluded && (
                      <>
                        <span className="text-amber-800">
                          You already have a lesson with {student.name} on{" "}
                          {formatDate(item.date)} — skip or replace?
                        </span>
                        <button
                          type="button"
                          onClick={() => setConflictAction(item.date, "skip")}
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            item.action === "skip"
                              ? "bg-gray-700 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConflictAction(item.date, "replace")
                          }
                          className={`rounded-full px-2 py-0.5 font-medium ${
                            item.action === "replace"
                              ? "bg-red-600 text-white"
                              : "bg-white text-gray-700 hover:bg-gray-100"
                          }`}
                        >
                          Replace
                        </button>
                      </>
                    )}
                    {!item.conflict && !item.excluded && (
                      <span className="text-xs font-medium text-[#0f7a58]">
                        New
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleExcluded(item.date)}
                      className={`rounded-full px-2 py-0.5 font-medium ${
                        item.excluded
                          ? "bg-gray-700 text-white"
                          : "bg-white text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {item.excluded ? "Skipped" : "Skip"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{createCount}</span> lesson
                {createCount === 1 ? "" : "s"} will be created
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={saving || createCount === 0}
                  className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-50"
                >
                  {saving ? "Scheduling..." : "Confirm and Schedule"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
