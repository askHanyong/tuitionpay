import { useEffect, useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { formatSGTTime, formatSGTDate } from "../utils/sgt.js";

function parseTsMs(s) { return new Date(s).getTime(); }

// Returns epoch ms for "YYYY-MM-DDT00:00:00+08:00" from a date string.
function sgtMidnightMs(dateStr) {
  return new Date(`${dateStr}T00:00:00+08:00`).getTime();
}

// Build a "+08:00" timestamp string from epoch ms — ONLY for API submission.
function toSGT(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().slice(0, 19) + "+08:00";
}

function msToTimeStr(ms) {
  const d = new Date(ms + 8 * 3600_000);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ─── Small components ─────────────────────────────────────────────────────────

function Chip({ children, color = "gray" }) {
  const cls = {
    green:  "bg-emerald-100 text-emerald-800",
    amber:  "bg-amber-100 text-amber-800",
    gray:   "bg-gray-100 text-gray-500",
    blue:   "bg-blue-100 text-blue-800",
  }[color] ?? "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

// ─── Booking form ─────────────────────────────────────────────────────────────

function BookingForm({ interval, settings, onSubmit, onCancel }) {
  const stepMs  = settings.lessonStepMinutes * 60_000;
  const minLenMs = settings.minLessonMinutes * 60_000;
  const maxLenMs = settings.maxLessonMinutes * 60_000;

  const ivStart = parseTsMs(interval.start);
  const ivEnd   = parseTsMs(interval.end);

  // Build list of valid start times (on the step grid, inside the interval,
  // with enough room for at least one min-length lesson).
  const startOptions = useMemo(() => {
    const opts = [];
    const midnight = sgtMidnightMs(interval.start.slice(0, 10));
    const offsetStart = ivStart - midnight;
    const firstStep   = Math.ceil(offsetStart / stepMs) * stepMs;
    for (let off = firstStep; midnight + off + minLenMs <= ivEnd; off += stepMs) {
      opts.push(midnight + off);
    }
    return opts;
  }, [interval, stepMs, minLenMs, ivStart, ivEnd]);

  const [startMs, setStartMs] = useState(startOptions[0] ?? ivStart);

  // Build list of valid durations for the chosen start.
  const durationOptions = useMemo(() => {
    const opts = [];
    for (
      let len = settings.minLessonMinutes;
      len <= settings.maxLessonMinutes && startMs + len * 60_000 <= ivEnd;
      len += settings.lessonStepMinutes
    ) {
      opts.push(len);
    }
    return opts;
  }, [startMs, ivEnd, settings]);

  const [durationMinutes, setDurationMinutes] = useState(
    durationOptions[0] ?? settings.minLessonMinutes,
  );
  // Keep duration valid when start changes.
  useEffect(() => {
    if (!durationOptions.includes(durationMinutes)) {
      setDurationMinutes(durationOptions[0] ?? settings.minLessonMinutes);
    }
  }, [durationOptions, durationMinutes, settings]);

  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const endMs = startMs + durationMinutes * 60_000;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit({
      start: toSGT(startMs),
      end:   toSGT(endMs),
      note:  note.trim() || null,
    });
    setSubmitting(false);
    if (result?.error) setSubmitError(result.error);
  };

  if (startOptions.length === 0 || durationOptions.length === 0) {
    return (
      <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
        This interval is too short for any available lesson length.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-lg border border-[#5ecfaa] bg-[#edf6f3] p-4"
    >
      <p className="text-xs font-semibold text-[#0f7a58]">Choose your time</p>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Start time
        </label>
        <select
          value={startMs}
          onChange={(e) => setStartMs(Number(e.target.value))}
          className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        >
          {startOptions.map((ms) => (
            <option key={ms} value={ms}>{msToTimeStr(ms)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Lesson length
        </label>
        <select
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        >
          {durationOptions.map((m) => (
            <option key={m} value={m}>
              {m >= 60
                ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}min` : ""}`
                : `${m} min`}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-md bg-white px-3 py-2 text-sm text-gray-700">
        <span className="font-medium">
          {msToTimeStr(startMs)} – {msToTimeStr(endMs)}
        </span>
        {" · "}
        {durationMinutes >= 60
          ? `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60 ? ` ${durationMinutes % 60}min` : ""}`
          : `${durationMinutes} min`}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Note for tutor (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          placeholder="Anything your tutor should know…"
          rows={2}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        />
        <p className="mt-0.5 text-right text-xs text-gray-400">{note.length}/500</p>
      </div>

      {submitError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {submitError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 flex-1 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Request this time"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const { token } = useParams();

  const [state, setState] = useState("loading"); // loading | inactive | ready | confirmed
  const [inactiveMessage, setInactiveMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [data, setData] = useState(null);

  // Which interval is open for the booking form.
  const [activeIntervalKey, setActiveIntervalKey] = useState(null);

  // The newly confirmed request (shown after success).
  const [confirmedRequest, setConfirmedRequest] = useState(null);

  // ── Load page data ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/.netlify/functions/booking-page?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          if (!cancelled) {
            setState("error");
            setErrorMessage("Something went wrong. Please try again later.");
          }
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        if (json.inactive) {
          setState("inactive");
          setInactiveMessage(json.message);
        } else {
          setData(json);
          setState("ready");
        }
      } catch {
        if (!cancelled) {
          setState("error");
          setErrorMessage("Could not load this page. Please check your connection.");
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Submit a booking request ───────────────────────────────────────────────
  const handleSubmitRequest = async ({ start, end, note }) => {
    let res;
    try {
      res = await fetch("/.netlify/functions/booking-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Token is sent as-is from useParams — it is the public booking token,
        // not a credential; the server re-validates it.
        body: JSON.stringify({ token, start, end, note }),
      });
    } catch {
      return { error: "Could not send your request. Please check your connection." };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      console.error("booking-request: non-JSON response, HTTP", res.status);
      return { error: "Something went wrong. Please try again." };
    }
    if (!json.ok) {
      if (!res.ok) console.error("booking-request: error response, HTTP", res.status, json);
      return { error: json.error ?? "Something went wrong. Please try again." };
    }
      // Success: add the new request to the list and show confirmation screen.
      setData((prev) => ({
        ...prev,
        upcomingRequests: [
          ...(prev.upcomingRequests ?? []),
          json.request,
        ],
      }));
      setConfirmedRequest({ ...json.request, expiryHours: json.expiryHours, tutorName: json.tutorName });
      setActiveIntervalKey(null);
      setState("confirmed");
      return null;
  };

  // ── Sorted dates with open intervals ──────────────────────────────────────
  const sortedDates = useMemo(() => {
    if (!data?.openByDate) return [];
    return Object.keys(data.openByDate).sort();
  }, [data]);

  // ─── Render states ─────────────────────────────────────────────────────────

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    );
  }

  if (state === "inactive" || state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-sm">
          <p className="text-2xl">🔒</p>
          <p className="mt-3 text-sm font-medium text-gray-700">
            {inactiveMessage || errorMessage || "This link is not available."}
          </p>
        </div>
      </div>
    );
  }

  const { tutorName, studentName, settings, upcomingLessons, upcomingRequests } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1b2d4f] px-4 py-5 text-white sm:px-6">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-medium text-white/60 uppercase tracking-wide">
            ChopeAndPay
          </p>
          <h1 className="mt-1 text-lg font-semibold">
            Book a lesson with {tutorName}
          </h1>
          <p className="mt-0.5 text-sm text-white/70">
            Student: {studentName}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-4 px-4 py-5 pb-16 sm:px-6">

        {/* Confirmation screen (shown after a request is submitted) */}
        {state === "confirmed" && confirmedRequest && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-base font-semibold text-emerald-800">
              ✅ Request sent!
            </p>
            <p className="mt-1 text-sm text-emerald-700">
              {confirmedRequest.tutorName ?? tutorName} will confirm within{" "}
              {confirmedRequest.expiryHours} hour{confirmedRequest.expiryHours === 1 ? "" : "s"}.
            </p>
            <p className="mt-2 text-sm text-emerald-800 font-medium">
              {formatSGTDate(confirmedRequest.start.slice(0, 10))}
              {" · "}
              {formatSGTTime(confirmedRequest.start)} – {formatSGTTime(confirmedRequest.end)}
            </p>
            <button
              onClick={() => setState("ready")}
              className="mt-3 min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Book another time
            </button>
          </div>
        )}

        {/* Upcoming lessons & requests */}
        {((upcomingLessons?.length ?? 0) > 0 || (upcomingRequests?.length ?? 0) > 0) && (
          <Section title="Your upcoming lessons">
            <ul className="space-y-2">
              {(upcomingLessons ?? []).map((l, i) => (
                <li key={`lesson-${i}`} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {formatSGTDate(l.date)}
                      {l.startTime && (
                        <span className="ml-1 font-normal text-gray-500">
                          · {formatSGTTime(`${l.date}T${l.startTime}+08:00`)}
                          {l.endTime && ` – ${formatSGTTime(`${l.date}T${l.endTime}+08:00`)}`}
                        </span>
                      )}
                    </p>
                    {l.subject && (
                      <p className="text-xs text-gray-500">{l.subject}</p>
                    )}
                  </div>
                  <Chip color={l.completed ? "green" : "blue"}>
                    {l.completed ? "Confirmed" : "Upcoming"}
                  </Chip>
                </li>
              ))}
              {(upcomingRequests ?? []).map((r, i) => (
                <li key={`req-${i}`} className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {formatSGTDate(r.start.slice(0, 10))}
                      <span className="ml-1 font-normal text-gray-500">
                        · {formatSGTTime(r.start)} – {formatSGTTime(r.end)}
                      </span>
                    </p>
                  </div>
                  <Chip color={r.status === "confirmed" ? "green" : "amber"}>
                    {r.status === "confirmed" ? "Confirmed" : "Awaiting confirmation"}
                  </Chip>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Open times */}
        <Section title="Open times">
          {sortedDates.length === 0 ? (
            <p className="text-sm text-gray-500">
              No available times in the next {settings.viewDaysAhead} days. Please contact your tutor directly.
            </p>
          ) : (
            <div className="space-y-4">
              {sortedDates.map((date) => {
                const intervals = data.openByDate[date] ?? [];
                return (
                  <div key={date}>
                    <p className="mb-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {formatSGTDate(date)}
                    </p>
                    <div className="space-y-2">
                      {intervals.map((iv, idx) => {
                        const key = `${date}-${idx}`;
                        const isActive = activeIntervalKey === key;

                        if (!iv.bookable) {
                          return (
                            <div
                              key={key}
                              className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 text-sm text-gray-400"
                            >
                              <span>
                                {formatSGTTime(iv.start)} – {formatSGTTime(iv.end)}
                              </span>
                              <span className="text-xs">{iv.reason}</span>
                            </div>
                          );
                        }

                        return (
                          <div key={key}>
                            <button
                              type="button"
                              onClick={() =>
                                setActiveIntervalKey(isActive ? null : key)
                              }
                              className={`flex min-h-11 w-full items-center justify-between rounded-lg border px-3 py-2.5 text-sm font-medium transition ${
                                isActive
                                  ? "border-[#5ecfaa] bg-[#d6ede6] text-[#0f7a58]"
                                  : "border-[#5ecfaa] bg-white text-[#0f7a58] hover:bg-[#edf6f3]"
                              }`}
                            >
                              <span>
                                {formatSGTTime(iv.start)} – {formatSGTTime(iv.end)}
                              </span>
                              <span className="text-xs">
                                {isActive ? "▲ Close" : "Tap to book →"}
                              </span>
                            </button>

                            {isActive && (
                              <BookingForm
                                interval={iv}
                                settings={settings}
                                onSubmit={handleSubmitRequest}
                                onCancel={() => setActiveIntervalKey(null)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </main>
    </div>
  );
}
