import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";

// --- helpers -----------------------------------------------------------

function toSGT(date, timeStr) {
  // date: "YYYY-MM-DD", timeStr: "HH:MM"
  // Returns ISO string with explicit +08:00 — never uses toISOString().
  return `${date}T${timeStr}:00+08:00`;
}

function sgtDateStr(ts) {
  // ts: timestamptz string from DB. Returns "YYYY-MM-DD" in SGT (+08:00).
  const d = new Date(ts);
  const off = d.getTime() + 8 * 60 * 60 * 1000;
  const utc8 = new Date(off);
  return utc8.toISOString().slice(0, 10);
}

function sgtTimeStr(ts) {
  // Returns "HH:MM" in SGT.
  const d = new Date(ts);
  const off = d.getTime() + 8 * 60 * 60 * 1000;
  const utc8 = new Date(off);
  return utc8.toISOString().slice(11, 16);
}

function weekStart(d) {
  // Returns the Monday of the week containing d (Date).
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function formatDisplayDate(dateStr) {
  // "YYYY-MM-DD" → "Mon 20 Oct"
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// -----------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const DEFAULT_SETTINGS = {
  min_notice_hours: 48,
  max_book_days_ahead: 14,
  view_days_ahead: 28,
  min_lesson_minutes: 60,
  max_lesson_minutes: 120,
  lesson_step_minutes: 30,
  request_expiry_hours: 48,
};

function FieldRow({ label, children, error }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function NumberInput({ value, onChange, min, max, disabled }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      disabled={disabled}
      className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa] disabled:bg-gray-50"
    />
  );
}

// -----------------------------------------------------------------------

