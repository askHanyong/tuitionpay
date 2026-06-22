export function formatSGD(amount) {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(amount)
}

export function buildPaymentNoticeMessage({ studentName, amountDue, periodStart, periodEnd, tutorName }) {
  const from = new Date(periodStart).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })
  const to = new Date(periodEnd).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' })

  return [
    `Hi! This is a payment reminder for ${studentName}'s tuition.`,
    `4 lessons (${from} - ${to}) have been completed.`,
    `Amount due: ${formatSGD(amountDue)}.`,
    `Please make payment at your earliest convenience. Thank you!${tutorName ? `\n- ${tutorName}` : ''}`,
  ].join('\n')
}
