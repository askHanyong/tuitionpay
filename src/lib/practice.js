// Practice students are test data. They stay visible everywhere (students,
// calendar, lessons, parent link) but never count in money figures or reports.

export const isPractice = (student) => Boolean(student?.is_practice);

// items: students, or rows with a student_id (lessons, payment cycles).
// studentsById must cover ALL students (archived and deleted too), not just the
// active list, otherwise a practice student's rows slip through.
export function excludePractice(items, studentsById) {
  if (!items) return items;
  return items.filter((x) => {
    const student =
      "student_id" in x ? (studentsById?.get(x.student_id) ?? x.students) : x;
    return !isPractice(student);
  });
}
