// booking-request.js  POST { token, start, end, note }
// Validates and inserts a booking request from a parent.
// All validations run on the server; nothing from the browser is trusted.

// ─── PostgREST helpers ───────────────────────────────────────────────────────

function pgHeaders(key) {
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

async function pgGet(base, key, path) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    headers: pgHeaders(key),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`PostgREST GET failed ${res.status}: ${body}`);
  }
  return res.json();
}

async function pgPost(base, key, path, body, prefer) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: "POST",
    headers: { ...pgHeaders(key), "Prefer": prefer ?? "return=representation" },
    body: JSON.stringify(body),
  });
  return res;
}

async function pgPatch(base, key, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...pgHeaders(key), "Prefer": "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PostgREST PATCH failed ${res.status}: ${text}`);
  }
}

// ─── Time helpers ────────────────────────────────────────────────────────────

function parseTs(s) { return new Date(s).getTime(); }

function sgtDateOf(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}

function lessonToMs(lessonDate, lessonTime) {
  return new Date(`${lessonDate}T${lessonTime}+08:00`).getTime();
}

// Produce a "+08:00" timestamp string from epoch ms, for DB insertion.
function toSGT(ms) {
  // Build the string manually from the UTC+8 instant.
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().slice(0, 19).replace("Z", "") + "+08:00";
}

// ─── Interval helpers ────────────────────────────────────────────────────────

function subtract(free, blocked) {
  let segs = [free];
  for (const [bs, be] of blocked) {
    const next = [];
    for (const [fs, fe] of segs) {
      if (be <= fs || bs >= fe) {
        next.push([fs, fe]);
      } else {
        if (fs < bs) next.push([fs, bs]);
        if (be < fe) next.push([be, fe]);
      }
    }
    segs = next;
  }
  return segs;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  min_notice_hours:     48,
  max_book_days_ahead:  14,
  view_days_ahead:      28,
  min_lesson_minutes:   60,
  max_lesson_minutes:   120,
  lesson_step_minutes:  30,
  request_expiry_hours: 48,
};