export default function Availability() {
  const { user } = useAuth();
  const { showToast } = useToast();

  // Week navigation
  const [weekOf, setWeekOf] = useState(() => weekStart(new Date()));
  const weekDates = Array.from({ length: 7 }, (_, i) => isoDate(addDays(weekOf, i)));

  // Windows
  const [windows, setWindows] = useState([]);
  const [loadingWindows, setLoadingWindows] = useState(true);

  // Add-window form
  const [addDate, setAddDate] = useState("");
  const [addStart, setAddStart] = useState("09:00");
  const [addEnd, setAddEnd] = useState("11:00");
  const [addError, setAddError] = useState(null);
  const [addLoading, setAddLoading] = useState(false);

  // Copy last week
  const [copyLoading, setCopyLoading] = useState(false);

  // Settings
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsErrors, setSettingsErrors] = useState({});
  const [settingsDirty, setSettingsDirty] = useState(false);

  // ---- load ----

  const loadWindows = useCallback(async () => {
    setLoadingWindows(true);
    // Load a 3-week window: prev + current + next to support copy-last-week
    const from = isoDate(addDays(weekOf, -7)) + "T00:00:00+08:00";
    const to   = isoDate(addDays(weekOf, 14)) + "T23:59:59+08:00";
    const { data, error } = await supabase
      .from("availability_windows")
      .select("*")
      .eq("tutor_id", user.id)
      .gte("start_at", from)
      .lte("start_at", to)
      .order("start_at");
    if (error) {
      showToast("Could not load availability: " + error.message, "error");
    } else {
      setWindows(data ?? []);
    }
    setLoadingWindows(false);
  }, [user.id, weekOf, showToast]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    const { data, error } = await supabase
      .from("booking_settings")
      .select("*")
      .eq("tutor_id", user.id)
      .maybeSingle();
    if (error) {
      showToast("Could not load booking settings: " + error.message, "error");
    } else if (data) {
      setSettings({
        min_notice_hours:     data.min_notice_hours,
        max_book_days_ahead:  data.max_book_days_ahead,
        view_days_ahead:      data.view_days_ahead,
        min_lesson_minutes:   data.min_lesson_minutes,
        max_lesson_minutes:   data.max_lesson_minutes,
        lesson_step_minutes:  data.lesson_step_minutes,
        request_expiry_hours: data.request_expiry_hours,
      });
    }
    setSettingsLoading(false);
  }, [user.id, showToast]);

  useEffect(() => {
    loadWindows();
  }, [loadWindows]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ---- windows for this week ----

  const windowsThisWeek = windows.filter((w) => {
    const d = sgtDateStr(w.start_at);
    return d >= weekDates[0] && d <= weekDates[6];
  });

  const windowsByDate = new Map();
  for (const w of windowsThisWeek) {
    const d = sgtDateStr(w.start_at);
    if (!windowsByDate.has(d)) windowsByDate.set(d, []);
    windowsByDate.get(d).push(w);
  }

  // ---- add window ----

  function validateAdd() {
    if (!addDate) return "Select a date.";
    if (addEnd <= addStart) return "End time must be after start time.";

    // Check overlap with existing windows on same date
    const same = windows.filter((w) => sgtDateStr(w.start_at) === addDate);
    for (const w of same) {
      const ws = sgtTimeStr(w.start_at);
      const we = sgtTimeStr(w.end_at);
      // Overlap: new starts before existing ends AND new ends after existing starts
      if (addStart < we && addEnd > ws) {
        return `Overlaps with existing window ${ws}–${we}.`;
      }
    }
    return null;
  }

  const handleAddWindow = async (e) => {
    e.preventDefault();
    const err = validateAdd();
    if (err) { setAddError(err); return; }
    setAddError(null);
    setAddLoading(true);
    const { error } = await supabase.from("availability_windows").insert({
      tutor_id: user.id,
      start_at: toSGT(addDate, addStart),
      end_at:   toSGT(addDate, addEnd),
    });
    setAddLoading(false);
    if (error) {
      setAddError(error.message);
    } else {
      setAddDate("");
      setAddStart("09:00");
      setAddEnd("11:00");
      await loadWindows();
    }
  };

  // ---- delete window ----

  const handleDelete = async (id) => {
    const { error } = await supabase
      .from("availability_windows")
      .delete()
      .eq("id", id)
      .eq("tutor_id", user.id);
    if (error) {
      showToast("Could not delete window: " + error.message, "error");
    } else {
      setWindows((prev) => prev.filter((w) => w.id !== id));
    }
  };

  // ---- copy last week ----

  const handleCopyLastWeek = async () => {
    const lastWeekStart = isoDate(addDays(weekOf, -7));
    const lastWeekEnd   = isoDate(addDays(weekOf, -1));

    const lastWeekWindows = windows.filter((w) => {
      const d = sgtDateStr(w.start_at);
      return d >= lastWeekStart && d <= lastWeekEnd;
    });

    if (lastWeekWindows.length === 0) {
      showToast("No windows in the previous week to copy.", "error");
      return;
    }

    // Build this-week equivalents, skipping if time already exists
    const toInsert = [];
    for (const w of lastWeekWindows) {
      const srcDate = sgtDateStr(w.start_at);
      const srcStart = sgtTimeStr(w.start_at);
      const srcEnd   = sgtTimeStr(w.end_at);
      // Shift by 7 days
      const [y, m, d] = srcDate.split("-").map(Number);
      const shifted = new Date(y, m - 1, d + 7);
      const destDate = isoDate(shifted);

      // Skip if an overlapping window already exists this week for that date+time
      const existing = windows.filter((e) => sgtDateStr(e.start_at) === destDate);
      const overlaps = existing.some((e) => {
        const es = sgtTimeStr(e.start_at);
        const ee = sgtTimeStr(e.end_at);
        return srcStart < ee && srcEnd > es;
      });
      if (!overlaps) {
        toInsert.push({
          tutor_id: user.id,
          start_at: toSGT(destDate, srcStart),
          end_at:   toSGT(destDate, srcEnd),
        });
      }
    }

    if (toInsert.length === 0) {
      showToast("All last-week windows already exist this week — nothing to copy.");
      return;
    }

    setCopyLoading(true);
    const { error } = await supabase.from("availability_windows").insert(toInsert);
    setCopyLoading(false);
    if (error) {
      showToast("Could not copy windows: " + error.message, "error");
    } else {
      showToast(`Copied ${toInsert.length} window${toInsert.length === 1 ? "" : "s"} from last week.`);
      await loadWindows();
    }
  };

  // ---- settings ----

  function validateSettings() {
    const errs = {};
    if (settings.view_days_ahead < settings.max_book_days_ahead) {
      errs.view_days_ahead = "Must be ≥ days parents can book ahead.";
    }
    if (settings.max_lesson_minutes < settings.min_lesson_minutes) {
      errs.max_lesson_minutes = "Must be ≥ minimum lesson length.";
    }
    if (settings.max_lesson_minutes > 120) {
      errs.max_lesson_minutes = "Cannot exceed 120 minutes.";
    }
    return errs;
  }

  const handleSettingsChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
    setSettingsDirty(true);
    setSettingsErrors({});
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const errs = validateSettings();
    if (Object.keys(errs).length) { setSettingsErrors(errs); return; }
    setSettingsSaving(true);
    const { error } = await supabase.from("booking_settings").upsert(
      { tutor_id: user.id, ...settings, updated_at: new Date().toISOString() },
      { onConflict: "tutor_id" },
    );
    setSettingsSaving(false);
    if (error) {
      showToast("Could not save settings: " + error.message, "error");
    } else {
      setSettingsDirty(false);
      showToast("Booking settings saved.");
    }
  };

  // ---- render ----

  const prevWeekLabel = isoDate(addDays(weekOf, -7));
  const nextWeekLabel = isoDate(addDays(weekOf, 7));

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Availability</h1>
          <p className="mt-1 text-sm text-gray-500">
            Set when you're available for parent bookings.
          </p>
        </div>

        {/* Week navigator */}
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <button
              onClick={() => setWeekOf(addDays(weekOf, -7))}
              className="min-h-11 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← {prevWeekLabel}
            </button>
            <span className="text-sm font-semibold text-gray-900">
              {weekDates[0]} – {weekDates[6]}
            </span>
            <button
              onClick={() => setWeekOf(addDays(weekOf, 7))}
              className="min-h-11 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {nextWeekLabel} →
            </button>
          </div>

          <button
            onClick={handleCopyLastWeek}
            disabled={copyLoading}
            className="mb-4 min-h-11 rounded-md border border-[#5ecfaa] px-3 text-sm font-medium text-[#0f7a58] hover:bg-[#d6ede6] disabled:opacity-50"
          >
            {copyLoading ? "Copying…" : "Copy last week's windows"}
          </button>

          {loadingWindows ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <div className="space-y-3">
              {weekDates.map((date, i) => {
                const ws = windowsByDate.get(date) ?? [];
                return (
                  <div key={date} className="flex gap-3">
                    <span className="w-10 pt-2 text-xs font-medium text-gray-500">
                      {DAYS[i]}
                    </span>
                    <div className="flex-1">
                      {ws.length === 0 ? (
                        <span className="text-xs text-gray-300">No windows</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {ws
                            .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))
                            .map((w) => (
                              <span
                                key={w.id}
                                className="flex items-center gap-1 rounded-full bg-[#d6ede6] px-2.5 py-1 text-xs font-medium text-[#0f7a58]"
                              >
                                {sgtTimeStr(w.start_at)}–{sgtTimeStr(w.end_at)}
                                <button
                                  onClick={() => handleDelete(w.id)}
                                  className="ml-0.5 text-[#0f7a58] hover:text-red-600"
                                  aria-label={`Delete window ${sgtTimeStr(w.start_at)}–${sgtTimeStr(w.end_at)} on ${date}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add window form */}
          <form
            onSubmit={handleAddWindow}
            className="mt-5 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-5"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Date
              </label>
              <input
                type="date"
                required
                value={addDate}
                onChange={(e) => { setAddDate(e.target.value); setAddError(null); }}
                className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Start
              </label>
              <input
                type="time"
                required
                value={addStart}
                onChange={(e) => { setAddStart(e.target.value); setAddError(null); }}
                className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                End
              </label>
              <input
                type="time"
                required
                value={addEnd}
                onChange={(e) => { setAddEnd(e.target.value); setAddError(null); }}
                className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <button
              type="submit"
              disabled={addLoading}
              className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
            >
              {addLoading ? "Adding…" : "Add window"}
            </button>
            {addError && (
              <p className="w-full text-sm text-red-600">{addError}</p>
            )}
          </form>
        </section>

        {/* Booking settings */}
        <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            Booking settings
          </h2>
          {settingsLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldRow
                  label="Minimum notice (hours)"
                  error={settingsErrors.min_notice_hours}
                >
                  <NumberInput
                    value={settings.min_notice_hours}
                    onChange={(v) => handleSettingsChange("min_notice_hours", v)}
                    min={0}
                  />
                </FieldRow>

                <FieldRow
                  label="Max days parents can book ahead"
                  error={settingsErrors.max_book_days_ahead}
                >
                  <NumberInput
                    value={settings.max_book_days_ahead}
                    onChange={(v) => handleSettingsChange("max_book_days_ahead", v)}
                    min={1}
                  />
                </FieldRow>

                <FieldRow
                  label="Days parents can view calendar"
                  error={settingsErrors.view_days_ahead}
                >
                  <NumberInput
                    value={settings.view_days_ahead}
                    onChange={(v) => handleSettingsChange("view_days_ahead", v)}
                    min={1}
                  />
                  {!settingsErrors.view_days_ahead && (
                    <p className="mt-1 text-xs text-gray-400">
                      Must be ≥ booking days ahead.
                    </p>
                  )}
                </FieldRow>

                <FieldRow
                  label="Min lesson length (minutes)"
                  error={settingsErrors.min_lesson_minutes}
                >
                  <NumberInput
                    value={settings.min_lesson_minutes}
                    onChange={(v) => handleSettingsChange("min_lesson_minutes", v)}
                    min={1}
                  />
                </FieldRow>

                <FieldRow
                  label="Max lesson length (minutes)"
                  error={settingsErrors.max_lesson_minutes}
                >
                  <NumberInput
                    value={settings.max_lesson_minutes}
                    onChange={(v) => handleSettingsChange("max_lesson_minutes", v)}
                    min={1}
                    max={120}
                  />
                  {!settingsErrors.max_lesson_minutes && (
                    <p className="mt-1 text-xs text-gray-400">
                      Must be ≥ min and ≤ 120.
                    </p>
                  )}
                </FieldRow>

                <FieldRow
                  label="Lesson length step (minutes)"
                  error={settingsErrors.lesson_step_minutes}
                >
                  <NumberInput
                    value={settings.lesson_step_minutes}
                    onChange={(v) => handleSettingsChange("lesson_step_minutes", v)}
                    min={1}
                  />
                </FieldRow>

                <FieldRow
                  label="Request expiry (hours)"
                  error={settingsErrors.request_expiry_hours}
                >
                  <NumberInput
                    value={settings.request_expiry_hours}
                    onChange={(v) => handleSettingsChange("request_expiry_hours", v)}
                    min={1}
                  />
                </FieldRow>
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={settingsSaving || !settingsDirty}
                  className="min-h-11 rounded-md bg-[#1b2d4f] px-5 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
                >
                  {settingsSaving ? "Saving…" : "Save settings"}
                </button>
                {!settingsDirty && !settingsSaving && (
                  <span className="text-xs text-gray-400">Saved</span>
                )}
              </div>
            </form>
          )}
        </section>
      </div>
    </AppShell>
  );
}
