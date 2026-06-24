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

export function buildPaymentRequestMessage({
  studentName,
  subject,
  lessonDates,
  amountDue,
  tutorName,
  paynowNumber,
}) {
  const lines = [
    `Hi! 👋 Just a friendly reminder that 4 lessons have been completed for ${studentLabel(studentName, subject)}.`,
    `📚 Lessons: ${formatLessonDates(lessonDates)}`,
    "",
    `💰 Amount due: ${formatSGD(amountDue)}`,
    `Payment can be made via PayNow. Thank you! 😊`,
  ];
  if (paynowNumber) lines.push(`PayNow: ${paynowNumber}`);
  lines.push("", `— ${tutorName || "Your tutor"}`);
  return lines.join("\n");
}

export function buildWhatsAppLink(message) {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
