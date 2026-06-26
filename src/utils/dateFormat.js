function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

export function formatDate(date) {
  const d = toDate(date);
  return d.toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateFull(date) {
  const d = toDate(date);
  return d.toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function formatDateShort(date) {
  const d = toDate(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export function formatMonth(date) {
  const d = toDate(date);
  return d.toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}

function formatTime(d) {
  return d
    .toLocaleTimeString("en-SG", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s/g, "")
    .toLowerCase();
}

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function formatRelative(date, { includeTime = true } = {}) {
  const d = toDate(date);
  const now = new Date();

  const startOfDay = (dt) =>
    new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());

  const dayDiff = Math.round(
    (startOfDay(now) - startOfDay(d)) / (1000 * 60 * 60 * 24),
  );

  const suffix = includeTime ? ` at ${formatTime(d)}` : "";

  if (dayDiff === 0) return `Today${suffix}`;
  if (dayDiff === 1) return `Yesterday${suffix}`;
  if (dayDiff > 1 && dayDiff < 7)
    return `Last ${DAY_NAMES[d.getDay()]}${suffix}`;
  if (d.getFullYear() === now.getFullYear()) {
    const short = d.toLocaleDateString("en-SG", {
      day: "2-digit",
      month: "short",
    });
    return `${short}${suffix}`;
  }
  return formatDate(d);
}
