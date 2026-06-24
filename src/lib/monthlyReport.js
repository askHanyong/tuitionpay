function isSameMonth(dateStr, monthDate) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return (
    d.getFullYear() === monthDate.getFullYear() &&
    d.getMonth() === monthDate.getMonth()
  );
}

export function earningsMessage(total) {
  if (total > 3000) return "🔥 Outstanding month! You're crushing it!";
  if (total >= 1000) return "💪 Great work! Solid and consistent!";
  return "📈 Every lesson counts — keep building!";
}

export function buildMonthlyReport(
  monthDate,
  students,
  lessons,
  paymentCycles,
) {
  const monthLessons = lessons.filter((l) =>
    isSameMonth(l.lesson_date, monthDate),
  );
  const monthCycles = paymentCycles.filter((c) =>
    isSameMonth(c.period_end, monthDate),
  );

  const studentById = new Map(students.map((s) => [s.id, s]));
  const rows = new Map();

  const getRow = (studentId, fallbackName) => {
    if (!rows.has(studentId)) {
      const student = studentById.get(studentId);
      rows.set(studentId, {
        studentId,
        name: student?.name ?? fallbackName ?? "Unknown",
        subject: student?.subject ?? "",
        level: student?.level ?? "",
        lessonsCount: 0,
        amountPaid: 0,
        amountPending: 0,
      });
    }
    return rows.get(studentId);
  };

  for (const lesson of monthLessons) {
    getRow(lesson.student_id, lesson.students?.name).lessonsCount += 1;
  }
  for (const cycle of monthCycles) {
    const row = getRow(cycle.student_id, cycle.students?.name);
    if (cycle.status === "paid") row.amountPaid += Number(cycle.amount_due);
    else if (cycle.status === "pending")
      row.amountPending += Number(cycle.amount_due);
  }

  const perStudent = [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const collected = monthCycles
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const pending = monthCycles
    .filter((c) => c.status === "pending")
    .reduce((sum, c) => sum + Number(c.amount_due), 0);

  return {
    totalLessons: monthLessons.length,
    collected,
    pending,
    total: collected + pending,
    perStudent,
    message: earningsMessage(collected + pending),
  };
}

export function reportFilenameBase(monthDate, extension) {
  const month = monthDate.toLocaleDateString("en-SG", { month: "long" });
  const year = monthDate.getFullYear();
  return `ChopeAndPay_${month}_${year}_Report.${extension}`;
}
