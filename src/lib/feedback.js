const FEEDBACK_WHATSAPP_NUMBER = "6580448247";
const FEEDBACK_EMAIL = "mathstutorlimhy@gmail.com";
const APP_VERSION = "1.0";

export function buildFeedbackWhatsAppLink() {
  const message = "Hi! I have some feedback about ChopeAndPay: ";
  return `https://wa.me/${FEEDBACK_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export function buildFeedbackMailtoLink() {
  const subject = "ChopeAndPay Feedback";
  const body = `Hi! Here's my feedback:\n\n\n\nApp version: ${APP_VERSION}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
