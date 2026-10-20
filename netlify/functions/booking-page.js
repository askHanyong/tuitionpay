// booking-page.js  GET ?token=...
// Returns shaped booking data for the parent-facing page.
// Never returns another student's name/lessons, fees, IDs, or raw DB rows.

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

// ─── Time helpers (all epoch-based, no .toISOString() for DB) ────────────────

// Parse any ISO string (including +08:00) → ms since epoch
function parseTs(s) { return new Date(s).getTime(); }

// Return an ISO string with explicit +08:00 for a given epoch ms.
// Used ONLY for display formatting, never written to DB directly.
function toSGTDisplay(ms) {
  const d = new Date(ms + 8 * 3600_000);
  return d.toISOString().replace("Z", "+08:00").slice(0, 19) + "+08:00";
}

// "YYYY-MM-DD" in SGT from epoch ms
function sgtDateOf(ms) {
  return toSGTDisplay(ms).slice(0, 10);
}

// Convert lesson_date ("YYYY-MM-DD") + lesson_time ("HH:MM:SS" or "HH:MM") → epoch ms
function lessonToMs(lessonDate, lessonTime) {
  return new Date(`${lessonDate}T${lessonTime}+08:00`).getTime();
}

// Epoch ms → "HH:MM" in SGT
function msToSGTTime(ms) {
  return toSGTDisplay(ms).slice(11, 16);
}

// ─── Interval helpers ────────────────────────────────────────────────────────

// Subtract a list of blocked [s,e] intervals from a single [s,e] free interval.
// Returns array of free sub-intervals.
function subtract(free, blocked) {
  let segs = [free];
  for (const [bs, be] of blocked) {
    const next = [];
    for (const [fs, fe] of segs) {
      if (be <= fs || bs >= fe) {
        next.push([fs, fe]); // no overlap
      } else {
        if (fs < bs) next.push([fs, bs]);
        if (be < fe) next.push([be, fe]);
      }
    }
    segs = next;
  }
  return segs;
}

// ─── Main logic ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  min_notice_hours:     48,
  max_book_days_ahead:  14,
  view_days_ahead:      28,
  min_lesson_minutes:   60,
  max_lesson_minutes:   120,
  lesson_step_minutes:  30,
  request_expiry_hours: 48,
};

const GENERIC_INACTIVE = "This booking link isn't active. Please contact your tutor.";

