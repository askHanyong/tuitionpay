import { jsPDF } from "jspdf";
import { formatSGD } from "./paymentNotice";
import { formatDate } from "./date";

// jsPDF's built-in fonts only support WinAnsi encoding, which has no emoji
// glyphs — render them as mangled bytes instead of failing silently, so
// strip them out of any text drawn into the PDF.
function stripEmoji(text) {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{2BFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/️/gu, "")
    .trim();
}

export const DATE_RANGE_OPTIONS = [
  { value: "1m", label: "Last month" },
  { value: "3m", label: "Last 3 months" },
  { value: "6m", label: "Last 6 months" },
  { value: "all", label: "All time" },
];

function rangeStartDate(rangeOption, today = new Date()) {
  if (rangeOption === "all") return null;
  const months = { "1m": 1, "3m": 3, "6m": 6 }[rangeOption] ?? 1;
  const start = new Date(today);
  start.setMonth(start.getMonth() - months);
  return start.toISOString().slice(0, 10);
}

export function filterLessonsByRange(lessons, rangeOption, today = new Date()) {
  const start = rangeStartDate(rangeOption, today);
  const filtered = start
    ? lessons.filter((l) => l.lesson_date >= start)
    : lessons;
  return [...filtered].sort((a, b) =>
    a.lesson_date < b.lesson_date ? -1 : a.lesson_date > b.lesson_date ? 1 : 0,
  );
}

export function progressReportFilename(
  studentName,
  generatedDate = new Date(),
) {
  const safeName = (studentName || "Student").replace(/\s+/g, "");
  const month = generatedDate.toLocaleDateString("en-SG", { month: "long" });
  const year = generatedDate.getFullYear();
  return `${safeName}Progress_Report${month}_${year}.pdf`;
}

export function downloadProgressReportPdf({
  student,
  rangeLessons,
  cycles,
  tutorName,
  note,
  lessonPosition,
  currentCycleProgress,
  lessonsThisMonth,
  generatedDate = new Date(),
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 56;

  const totalPaid = cycles
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const latestCycle = cycles[0] ?? null;
  const completedInRange = rangeLessons.filter(
    (l) => l.status === "completed",
  ).length;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(22, 101, 52);
  doc.text("ChopeAndPay — Student Progress Report", margin, y);

  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(
    `ChopeAndPay · Generated ${formatDate(generatedDate.toISOString())}`,
    margin,
    y,
  );

  y += 24;
  doc.setDrawColor(220, 220, 220);
  doc.line(margin, y, pageWidth - margin, y);

  // Student details
  y += 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text("Student details", margin, y);

  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text(`Name: ${student.name}`, margin, y);
  y += 16;
  doc.text(`Subject: ${student.subject || "—"}`, margin, y);
  y += 16;
  doc.text(`Level: ${student.level || "—"}`, margin, y);
  y += 16;
  doc.text(`Tutor: ${tutorName || "—"}`, margin, y);

  // Lessons summary
  y += 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text("Lessons summary", margin, y);

  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text(`Lessons completed (in period): ${completedInRange}`, margin, y);
  y += 16;
  doc.text(`Current cycle progress: ${currentCycleProgress}`, margin, y);
  y += 16;
  doc.text(`Lessons this month: ${lessonsThisMonth}`, margin, y);

  // Lesson history table
  y += 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text("Lesson history", margin, y);

  y += 18;
  const colX = {
    date: margin,
    duration: margin + 100,
    number: margin + 180,
    notes: margin + 260,
  };
  const drawTableHeader = () => {
    doc.setFillColor(240, 253, 244);
    doc.rect(margin, y - 12, pageWidth - margin * 2, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(22, 101, 52);
    doc.text("Date", colX.date, y);
    doc.text("Duration", colX.duration, y);
    doc.text("Lesson #", colX.number, y);
    doc.text("Notes", colX.notes, y);
    y += 18;
  };
  drawTableHeader();

  doc.setFont("helvetica", "normal");
  doc.setTextColor(55, 65, 81);
  if (rangeLessons.length === 0) {
    doc.text("No lessons in this period.", margin, y);
    y += 18;
  } else {
    for (const lesson of rangeLessons) {
      if (y > 740) {
        doc.addPage();
        y = 56;
        drawTableHeader();
        doc.setFont("helvetica", "normal");
        doc.setTextColor(55, 65, 81);
      }
      doc.text(formatDate(lesson.lesson_date), colX.date, y);
      doc.text(
        `${(lesson.duration_minutes / 60).toFixed(2)}h`,
        colX.duration,
        y,
      );
      doc.text(String(lessonPosition.get(lesson.id) ?? "?"), colX.number, y);
      doc.text(stripEmoji(lesson.notes || "—"), colX.notes, y, {
        maxWidth: pageWidth - margin - colX.notes,
      });
      y += 18;
    }
  }

  // Payment summary
  y += 20;
  if (y > 700) {
    doc.addPage();
    y = 56;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(17, 24, 39);
  doc.text("Payment summary", margin, y);

  y += 20;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(55, 65, 81);
  doc.text(`Total paid to date: ${formatSGD(totalPaid)}`, margin, y);
  y += 16;
  doc.text(
    `Current cycle status: ${latestCycle ? `${latestCycle.status} (${formatSGD(latestCycle.amount_due)})` : "No cycle yet"}`,
    margin,
    y,
  );

  // Personal note
  if (note?.trim()) {
    y += 28;
    if (y > 700) {
      doc.addPage();
      y = 56;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text("A note from your tutor", margin, y);

    y += 20;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(55, 65, 81);
    const lines = doc.splitTextToSize(
      stripEmoji(note.trim()),
      pageWidth - margin * 2,
    );
    doc.text(lines, margin, y);
    y += lines.length * 16;
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 36;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text(
    "Report generated by ChopeAndPay · chopeandpay.com",
    margin,
    footerY,
  );

  doc.save(progressReportFilename(student.name, generatedDate));
}
