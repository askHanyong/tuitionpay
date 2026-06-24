const pad = (n) => String(n).padStart(2, "0");

const toIcsDateTime = (date) =>
  `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;

const escapeIcsText = (text) =>
  String(text)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, "\\n");

export function buildLessonIcs({
  lesson,
  studentName,
  subject,
  lessonNumber,
  rate,
}) {
  const start = new Date(
    `${lesson.lesson_date}T${lesson.lesson_time ?? "09:00:00"}`,
  );
  const end = new Date(start.getTime() + lesson.duration_minutes * 60000);
  const durationHours = lesson.duration_minutes / 60;
  const expectedPayment =
    rate != null ? (rate * durationHours * 4).toFixed(2) : null;

  const title = `${studentName} - ${subject || "Lesson"} (Lesson ${lessonNumber} of 4)`;
  const descriptionParts = [`Lesson ${lessonNumber} of 4`];
  if (rate != null) descriptionParts.push(`Rate: $${rate}/hr`);
  if (expectedPayment != null)
    descriptionParts.push(`Expected payment: $${expectedPayment} at lesson 4`);
  const description = descriptionParts.join(" · ");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ChopeAndPay//Lesson Export//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:lesson-${lesson.id}@chopeandpay`,
    `DTSTAMP:${toIcsDateTime(new Date())}`,
    `DTSTART:${toIcsDateTime(start)}`,
    `DTEND:${toIcsDateTime(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

export function downloadIcs(filename, icsContent) {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
