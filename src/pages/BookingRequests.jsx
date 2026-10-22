import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import { formatSGTTime, formatSGTDate } from "../utils/sgt";
import { syncBookingToCalendar } from "../lib/bookingCalendar";
import { buildWhatsAppLink, normalizeWhatsAppNumber } from "../lib/whatsapp";

// ─── SGT helpers ─────────────────────────────────────────────────────────────

// parseTs: any DB timestamp string (UTC "Z", "+00:00", fractional seconds, or "+08:00") → epoch ms
function parseTs(s) { return new Date(s).getTime(); }

// toSGT: epoch ms → "YYYY-MM-DDTHH:MM:SS+08:00" (no slicing of raw DB strings)
function toSGT(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().slice(0, 19).replace("Z", "") + "+08:00";
}

function nowSGT() { return toSGT(Date.now()); }

// sgtParts: any DB timestamp → { str, date, time } all in Asia/Singapore.
// Use this as the ONE entry point whenever a request's start_at/end_at is
// displayed, used as lesson_date/lesson_time, or sliced for a date comparison.
// Never slice a raw DB string directly — Supabase returns UTC, slicing gives UTC values.
function sgtParts(s) {
  const str = toSGT(parseTs(s)); // "YYYY-MM-DDTHH:MM:SS+08:00"
  return {
    str,                        // full +08:00 string for formatSGTTime/formatSGTDate
    date: str.slice(0, 10),     // "YYYY-MM-DD" in SGT
    time: str.slice(11, 19),    // "HH:MM:SS"   in SGT
  };
}

// expiresInLabel: human-readable "expires in Xh" / "expires in Xm" from expires_at DB string
function expiresInLabel(expiresAtStr) {
  const msLeft = parseTs(expiresAtStr) - Date.now();
  if (msLeft <= 0) return null;
  const hours = Math.floor(msLeft / 3600_000);
  if (hours >= 1) return `expires in ${hours}h`;
  const mins = Math.ceil(msLeft / 60_000);
  return `expires in ${mins}m`;
}

// ─── WhatsApp message builders ───────────────────────────────────────────────

function buildConfirmMessage({ studentName, tutorName, dateStr, startStr, endStr }) {
  const date = formatSGTDate(dateStr);
  const start = formatSGTTime(startStr);
  const end = formatSGTTime(endStr);
  return (
    `Hi! Your lesson request for ${studentName} has been confirmed.\n` +
    `📅 ${date}\n` +
    `🕐 ${start} – ${end}\n\n` +
    `See you then! — ${tutorName || "Your tutor"}`
  );
}

