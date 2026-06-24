const GOOGLE_CLIENT_ID =
  "328753347113-dlac4p6e3nc16plef1tt7obh33gjenl4.apps.googleusercontent.com";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GSI_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gsiLoadPromise = null;

function loadGsiScript() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Google Identity Services."));
    document.head.appendChild(script);
  });
  return gsiLoadPromise;
}

export async function requestGoogleCalendarAccess() {
  await loadGsiScript();
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_CALENDAR_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        resolve({
          accessToken: response.access_token,
          expiresAt: new Date(
            Date.now() + Number(response.expires_in) * 1000,
          ).toISOString(),
        });
      },
      error_callback: (error) => {
        reject(new Error(error.message || "Google sign-in was cancelled."));
      },
    });
    tokenClient.requestAccessToken();
  });
}

export function revokeGoogleCalendarAccess(accessToken) {
  if (!accessToken || !window.google?.accounts?.oauth2) return;
  window.google.accounts.oauth2.revoke(accessToken);
}

export function isGoogleTokenValid(tutor) {
  if (!tutor?.google_access_token || !tutor?.google_token_expiry) return false;
  return new Date(tutor.google_token_expiry).getTime() > Date.now();
}

export async function createCalendarEvent(
  accessToken,
  { summary, description, start, end },
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
        start: { dateTime: start },
        end: { dateTime: end },
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