function err(msg, status = 400) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: false, error: msg }),
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("booking-request: missing env vars");
    return err("Server misconfiguration.", 500);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return err("Invalid request body.");
  }

  const { token, start, end, note } = body;

  if (!token || typeof token !== "string") return err("Missing token.");
  if (!start  || typeof start  !== "string") return err("Missing start time.");
  if (!end    || typeof end    !== "string") return err("Missing end time.");

  // Sanitise note: trim, max 500 chars, plain text only.
  const cleanNote = typeof note === "string"
    ? note.trim().slice(0, 500)
    : null;

  // ── 1. Look up the booking link ───────────────────────────────────────────
  let linkRows;
  try {
    linkRows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_links?token=eq.${encodeURIComponent(token)}&is_active=eq.true&select=tutor_id,student_id&limit=1`,
    );
  } catch (e) {
    console.error("booking-request: link lookup error", e.message);
    return err("This booking link isn't active. Please contact your tutor.");
  }

  if (!linkRows || linkRows.length === 0) {
    // Identical message for unknown/inactive/tampered tokens.
    return err("This booking link isn't active. Please contact your tutor.");
  }

  const { tutor_id, student_id } = linkRows[0];

  // ── 2. Mark overdue requests expired (best-effort) ────────────────────────
  try {
    await pgPatch(
      supabaseUrl, serviceRoleKey,
      `booking_requests?tutor_id=eq.${tutor_id}&status=eq.pending&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,
      { status: "expired" },
    );
  } catch (e) {
    console.error("booking-request: expire patch", e.message);
  }

  // ── 3. Load booking settings ──────────────────────────────────────────────
  let settings = { ...DEFAULT_SETTINGS };
  try {
    const rows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_settings?tutor_id=eq.${tutor_id}&limit=1`,
    );
    if (rows?.[0]) {
      const r = rows[0];
      settings = {
        min_notice_hours:     r.min_notice_hours     ?? DEFAULT_SETTINGS.min_notice_hours,
        max_book_days_ahead:  r.max_book_days_ahead  ?? DEFAULT_SETTINGS.max_book_days_ahead,
        view_days_ahead:      r.view_days_ahead       ?? DEFAULT_SETTINGS.view_days_ahead,
        min_lesson_minutes:   r.min_lesson_minutes   ?? DEFAULT_SETTINGS.min_lesson_minutes,
        max_lesson_minutes:   r.max_lesson_minutes   ?? DEFAULT_SETTINGS.max_lesson_minutes,
        lesson_step_minutes:  r.lesson_step_minutes  ?? DEFAULT_SETTINGS.lesson_step_minutes,
        request_expiry_hours: r.request_expiry_hours ?? DEFAULT_SETTINGS.request_expiry_hours,
      };
    }
  } catch (e) {
    console.error("booking-request: settings load", e.message);
  }

  // ── 4. Parse and validate start/end ──────────────────────────────────────
  const startMs = parseTs(start);
  const endMs   = parseTs(end);

  if (isNaN(startMs) || isNaN(endMs)) {
    return err("Invalid time format.");
  }
  if (endMs <= startMs) {
    return err("End time must be after start time.");
  }

  const nowMs            = Date.now();
  const durationMs       = endMs - startMs;
  const durationMinutes  = Math.round(durationMs / 60_000);

  // Duration bounds
  if (durationMinutes < settings.min_lesson_minutes) {
    return err(`Minimum lesson length is ${settings.min_lesson_minutes} minutes.`);
  }
  if (durationMinutes > settings.max_lesson_minutes) {
    return err(`Maximum lesson length is ${settings.max_lesson_minutes} minutes.`);
  }

  // Duration is a whole multiple of step
  if (durationMinutes % settings.lesson_step_minutes !== 0) {
    return err(`Lesson length must be a multiple of ${settings.lesson_step_minutes} minutes.`);
  }

  // Start is on the step grid (relative to SGT midnight of that day)
  const startSGTDate  = sgtDateOf(startMs);
  const sgtMidnightMs = new Date(`${startSGTDate}T00:00:00+08:00`).getTime();
  const offsetIntoDay = startMs - sgtMidnightMs;
  if (offsetIntoDay % (settings.lesson_step_minutes * 60_000) !== 0) {
    return err(`Start time must be on a ${settings.lesson_step_minutes}-minute interval.`);
  }

  // Minimum notice
  const minNoticeMs = settings.min_notice_hours * 3600_000;
  if (startMs < nowMs + minNoticeMs) {
    return err(`Please book at least ${settings.min_notice_hours} hours in advance.`);
  }

  // Max days ahead
  const maxBookMs = settings.max_book_days_ahead * 24 * 3600_000;
  if (startMs >= nowMs + maxBookMs) {
    return err(`You can only book up to ${settings.max_book_days_ahead} days ahead.`);
  }

  // ── 5. Pending request limit (max 3 per student) ──────────────────────────
  try {
    const pending = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_requests?student_id=eq.${student_id}&status=eq.pending&select=id`,
    );
    if ((pending ?? []).length >= 3) {
      return err("You already have 3 pending requests. Please wait for the tutor to respond before making more.");
    }
  } catch (e) {
    console.error("booking-request: pending count check", e.message);
    return err("Could not validate your request. Please try again.", 500);
  }

  // ── 6. Load availability windows for the lesson's date ───────────────────
  let windows = [];
  try {
    windows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `availability_windows?tutor_id=eq.${tutor_id}` +
      `&start_at=lte.${encodeURIComponent(new Date(endMs).toISOString())}` +
      `&end_at=gte.${encodeURIComponent(new Date(startMs).toISOString())}`,
    );
  } catch (e) {
    console.error("booking-request: windows load", e.message);
    return err("Could not check availability. Please try again.", 500);
  }

  // The request must fit entirely inside ONE availability window.
  const containingWindow = (windows ?? []).find(
    (w) => parseTs(w.start_at) <= startMs && parseTs(w.end_at) >= endMs,
  );
  if (!containingWindow) {
    return err("That time is outside the tutor's available hours.");
  }

  // ── 7. Load lessons that block this window ────────────────────────────────
  const lessonDateFrom = sgtDateOf(startMs);
  const lessonDateTo   = sgtDateOf(endMs);
  let blockingLessons = [];
  try {
    blockingLessons = await pgGet(
      supabaseUrl, serviceRoleKey,
      `lessons?tutor_id=eq.${tutor_id}` +
      `&lesson_date=gte.${lessonDateFrom}&lesson_date=lte.${lessonDateTo}` +
      `&lesson_time=not.is.null` +
      `&or=(status.is.null,status.neq.cancelled)` +
      `&select=lesson_date,lesson_time,duration_minutes`,
    );
  } catch (e) {
    console.error("booking-request: lessons load", e.message);
    return err("Could not check for conflicts. Please try again.", 500);
  }

  // ── 8. Load other pending requests for the tutor ─────────────────────────
  let tutorPending = [];
  try {
    tutorPending = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_requests?tutor_id=eq.${tutor_id}&status=eq.pending` +
      `&start_at=lt.${encodeURIComponent(new Date(endMs).toISOString())}` +
      `&end_at=gt.${encodeURIComponent(new Date(startMs).toISOString())}` +
      `&select=start_at,end_at,student_id`,
    );
  } catch (e) {
    console.error("booking-request: pending requests load", e.message);
    return err("Could not check for conflicts. Please try again.", 500);
  }

  // ── 9. Overlap check — specific messages per conflict type ───────────────
  const ws = parseTs(containingWindow.start_at);
  const we = parseTs(containingWindow.end_at);

  const lessonBlocked = (blockingLessons ?? []).map((l) => {
    const s = lessonToMs(l.lesson_date, l.lesson_time);
    return [s, s + l.duration_minutes * 60_000];
  });

  // Split pending requests into this student's own vs. others' (for specific messages).
  const ownPendingBlocked = (tutorPending ?? [])
    .filter((r) => r.student_id === student_id)
    .map((r) => [parseTs(r.start_at), parseTs(r.end_at)]);

  const otherPendingBlocked = (tutorPending ?? [])
    .filter((r) => r.student_id !== student_id)
    .map((r) => [parseTs(r.start_at), parseTs(r.end_at)]);

  const fits = (extraBlocked) =>
    subtract([ws, we], [...lessonBlocked, ...extraBlocked])
      .some(([fs, fe]) => fs <= startMs && fe >= endMs);

  if (!fits([])) {
    return err("That time overlaps with a scheduled lesson.");
  }
  if (!fits(ownPendingBlocked)) {
    return err("You already have a pending request for this time.");
  }
  if (!fits([...ownPendingBlocked, ...otherPendingBlocked])) {
    // Keep generic — do not reveal other students' requests.
    return err("That time is no longer available. Please choose another.");
  }

  // ── 10. Compute expires_at = min(now + expiry_hours, start_at) ────────────
  const expiryMs   = nowMs + settings.request_expiry_hours * 3600_000;
  const expiresMs  = Math.min(expiryMs, startMs);
  const expiresAt  = toSGT(expiresMs);
  const startAtStr = toSGT(startMs);
  const endAtStr   = toSGT(endMs);

  // ── 11. Insert the booking request ───────────────────────────────────────
  let insertRes;
  try {
    insertRes = await pgPost(
      supabaseUrl, serviceRoleKey,
      "booking_requests",
      {
        tutor_id,
        student_id,
        start_at:    startAtStr,
        end_at:      endAtStr,
        status:      "pending",
        parent_note: cleanNote || null,
        expires_at:  expiresAt,
      },
      "return=representation",
    );
  } catch (e) {
    console.error("booking-request: insert error", e.message);
    return err("Could not save your request. Please try again.", 500);
  }

  if (!insertRes.ok) {
    const resBody = await insertRes.text();
    // The DB exclusion constraint fires when there's a concurrent overlapping pending request.
    if (resBody.includes("no_overlapping_pending") || insertRes.status === 409) {
      return err("That time was just taken — please pick another slot.");
    }
    console.error("booking-request: insert failed", insertRes.status, resBody);
    return err("Could not save your request. Please try again.", 500);
  }

  // ── 12. Return success ────────────────────────────────────────────────────
  // INSERT succeeded. Wrap response construction in its own try/catch so that
  // no bug here can turn a successful save into a reported failure.
  try {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        request: {
          start:  startAtStr,
          end:    endAtStr,
          status: "pending",
        },
        expiryHours: settings.request_expiry_hours,
        // tutorName intentionally omitted: BookingPage already has it from page load.
      }),
    };
  } catch (e) {
    console.error("booking-request: post-insert response error", e.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true }),
    };
  }
};
