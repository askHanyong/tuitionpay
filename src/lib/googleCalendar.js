import { supabase } from "./supabase";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const REDIRECT_URI = "https://chopeandpay.com/auth/google/callback";
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

export function buildGoogleAuthUrl() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function callTokenFunction(body) {
  const res = await fetch("/.netlify/functions/google-auth-callback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Google Calendar request failed.");
  }
  return data;
}

export async function exchangeCodeForTokens(code) {
  return callTokenFunction({ code });
}

export function isGoogleConnected(tutor) {
  return Boolean(tutor?.google_calendar_tokens?.access_token);
}

// Returns a valid access token for the tutor's stored Google Calendar
// connection, refreshing (and persisting) it first if it has expired.
// Returns null if the tutor has never connected Google Calendar.
export async function getValidAccessToken(tutorId, tokens) {
  if (!tokens?.access_token) return null;
  const expiresInMs = (tokens.expiry_date ?? 0) - Date.now();
  if (expiresInMs > 60_000) return tokens.access_token;
  if (!tokens.refresh_token) return tokens.access_token;

  const refreshed = await callTokenFunction({
    refresh_token: tokens.refresh_token,
  });
  const nextTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: refreshed.expiry_date,
  };
  await supabase
    .from("tutors")
    .update({ google_calendar_tokens: nextTokens })
    .eq("id", tutorId);
  return nextTokens.access_token;
}

export async function disconnectGoogleCalendar(tutorId) {
  const { error } = await supabase
    .from("tutors")
    .update({ google_calendar_tokens: null })
    .eq("id", tutorId);
  if (error) throw error;
}

// Lists every calendar the tutor has access to (primary, secondary, shared)
// so the free/busy check below isn't limited to just their primary
// calendar. Falls back to ["primary"] if this lookup fails.
async function listCalendarIds(accessToken) {
  try {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return ["primary"];
    const { items = [] } = await res.json();
    const ids = items.map((cal) => cal.id).filter(Boolean);
    return ids.length > 0 ? ids : ["primary"];
  } catch {
    return ["primary"];
  }
}

// Uses the free/busy API (rather than listing events on a single calendar)
// so the check covers every calendar the tutor has access to -- secondary,
// shared, etc. -- not just their primary one. free/busy only reports
// busy/free slots, not event details, so callers get a boolean rather than
// an event title.
export async function findCalendarConflict(accessToken, startISO, endISO) {
  const calendarIds = await listCalendarIds(accessToken);

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startISO,
      timeMax: endISO,
      timeZone: "Asia/Singapore",
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to check Google Calendar for conflicts.",
    );
  }
  const { calendars = {} } = await res.json();
  return Object.values(calendars).some((calendar) =>
    (calendar.busy ?? []).some(
      (slot) =>
        new Date(slot.start) < new Date(endISO) &&
        new Date(slot.end) > new Date(startISO),
    ),
  );
}

export async function createCalendarEvent(
  accessToken,
  { summary, description, location, start, end, timeZone = "Asia/Singapore", createMeetLink = false, meetRequestId },
) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
  );
  if (createMeetLink) url.searchParams.set("conferenceDataVersion", "1");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary,
      description,
      ...(location ? { location } : {}),
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      ...(createMeetLink
        ? { conferenceData: { createRequest: { requestId: meetRequestId || crypto.randomUUID() } } }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to create Google Calendar event.",
    );
  }
  return res.json();
}

// PATCHes an existing event. location is always included (even as an empty
// string) so that clearing a student's address removes it from the event --
// PATCH only touches fields present in the body, so omitting it would leave
// a stale address behind.
export async function updateCalendarEvent(
  accessToken,
  eventId,
  { summary, description, location, start, end, timeZone = "Asia/Singapore", createMeetLink = false, meetRequestId },
) {
  const url = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
  );
  if (createMeetLink) url.searchParams.set("conferenceDataVersion", "1");

  const res = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      summary,
      description,
      location: location || "",
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
      ...(createMeetLink
        ? { conferenceData: { createRequest: { requestId: meetRequestId || crypto.randomUUID() } } }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to update Google Calendar event.",
    );
  }
  return res.json();
}

export async function deleteCalendarEvent(accessToken, eventId) {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  // 404/410 just means the event is already gone -- treat as success.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to delete Google Calendar event.",
    );
  }
}