function buildDeclineMessage({ studentName, tutorName, dateStr, startStr, endStr, note }) {
  const date = formatSGTDate(dateStr);
  const start = formatSGTTime(startStr);
  const end = formatSGTTime(endStr);
  const lines = [
    `Hi! Unfortunately the lesson request for ${studentName} on ${date} (${start} – ${end}) cannot be confirmed.`,
  ];
  if (note) lines.push(`Reason: ${note}`);
  lines.push(``, `Please feel free to book another slot. — ${tutorName || "Your tutor"}`);
  return lines.join("\n");
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }) {
  const map = {
    pending:   "bg-amber-100 text-amber-800",
    confirmed: "bg-green-100 text-green-800",
    declined:  "bg-red-100 text-red-800",
    expired:   "bg-gray-100 text-gray-500",
    cancelled: "bg-gray-100 text-gray-500",
  };
  const label = {
    pending:   "Awaiting",
    confirmed: "Confirmed",
    declined:  "Declined",
    expired:   "Expired",
    cancelled: "Cancelled",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? "bg-gray-100 text-gray-500"}`}>
      {label[status] ?? status}
    </span>
  );
}

// ─── Confirm modal ────────────────────────────────────────────────────────────

function ConfirmModal({ request, tutorName, onClose, onDone }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");
  const [loadingSubjects, setLoadingSubjects] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from("student_subjects")
        .select("id, subject, hourly_rate, rate_type, lesson_duration_hours")
        .eq("student_id", request.student_id)
        .eq("tutor_id", user.id)
        .order("created_at", { ascending: true });
      const rows = data ?? [];
      setSubjects(rows);
      setSubjectId(rows[0]?.id ?? "");
      setLoadingSubjects(false);
    }
    load();
  }, [request.student_id, user.id]);

  const selectedSubject = subjects.find((s) => s.id === subjectId) ?? subjects[0] ?? null;

  async function handleConfirm() {
    setError(null);
    setConfirming(true);

    // ── Step 1: re-load request — must still be pending and unexpired ─────
    const { data: reqRow, error: reqErr } = await supabase
      .from("booking_requests")
      .select("id, status, expires_at, start_at, end_at, student_id, tutor_id, parent_note, lesson_id")
      .eq("id", request.id)
      .single();

    if (reqErr || !reqRow) {
      setError("Could not load this request. Please refresh and try again.");
      setConfirming(false);
      return;
    }

    if (reqRow.status !== "pending") {
      setError(`This request has already been ${reqRow.status}.`);
      setConfirming(false);
      return;
    }

    const nowMs = Date.now();
    if (parseTs(reqRow.expires_at) <= nowMs) {
      setError("This request has expired.");
      setConfirming(false);
      return;
    }

    const startMs = parseTs(reqRow.start_at);
    const endMs   = parseTs(reqRow.end_at);
    const durationMinutes = Math.round((endMs - startMs) / 60_000);

    // ── Step 2: check for an existing non-cancelled lesson (half-finished) ─
    // sgtParts converts UTC DB string → SGT date/time; never slice raw DB strings.
    const { date: lessonDate, time: lessonTime } = sgtParts(reqRow.start_at);

    const { data: existingLesson } = await supabase
      .from("lessons")
      .select("id")
      .eq("tutor_id", reqRow.tutor_id)
      .eq("student_id", reqRow.student_id)
      .eq("lesson_date", lessonDate)
      .eq("lesson_time", lessonTime)
      .neq("status", "cancelled")
      .maybeSingle();

    let lessonId = existingLesson?.id ?? null;
    const reusingLesson = !!lessonId;

    if (!reusingLesson) {
      // ── Step 3: re-check overlap against non-cancelled lessons ──────────
      // lessonDate is already SGT (from sgtParts above), so the DB filter is correct.
      // Lesson start times are built with explicit +08:00 → epoch ms for comparison.
      // startMs/endMs come from parseTs (epoch ms), timezone-independent.
      const { data: overlapLessons } = await supabase
        .from("lessons")
        .select("lesson_date, lesson_time, duration_minutes, students(name)")
        .eq("tutor_id", reqRow.tutor_id)
        .eq("lesson_date", lessonDate)
        .not("lesson_time", "is", null)
        .neq("status", "cancelled");

      for (const l of (overlapLessons ?? [])) {
        // lesson_date + lesson_time are stored as SGT values; append +08:00 for correct epoch
        const ls = new Date(`${l.lesson_date}T${l.lesson_time}+08:00`).getTime();
        const le = ls + l.duration_minutes * 60_000;
        if (ls < endMs && le > startMs) {
          const name = l.students?.name ?? "another student";
          // sgtParts(reqRow.start_at).str is a +08:00 string — safe for formatSGTTime
          setError(`This time overlaps with ${name}'s lesson at ${formatSGTTime(sgtParts(reqRow.start_at).str)}. Cannot confirm.`);
          setConfirming(false);
          return;
        }
      }

      // ── Step 4: insert lesson ────────────────────────────────────────────
      const rate     = selectedSubject?.hourly_rate ?? null;
      const rateType = selectedSubject?.rate_type   ?? "hourly";
      const subjectText = selectedSubject?.subject  ?? null;
      const studentSubjectId = selectedSubject?.id  ?? null;

      const { data: newLesson, error: insertErr } = await supabase
        .from("lessons")
        .insert({
          tutor_id:           reqRow.tutor_id,
          student_id:         reqRow.student_id,
          student_subject_id: studentSubjectId,
          subject:            subjectText,
          lesson_date:        lessonDate,
          lesson_time:        lessonTime,
          duration_minutes:   durationMinutes,
          rate:               rate,
          rate_type:          rateType,
          lesson_mode:        "f2f",
          status:             "scheduled",
          is_completed:       false,
        })
        .select("id")
        .single();

      if (insertErr || !newLesson) {
        console.error("BookingRequests: lesson insert error", insertErr);
        setError("Could not create the lesson. Please try again.");
        setConfirming(false);
        return;
      }
      lessonId = newLesson.id;
    }

    // ── Step 5: conditional update — only if still pending ───────────────
    const { data: updatedRows, error: updateErr } = await supabase
      .from("booking_requests")
      .update({ status: "confirmed", lesson_id: lessonId, decided_at: nowSGT() })
      .eq("id", reqRow.id)
      .eq("status", "pending")
      .select("id");

    if (updateErr) {
      console.error("BookingRequests: request update error", updateErr);
      if (!reusingLesson) {
        await supabase.from("lessons").delete().eq("id", lessonId).eq("tutor_id", reqRow.tutor_id);
      }
      setError("Could not confirm the request. Please try again.");
      setConfirming(false);
      return;
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Concurrent confirm won the race — delete only a lesson we just created
      if (!reusingLesson) {
        await supabase.from("lessons").delete().eq("id", lessonId).eq("tutor_id", reqRow.tutor_id);
      }
      setError("This request was already confirmed by another action.");
      setConfirming(false);
      return;
    }

    // ── Step 6: calendar sync (non-fatal) ─────────────────────────────────
    const { data: studentRow } = await supabase
      .from("students")
      .select("name, address, guardian_contact")
      .eq("id", reqRow.student_id)
      .single();

    const calendarErr = await syncBookingToCalendar({
      tutorId:         reqRow.tutor_id,
      lessonId,
      lessonDate,
      lessonTime,
      durationMinutes,
      studentName:     studentRow?.name ?? "",
      subject:         selectedSubject?.subject ?? null,
      address:         studentRow?.address ?? null,
    });

    if (calendarErr) {
      console.warn("BookingRequests: calendar sync failed (non-fatal):", calendarErr);
    }

    showToast("Request confirmed and lesson created.", "celebrate");
    onDone({
      ...request,
      status: "confirmed",
      studentName: studentRow?.name ?? request.studentName,
      guardianContact: studentRow?.guardian_contact ?? null,
    });
  }

  // sgtParts converts UTC DB strings → SGT; never slice raw request.start_at/end_at
  const startSGT = sgtParts(request.start_at);
  const endSGT   = sgtParts(request.end_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-[#0f1e35]">Confirm booking</h2>
        <p className="mb-4 text-sm text-gray-500">
          {request.studentName} · {formatSGTDate(startSGT.date)},{" "}
          {formatSGTTime(startSGT.str)} – {formatSGTTime(endSGT.str)}
        </p>

        {loadingSubjects ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {subjects.length > 1 && (
              <div className="mb-4">
                <label className="mb-1 block text-xs font-medium text-gray-600">Subject</label>
                <select
                  className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                >
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.subject} — ${s.hourly_rate}/{s.rate_type === "per_session" ? "session" : "hr"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {subjects.length === 0 && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No subject configured for this student. The lesson will be created without a subject or rate. You can edit it afterwards.
              </p>
            )}

            {selectedSubject && (
              <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                <span className="font-medium">{selectedSubject.subject}</span>
                {" · "}
                {selectedSubject.rate_type === "per_session"
                  ? `$${selectedSubject.hourly_rate}/session`
                  : `$${selectedSubject.hourly_rate}/hr`}
                {" · "}{Math.round((parseTs(request.end_at) - parseTs(request.start_at)) / 60_000)} min
              </div>
            )}

            {error && (
              <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            {request.parent_note && (
              <div className="mb-4">
                <p className="mb-1 text-xs font-medium text-gray-500">Parent's note</p>
                <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{request.parent_note}</p>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || loadingSubjects}
            className="flex-1 rounded-xl bg-[#22c55e] py-2.5 text-sm font-semibold text-white hover:bg-[#16a34a] disabled:opacity-50"
          >
            {confirming ? "Confirming…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Decline modal ────────────────────────────────────────────────────────────

function DeclineModal({ request, onClose, onDone }) {
  const { showToast } = useToast();
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState(null);

  async function handleDecline() {
    setError(null);
    setDeclining(true);

    const { error: updateErr } = await supabase
      .from("booking_requests")
      .update({
        status:      "declined",
        tutor_note:  note.trim() || null,
        decided_at:  nowSGT(),
      })
      .eq("id", request.id)
      .eq("status", "pending");

    if (updateErr) {
      console.error("BookingRequests: decline error", updateErr);
      setError("Could not decline the request. Please try again.");
      setDeclining(false);
      return;
    }

    showToast("Request declined.");
    onDone({ ...request, status: "declined", tutor_note: note.trim() || null });
  }

  // sgtParts converts UTC DB strings → SGT; never slice raw request.start_at/end_at
  const startSGT = sgtParts(request.start_at);
  const endSGT   = sgtParts(request.end_at);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-1 text-base font-semibold text-[#0f1e35]">Decline request</h2>
        <p className="mb-4 text-sm text-gray-500">
          {request.studentName} · {formatSGTDate(startSGT.date)},{" "}
          {formatSGTTime(startSGT.str)} – {formatSGTTime(endSGT.str)}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Reason (optional — sent to parent)
          </label>
          <textarea
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none"
            rows={3}
            maxLength={300}
            placeholder="e.g. I'm unavailable that day. Please pick another slot."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDecline}
            disabled={declining}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            {declining ? "Declining…" : "Decline"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WhatsApp / Copy button ───────────────────────────────────────────────────

function ContactButton({ message, phone, label }) {
  const [copied, setCopied] = useState(false);
  const number = normalizeWhatsAppNumber(phone);

  if (number) {
    return (
      <a
        href={buildWhatsAppLink(message, phone)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#25d366] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1da851]"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.549 4.116 1.512 5.848L.057 23.25a.75.75 0 00.917.917l5.402-1.455A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.892 0-3.658-.498-5.19-1.37l-.37-.214-3.838 1.034 1.034-3.773-.228-.378A9.94 9.94 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
        </svg>
        {label ?? "WhatsApp parent"}
      </a>
    );
  }

  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(message);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // ignore
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
    >
      {copied ? "Copied!" : "Copy message"}
    </button>
  );
}

// ─── Request row ──────────────────────────────────────────────────────────────

function RequestRow({ req, tutorName, onConfirm, onDecline, isExpired }) {
  // sgtParts converts UTC DB strings → SGT; single entry point, no raw slicing below.
  const startSGT = sgtParts(req.start_at);
  const endSGT   = sgtParts(req.end_at);
  const nowMs    = Date.now();
  const expired  = isExpired || parseTs(req.expires_at) <= nowMs;
  const expiryLabel = !expired && req.status === "pending"
    ? expiresInLabel(req.expires_at)
    : null;

  const showConfirmDecline = req.status === "pending" && !expired;

  // WhatsApp message builders receive +08:00 strings and SGT date string
  const confirmMsg = buildConfirmMessage({
    studentName: req.studentName,
    tutorName,
    dateStr:  startSGT.date,
    startStr: startSGT.str,
    endStr:   endSGT.str,
  });
  const declineMsg = buildDeclineMessage({
    studentName: req.studentName,
    tutorName,
    dateStr:  startSGT.date,
    startStr: startSGT.str,
    endStr:   endSGT.str,
    note:     req.tutor_note,
  });

  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#0f1e35]">{req.studentName}</p>
          <p className="text-xs text-gray-500">
            {formatSGTDate(startSGT.date)}, {formatSGTTime(startSGT.str)} – {formatSGTTime(endSGT.str)}
          </p>
          {expiryLabel && (
            <p className="text-xs text-amber-600">{expiryLabel}</p>
          )}
          {req.parent_note && (
            <p className="mt-1 text-xs italic text-gray-400">"{req.parent_note}"</p>
          )}
        </div>
        <div className="shrink-0 pt-0.5">
          {expired && req.status === "pending"
            ? <StatusChip status="expired" />
            : <StatusChip status={req.status} />
          }
        </div>
      </div>

      {showConfirmDecline && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onConfirm(req)}
            className="flex-1 rounded-lg bg-[#22c55e] py-2 text-xs font-semibold text-white hover:bg-[#16a34a]"
          >
            Confirm
          </button>
          <button
            onClick={() => onDecline(req)}
            className="flex-1 rounded-lg border border-red-200 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
          >
            Decline
          </button>
        </div>
      )}

      {req.status === "confirmed" && (
        <div className="mt-3">
          <ContactButton
            message={confirmMsg}
            phone={req.guardianContact}
            label="WhatsApp parent"
          />
        </div>
      )}

      {req.status === "declined" && (
        <div className="mt-3">
          <ContactButton
            message={declineMsg}
            phone={req.guardianContact}
            label="WhatsApp parent"
          />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function BookingRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [studentsMap, setStudentsMap] = useState({}); // id → { name, guardian_contact }
  const [tutorName, setTutorName] = useState("");
  const [loading, setLoading] = useState(true);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const [declineTarget, setDeclineTarget] = useState(null);

  const load = useCallback(async () => {
    const sevenDaysAgo = toSGT(Date.now() - 7 * 24 * 3600_000).slice(0, 10);

    const [
      { data: reqData },
      { data: tutorRow },
    ] = await Promise.all([
      supabase
        .from("booking_requests")
        .select("id, student_id, start_at, end_at, status, parent_note, tutor_note, expires_at, decided_at, lesson_id")
        .eq("tutor_id", user.id)
        .or(
          // All pending (including expired ones not yet cleaned up)
          `status.eq.pending,` +
          // Confirmed / declined within last 7 days
          `and(status.in.(confirmed,declined),decided_at.gte.${sevenDaysAgo})`
        )
        .order("start_at", { ascending: true }),
      supabase
        .from("tutors")
        .select("full_name")
        .eq("id", user.id)
        .single(),
    ]);

    setTutorName(tutorRow?.full_name ?? "");

    const rows = reqData ?? [];
    const studentIds = [...new Set(rows.map((r) => r.student_id))];

    let sMap = {};
    if (studentIds.length > 0) {
      const { data: stuData } = await supabase
        .from("students")
        .select("id, name, guardian_contact")
        .in("id", studentIds);
      for (const s of stuData ?? []) {
        sMap[s.id] = { name: s.name, guardianContact: s.guardian_contact };
      }
    }

    setStudentsMap(sMap);
    setRequests(rows);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { load(); }, [load]);

  function enrichReq(r) {
    const stu = studentsMap[r.student_id] ?? {};
    return {
      ...r,
      studentName:     stu.name ?? "Unknown student",
      guardianContact: stu.guardianContact ?? null,
    };
  }

  function handleConfirmDone(updated) {
    setRequests((prev) => prev.map((r) => r.id === updated.id ? { ...r, status: updated.status, lesson_id: updated.lesson_id } : r));
    setConfirmTarget(null);
  }

  function handleDeclineDone(updated) {
    setRequests((prev) => prev.map((r) => r.id === updated.id ? { ...r, status: "declined", tutor_note: updated.tutor_note, decided_at: nowSGT() } : r));
    setDeclineTarget(null);
  }

  const nowMs = Date.now();

  const pending = requests.filter(
    (r) => r.status === "pending" && parseTs(r.expires_at) > nowMs,
  ).map(enrichReq);

  const expired = requests.filter(
    (r) => r.status === "pending" && parseTs(r.expires_at) <= nowMs,
  ).map(enrichReq);

  const recent = requests.filter(
    (r) => r.status === "confirmed" || r.status === "declined",
  ).map(enrichReq);

  return (
    <AppShell>
      <div className="space-y-6">
        <h1 className="text-xl font-bold text-[#0f1e35]">Booking Requests</h1>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {/* Pending */}
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Pending
                {pending.length > 0 && (
                  <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    {pending.length}
                  </span>
                )}
              </h2>
              {pending.length === 0 && expired.length === 0 ? (
                <p className="text-sm text-gray-400">No pending requests.</p>
              ) : (
                <div className="space-y-3">
                  {pending.map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      tutorName={tutorName}
                      onConfirm={(req) => setConfirmTarget(req)}
                      onDecline={(req) => setDeclineTarget(req)}
                      isExpired={false}
                    />
                  ))}
                  {expired.map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      tutorName={tutorName}
                      onConfirm={() => {}}
                      onDecline={() => {}}
                      isExpired={true}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Recent (confirmed / declined last 7 days) */}
            {recent.length > 0 && (
              <section>
                <h2 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">
                  Recent (last 7 days)
                </h2>
                <div className="space-y-3">
                  {recent.map((r) => (
                    <RequestRow
                      key={r.id}
                      req={r}
                      tutorName={tutorName}
                      onConfirm={() => {}}
                      onDecline={() => {}}
                      isExpired={false}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {confirmTarget && (
        <ConfirmModal
          request={confirmTarget}
          tutorName={tutorName}
          onClose={() => setConfirmTarget(null)}
          onDone={handleConfirmDone}
        />
      )}

      {declineTarget && (
        <DeclineModal
          request={declineTarget}
          onClose={() => setDeclineTarget(null)}
          onDone={handleDeclineDone}
        />
      )}
    </AppShell>
  );
}
