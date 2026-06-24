import { formatSGD } from "./paymentNotice";
import { formatLessonDates } from "./date";

function studentLabel(studentName, subject) {
  return subject ? `${studentName} (${subject})` : studentName;
}

export function buildPaidReceiptMessage({
  studentName,
  subject,
  lessonDates,
  amountDue,
  tutorName,
}) {
  return [
    `Hi! 👋 Just to confirm payment received for ${studentLabel(studentName, subject)}.`,
    `📚 Lessons: ${formatLessonDates(lessonDates)}`,
    "",
    `💰 Amount: ${formatSGD(amountDue)}`,
    "",
    `✅ Status: Paid`,
    `Thank you! See you at the next lesson. 😊`,
    "",
    `— ${tutorName || "Your tutor"}`,
  ].join("\n");
}

function paymentRequestOpeningLine({
  paymentMode,
  studentLabelText,
  lessonDates,
  amountDue,
  monthLabel,
  dueDateLabel,
}) {
  switch (paymentMode) {
    case "monthly":
      return `Hi! Just a reminder that payment for ${studentLabelText}'s ${monthLabel} lessons is due. Total: ${formatSGD(amountDue)} for ${lessonDates.length} lesson${lessonDates.length === 1 ? "" : "s"}.`;
    case "per_lesson":
      return `Hi! Just a reminder that payment for ${studentLabelText}'s ${dueDateLabel} lesson is due. Amount: ${formatSGD(amountDue)}.`;
    case "custom_date":
      return `Hi! Just a reminder that ${studentLabelText}'s monthly payment of ${formatSGD(amountDue)} is due on ${dueDateLabel}.`;
    default:
      return `Hi! 👋 Just a friendly reminder that 4 lessons have been completed for ${studentLabelText}.`;
  }
}

export function buildPaymentRequestMessage({
  studentName,
  subject,
  lessonDates,
  amountDue,
  tutorName,
  paynowNumber,
  paymentMode = "lessons",
  monthLabel,
  dueDateLabel,
}) {
  const lines = [
    paymentRequestOpeningLine({
      paymentMode,
      studentLabelText: studentLabel(studentName, subject),
      lessonDates,
      amountDue,
      monthLabel,
      dueDateLabel,
    }),
    `📚 Lessons: ${formatLessonDates(lessonDates)}`,
    "",
    `💰 Amount due: ${formatSGD(amountDue)}`,
    `Payment can be made via PayNow. Thank you! 😊`,
  ];
  if (paynowNumber) lines.push(`PayNow: ${paynowNumber}`);
  lines.push("", `— ${tutorName || "Your tutor"}`);
  return lines.join("\n");
}

export function buildProgressReportMessage({
  studentName,
  monthLabel,
  tutorName,
}) {
  return `Hi! Please find attached ${studentName}'s progress report for ${monthLabel}. Feel free to reach out if you have any questions! 😊 — ${tutorName || "Your tutor"}`;
}

export function buildWhatsAppLink(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
