export function buildReferralLink(referralCode) {
  return `tuitionpaylah.com/signup?ref=${referralCode}`;
}

export function buildReferralWhatsAppMessage(referralCode) {
  return `Hey! I've been using TuitionPayLah to track my tuition payments and lessons — it's really useful and free! Sign up here: ${buildReferralLink(referralCode)}`;
}
