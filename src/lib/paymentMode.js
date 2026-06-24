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
