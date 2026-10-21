// Shared Singapore-time display helpers.
// All formatSGT* functions require a "+08:00" ISO timestamp string —
// never a raw UTC string from the DB. booking-page.js always emits +08:00
// strings; any client code that constructs a timestamp must append "+08:00"
// explicitly before calling these.
// Slicing chars 11-16 from a "...T12:00:00+08:00" string is safe and
// avoids any device-timezone influence on display.

/**
 * "...T12:00:00+08:00" → "12:00 PM"  (12h, no device TZ)
 */
export function formatSGTTime(tsStr) {
  if (!tsStr) return "";
  const timePart = tsStr.slice(11, 16); // "HH:MM"
  const [h, min] = timePart.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

/**
 * "YYYY-MM-DD" → "Mon, 20 Oct 2026"
 * Uses the local Date constructor (no timezone shift) — date-only, no time.
 */
export function formatSGTDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-SG", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
