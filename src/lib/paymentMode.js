const ORDINALS = {
  1: "1st",
  2: "2nd",
  3: "3rd",
  21: "21st",
  22: "22nd",
  23: "23rd",
  31: "31st",
};

export function ordinal(day) {
  return ORDINALS[day] ?? `${day}th`;
}

// The billable amount for a single lesson. For per_session subjects the rate
// is a flat fee regardless of duration; for hourly subjects it's the actual
// logged duration times the rate (falling back to student's hourly_rate).
export function lessonAmount(lesson, student) {
  const rate = lesson?.rate ?? student?.hourly_rate ?? 0;
  if (lesson?.rate_type === "per_session") return rate;
  const minutes = lesson?.duration_minutes ?? 0;
  return (minutes / 60) * rate;
}

export function paymentModeLabel(student) {
  switch (student?.payment_mode) {
    case "monthly":
      return "Monthly";
    case "per_lesson":
      return "Per lesson";
    case "custom_date":
      return `Due on ${ordinal(student.payment_custom_day ?? 1)}`;
    case "lessons":
    default:
      return `Every ${student?.payment_cycle_count ?? 4} lessons`;
  }
}
