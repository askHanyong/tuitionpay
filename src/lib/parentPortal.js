// Helpers for the parent page (spec: parent-portal 4.1-4.2). Date-only strings
// ("YYYY-MM-DD") are always split, never passed to new Date().
import { formatSGD } from "./paymentNotice";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const parts = (s) => String(s).slice(0, 10).split("-").map(Number);

// "2026-10-06" -> "Tue 6 Oct"
export function fmtDay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = parts(dateStr);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DAYS[dow]} ${d} ${MONTHS_SHORT[m - 1]}`;
}

// "2026-10-01" -> "October"
export function fmtMonth(dateStr) {
  if (!dateStr) return "";
  return MONTHS_LONG[parts(dateStr)[1] - 1] ?? "";
}

// "16:00" -> "4:00 pm"; null -> ""
export function fmtTime12(time) {
  if (!time) return "";
  const [h, m] = String(time).split(":").map(Number);
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}

// $480 for whole amounts, $480.50 otherwise.
export function moneyShort(n) {
  return formatSGD(Number(n)).replace(/\.00$/, "");
}

// First letter of the first two words, upper-case.
export function initials(name) {
  return String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Copy that works in WhatsApp's in-app browser: clipboard API, then a hidden
// textarea + execCommand. Resolves true on success, false when both fail.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// covered = unpaid notices an open claim already covers; fresh = the rest.
export function splitUnpaid(pay) {
  const unpaid = pay?.unpaid ?? [];
  const through = pay?.claim?.covers_through;
  const covered = through ? unpaid.filter((n) => n.period_end <= through) : [];
  const fresh = through ? unpaid.filter((n) => n.period_end > through) : unpaid;
  const freshTotal = fresh.reduce((s, n) => s + Number(n.amount ?? 0), 0);
  return { covered, fresh, freshTotal };
}
