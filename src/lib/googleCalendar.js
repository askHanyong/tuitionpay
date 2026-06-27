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

// Looks for any existing Google Calendar event overlapping [startISO, endISO).
// Returns the first conflicting event ({ title, start }) or null.
export async function findCalendarConflict(accessToken, startISO, endISO) {
  const params = new URLSearchParams({
    timeMin: startISO,
    timeMax: endISO,
    singleEvents: "true",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to check Google Calendar for conflicts.",
    );
  }
  const { items = [] } = await res.json();
  const conflict = items.find((event) => {
    const eventStart = event.start?.dateTime || event.start?.date;
    const eventEnd = event.end?.dateTime || event.end?.date;
    if (!eventStart || !eventEnd) return false;
    return (
      new Date(eventStart) < new Date(endISO) &&
      new Date(eventEnd) > new Date(startISO)
    );
  });
  if (!conflict) return null;
  return {
    title: conflict.summary || "Untitled event",
    start: conflict.start?.dateTime || conflict.start?.date,
  };
}

export async function createCalendarEvent(
  accessToken,
  { summary, description, start, end, timeZone = "Asia/Singapore" },
) {
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary,
        description,
        start: { dateTime: start, timeZone },
        end: { dateTime: end, timeZone },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error?.message || "Failed to create Google Calendar event.",
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
