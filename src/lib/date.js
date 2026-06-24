export function formatDate(dateStr) {
  if (!dateStr) return "";
  const datePart = dateStr.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return dateStr;
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatLessonDateShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

export function formatLessonDates(lessonDates) {
  return lessonDates.map(formatLessonDateShort).join(", ");
}