export const handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("booking-page: missing env vars");
    return { statusCode: 500, body: JSON.stringify({ error: "Server misconfiguration." }) };
  }

  const token = event.queryStringParameters?.token ?? "";
  if (!token) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inactive: true, message: GENERIC_INACTIVE }),
    };
  }

  // ── 1. Look up the booking link ──────────────────────────────────────────
  // Select only what we need; never return the token or IDs to the browser.
  let linkRows;
  try {
    linkRows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_links?token=eq.${encodeURIComponent(token)}&is_active=eq.true&select=tutor_id,student_id&limit=1`,
    );
  } catch (err) {
    console.error("booking-page: link lookup error", err.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inactive: true, message: GENERIC_INACTIVE }),
    };
  }

  if (!linkRows || linkRows.length === 0) {
    // Unknown, inactive, or tampered token — all get the same message.
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inactive: true, message: GENERIC_INACTIVE }),
    };
  }

  const { tutor_id, student_id } = linkRows[0];

  // ── 2. Mark overdue requests expired ─────────────────────────────────────
  try {
    await pgPatch(
      supabaseUrl, serviceRoleKey,
      `booking_requests?tutor_id=eq.${tutor_id}&status=eq.pending&expires_at=lt.${encodeURIComponent(new Date().toISOString())}`,
      { status: "expired" },
    );
  } catch (err) {
    // Non-fatal — log and continue.
    console.error("booking-page: expire patch error", err.message);
  }

  // ── 3. Load booking settings ─────────────────────────────────────────────
  let settings = { ...DEFAULT_SETTINGS };
  try {
    const rows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_settings?tutor_id=eq.${tutor_id}&limit=1`,
    );
    if (rows && rows.length > 0) {
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
  } catch (err) {
    console.error("booking-page: settings load error", err.message);
    // Use defaults — not fatal.
  }

  // ── 4. Compute time range ────────────────────────────────────────────────
  const nowMs         = Date.now();
  // "yesterday" in SGT — back one full day so midnight-crossing lessons are included.
  const rangeStartMs  = nowMs - 24 * 3600_000;
  // End of last viewable day in SGT.
  const rangeEndMs    = nowMs + settings.view_days_ahead * 24 * 3600_000;

  // PostgREST-safe ISO strings (UTC) for range queries.
  const rangeStartISO = new Date(rangeStartMs).toISOString();
  const rangeEndISO   = new Date(rangeEndMs).toISOString();
  // lesson_date range in SGT (date strings).
  const lessonDateFrom = sgtDateOf(rangeStartMs);
  const lessonDateTo   = sgtDateOf(rangeEndMs);

  // ── 5. Load tutor display name + student name ────────────────────────────
  let tutorName = "Your tutor";
  let studentName = "Student";
  try {
    const [tutorRows, studentRows] = await Promise.all([
      pgGet(supabaseUrl, serviceRoleKey,
        `tutors?id=eq.${tutor_id}&select=full_name&limit=1`),
      pgGet(supabaseUrl, serviceRoleKey,
        `students?id=eq.${student_id}&tutor_id=eq.${tutor_id}&select=name&limit=1`),
    ]);
    if (tutorRows?.[0]?.full_name) tutorName = tutorRows[0].full_name;
    if (studentRows?.[0]?.name)   studentName = studentRows[0].name;
  } catch (err) {
    console.error("booking-page: name load error", err.message);
  }

  // ── 6. Load availability windows ─────────────────────────────────────────
  let windows = [];
  try {
    windows = await pgGet(
      supabaseUrl, serviceRoleKey,
      `availability_windows?tutor_id=eq.${tutor_id}&start_at=gte.${encodeURIComponent(rangeStartISO)}&start_at=lte.${encodeURIComponent(rangeEndISO)}&order=start_at`,
    );
  } catch (err) {
    console.error("booking-page: windows load error", err.message);
  }

  // ── 7. Load lessons that block time (has lesson_time, not cancelled) ──────
  // PostgREST: or=(status.is.null,status.neq.cancelled)
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
  } catch (err) {
    console.error("booking-page: lessons load error", err.message);
  }

  // ── 8. Load pending booking requests for the tutor ────────────────────────
  let tutorPending = [];
  try {
    tutorPending = await pgGet(
      supabaseUrl, serviceRoleKey,
      `booking_requests?tutor_id=eq.${tutor_id}&status=eq.pending` +
      `&start_at=gte.${encodeURIComponent(rangeStartISO)}&start_at=lte.${encodeURIComponent(rangeEndISO)}` +
      `&select=start_at,end_at`,
    );
  } catch (err) {
    console.error("booking-page: tutor pending load error", err.message);
  }

  // ── 9. Load THIS student's own upcoming lessons + requests ───────────────
  let studentLessons = [];
  let studentRequests = [];
  try {
    [studentLessons, studentRequests] = await Promise.all([
      pgGet(
        supabaseUrl, serviceRoleKey,
        `lessons?student_id=eq.${student_id}&tutor_id=eq.${tutor_id}` +
        `&lesson_date=gte.${sgtDateOf(nowMs)}` +
        `&select=lesson_date,lesson_time,duration_minutes,subject,is_completed` +
        `&order=lesson_date,lesson_time`,
      ),
      pgGet(
        supabaseUrl, serviceRoleKey,
        `booking_requests?student_id=eq.${student_id}&tutor_id=eq.${tutor_id}` +
        `&status=in.(pending,confirmed)` +
        `&start_at=gte.${encodeURIComponent(new Date(nowMs).toISOString())}` +
        `&select=start_at,end_at,status` +
        `&order=start_at`,
      ),
    ]);
  } catch (err) {
    console.error("booking-page: student data load error", err.message);
  }

  // ── 10. Build blocked intervals list (epoch ms pairs) ────────────────────
  const blocked = [];

  for (const l of (blockingLessons ?? [])) {
    const s = lessonToMs(l.lesson_date, l.lesson_time);
    const e = s + l.duration_minutes * 60_000;
    blocked.push([s, e]);
  }
  for (const r of (tutorPending ?? [])) {
    blocked.push([parseTs(r.start_at), parseTs(r.end_at)]);
  }
  // Sort for determinism (subtract() doesn't require it but keeps things clean)
  blocked.sort((a, b) => a[0] - b[0]);

  // ── 11. Clip windows into free bookable intervals ─────────────────────────
  const minNoticeMs   = settings.min_notice_hours   * 3600_000;
  const maxBookMs     = settings.max_book_days_ahead * 24 * 3600_000;
  const minLenMs      = settings.min_lesson_minutes  * 60_000;
  const stepMs        = settings.lesson_step_minutes * 60_000;

  const earliestBookable = nowMs + minNoticeMs;
  const latestBookable   = nowMs + maxBookMs;

  const openIntervals = [];

  for (const w of (windows ?? [])) {
    const ws = parseTs(w.start_at);
    const we = parseTs(w.end_at);

    // Blocked intervals that overlap this window
    const windowBlocked = blocked.filter(([bs, be]) => be > ws && bs < we);

    const freeSegs = subtract([ws, we], windowBlocked);

    for (const [fs, fe] of freeSegs) {
      if (fe - fs < minLenMs) continue; // too short overall — skip

      // Split each free segment into three pieces:
      //   [fs .. min(fe, earliestBookable)]  → too soon
      //   [max(fs, earliestBookable) .. min(fe, latestBookable)]  → bookable
      //   [max(fs, latestBookable) .. fe]  → too far ahead
      const pieces = [];

      if (fs < earliestBookable) {
        // There's a "too soon" prefix
        const tooSoonEnd = Math.min(fe, earliestBookable);
        if (tooSoonEnd - fs >= minLenMs) {
          pieces.push({
            start: toSGTDisplay(fs),
            end:   toSGTDisplay(tooSoonEnd),
            bookable: false,
            reason: "Too soon — book at least " + settings.min_notice_hours + "h ahead",
          });
        }
      }

      // Bookable core
      const bookStart = Math.max(fs, earliestBookable);
      const bookEnd   = Math.min(fe, latestBookable);
      if (bookEnd > bookStart) {
        // Snap bookStart up to the next step grid boundary (SGT midnight = 00:00+08:00 = UTC 16:00 prev day)
        // Grid origin: SGT midnight of that day
        const sgtMidnightMs = new Date(sgtDateOf(bookStart) + "T00:00:00+08:00").getTime();
        const offsetIntoDay = bookStart - sgtMidnightMs;
        const stepsIn       = Math.ceil(offsetIntoDay / stepMs);
        const snappedStart  = sgtMidnightMs + stepsIn * stepMs;

        if (bookEnd - snappedStart >= minLenMs) {
          pieces.push({
            start:    toSGTDisplay(snappedStart),
            end:      toSGTDisplay(bookEnd),
            bookable: true,
          });
        }
      }

      if (fe > latestBookable) {
        const tooFarStart = Math.max(fs, latestBookable);
        if (fe - tooFarStart >= minLenMs) {
          pieces.push({
            start: toSGTDisplay(tooFarStart),
            end:   toSGTDisplay(fe),
            bookable: false,
            reason: "Not open for booking yet",
          });
        }
      }

      openIntervals.push(...pieces);
    }
  }

  // Group by SGT date for easier rendering
  const byDate = {};
  for (const interval of openIntervals) {
    const d = interval.start.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(interval);
  }

  // ── 12. Shape student's upcoming lessons (no fees) ────────────────────────
  const upcomingLessons = (studentLessons ?? []).map((l) => ({
    date:      l.lesson_date,
    startTime: l.lesson_time ? l.lesson_time.slice(0, 5) : null,
    endTime:   l.lesson_time
      ? msToSGTTime(lessonToMs(l.lesson_date, l.lesson_time) + l.duration_minutes * 60_000)
      : null,
    durationMinutes: l.duration_minutes,
    subject:   l.subject ?? null,
    completed: l.is_completed,
  }));

  const upcomingRequests = (studentRequests ?? []).map((r) => ({
    start:  r.start_at,
    end:    r.end_at,
    status: r.status,
  }));

  // ── 13. Return shaped payload ─────────────────────────────────────────────
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tutorName,
      studentName,
      settings: {
        minNoticeHours:     settings.min_notice_hours,
        maxBookDaysAhead:   settings.max_book_days_ahead,
        viewDaysAhead:      settings.view_days_ahead,
        minLessonMinutes:   settings.min_lesson_minutes,
        maxLessonMinutes:   settings.max_lesson_minutes,
        lessonStepMinutes:  settings.lesson_step_minutes,
        requestExpiryHours: settings.request_expiry_hours,
      },
      openByDate: byDate,
      upcomingLessons,
      upcomingRequests,
    }),
  };
};
