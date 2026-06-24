import { formatLessonDates } from "./date";

export function formatSGD(amount) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(amount);
}

export function buildPaymentNoticeMessage({
  studentName,
  lessonDates,
  amountDue,
  paynowNumber,
  tutorName,
}) {
  const lines = [
    `Hi! This is a payment reminder for ${studentName}'s tuition.`,
    "",
    `4 lessons (${formatLessonDates(lessonDates ?? [])}) have been completed.`,
    "",
    `Amount due: ${formatSGD(amountDue)}.`,
  ];
  if (paynowNumber) {
    lines.push("", `Payment can be made via PayNow: ${paynowNumber}`);
  }
  lines.push(
    "",
    "Please make payment at your earliest convenience. Thank you!",
  );
  if (tutorName) {
    lines.push("", tutorName);
  }
  return lines.join("\n");
}
