import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { formatDate, toDateKey } from "../lib/date";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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
  const [endDate, setEndDate] = useState("");
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleDayChange = (value) => {
    setDayOfWeek(value);
    setStartDate(nextOccurrence(value));
  };

  const buildRow = (date) => ({
    tutor_id: user.id,
    student_id: student.id,
    lesson_date: date,
    lesson_time: time || null,
    duration_minutes: Math.round(Number(student.lesson_duration_hours) * 60),
    rate: student.hourly_rate ?? null,
    status: date > todayKey() ? "scheduled" : "completed",
  });

  const handlePreview = async () => {
    setError(null);
    if (student.lesson_duration_hours == null) {
      setError(
        "Set this student's lesson duration in their profile before scheduling.",
      );
      return;
    }
    if (!endDate) {
      setError("Pick an end date.");
      return;
    }
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setLoadingPreview(true);
    const dates = generateOccurrences({ startDate, endDate, frequency });
    const { data: existing, error: lookupError } = await supabase
      .from("lessons")
      .select("id, lesson_date")
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
      })),
    );
  };

  const setConflictAction = (date, action) => {
    setPreview((prev) =>
      prev.map((item) => (item.date === date ? { ...item, action } : item)),
    );
  };

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const toDelete = [];
      const toInsert = [];
      for (const item of preview) {
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
          .in("id", toDelete);
        if (error) throw error;
      }
      if (toInsert.length) {
        const { error } = await supabase.from("lessons").insert(toInsert);
        if (error) throw error;
      }
      showToast(
        toInsert.length
          ? `${toInsert.length} lesson${toInsert.length === 1 ? "" : "s"} scheduled.`
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
    preview?.filter((p) => !p.conflict || p.action === "replace").length ?? 0;

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
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Day of week
              </label>
              <select
                value={dayOfWeek}
                onChange={(e) => handleDayChange(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
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
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Start date
                </label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  End date
                </label>
                <input
                  type="date"
                  required
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </div>
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
                className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {loadingPreview ? "Checking..." : "Preview"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              This will create{" "}
              <span className="font-semibold">
                {createCount} lesson{createCount === 1 ? "" : "s"}
              </span>
              {conflictCount > 0 &&
                ` (${conflictCount} conflict${conflictCount === 1 ? "" : "s"} found)`}
              :
            </p>

            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {preview.map((item) => (
                <li
                  key={item.date}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                    item.conflict
                      ? "border-amber-200 bg-amber-50"
                      : "border-gray-100 bg-gray-50"
                  }`}
                >
                  <span className="text-gray-700">{formatDate(item.date)}</span>
                  {item.conflict ? (
                    <span className="flex flex-wrap items-center gap-2 text-xs">
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
                        onClick={() => setConflictAction(item.date, "replace")}
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          item.action === "replace"
                            ? "bg-red-600 text-white"
                            : "bg-white text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        Replace
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-green-700">
                      New
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2">
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
                className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? "Scheduling..." : "Confirm and Schedule"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
