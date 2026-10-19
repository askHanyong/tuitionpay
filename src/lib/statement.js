// Monthly agency ("payee") statement maths.
// A lesson counts in the month it was TAUGHT. share_percent is the tutor's
// share of the fee. If the agency collected the fee, the agency owes the tutor
// that share. If the tutor collected it, the tutor owes the agency the rest.

import { lessonAmount } from "./paymentMode";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function monthRange(monthStr) {
  // monthStr is "YYYY-MM"
  const [y, m] = monthStr.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = new Date(Date.UTC(y, m, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { start, end };
}

export function monthLabelFromStr(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// students: this payee's students. lessons: completed lessons in the month.
export function buildStatement({ payee, students, lessons }) {
  const sharePct = Number(payee.share_percent);
  const byStudent = new Map(students.map((s) => [s.id, s]));

  const blocks = students
    .map((student) => {
      const rows = lessons
        .filter((l) => l.student_id === student.id)
        .sort((a, b) =>
          `${a.lesson_date} ${a.lesson_time ?? ""}`.localeCompare(
            `${b.lesson_date} ${b.lesson_time ?? ""}`,
          ),
        )
        .map((l) => {
          const perSession = l.rate_type === "per_session";
          return {
            id: l.id,
            date: l.lesson_date,
            subject: l.subject || student.subject || "",
            hours: perSession ? null : (l.duration_minutes ?? 0) / 60,
            rate: l.rate ?? student.hourly_rate ?? 0,
            perSession,
            amount: round2(lessonAmount(l, student)),
          };
        });
      const total = round2(rows.reduce((sum, r) => sum + r.amount, 0));
      const hours = round2(rows.reduce((sum, r) => sum + (r.hours ?? 0), 0));
      return {
        student,
        collectedBy: student.fee_collected_by === "me" ? "me" : "payee",
        rows,
        total,
        hours,
      };
    })
    .filter((b) => b.rows.length > 0 && byStudent.has(b.student.id))
    .sort((a, b) => a.student.name.localeCompare(b.student.name));

  const feesCollectedByAgency = round2(
    blocks.filter((b) => b.collectedBy === "payee").reduce((s, b) => s + b.total, 0),
  );
  const feesCollectedByMe = round2(
    blocks.filter((b) => b.collectedBy === "me").reduce((s, b) => s + b.total, 0),
  );
  const agencyOwesMe = round2((feesCollectedByAgency * sharePct) / 100);
  const iOweAgency = round2((feesCollectedByMe * (100 - sharePct)) / 100);

  return {
    sharePct,
    blocks,
    feesCollectedByAgency,
    feesCollectedByMe,
    agencyOwesMe,
    iOweAgency,
    net: round2(agencyOwesMe - iOweAgency),
    totalHours: round2(blocks.reduce((s, b) => s + b.hours, 0)),
  };
}

const fmtDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
};

export async function downloadStatementXlsx({ payee, monthStr, tutorName, statement }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Statement");
  ws.columns = [
    { width: 24 },
    { width: 22 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
  ];
  const money = '"$"#,##0.00';

  const title = ws.addRow([`${payee.name} — statement for ${monthLabelFromStr(monthStr)}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Tutor: ${tutorName || ""}`]);
  ws.addRow([]);

  for (const b of statement.blocks) {
    const head = ws.addRow([
      b.student.name,
      [b.student.subject, b.student.level].filter(Boolean).join(" · "),
      "",
      "",
      b.collectedBy === "me" ? "Paid to tutor" : "Paid to agency",
    ]);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5EF" } };
    });
    const cols = ws.addRow(["Date", "Subject", "Hours", "Rate", "Amount"]);
    cols.font = { italic: true, color: { argb: "FF555555" } };
    for (const r of b.rows) {
      const row = ws.addRow([
        fmtDate(r.date),
        r.subject,
        r.perSession ? "per session" : r.hours,
        r.rate,
        r.amount,
      ]);
      row.getCell(3).numFmt = "0.0#";
      row.getCell(4).numFmt = money;
      row.getCell(5).numFmt = money;
    }
    const sub = ws.addRow(["Total", "", b.hours, "", b.total]);
    sub.font = { bold: true };
    sub.getCell(3).numFmt = "0.0#";
    sub.getCell(5).numFmt = money;
    ws.addRow([]);
  }

  const lines = [
    [`Fees paid to ${payee.name}`, statement.feesCollectedByAgency],
    [`${payee.name} owes you (${statement.sharePct}%)`, statement.agencyOwesMe],
    [`Fees paid directly to you`, statement.feesCollectedByMe],
    [
      `You owe ${payee.name} (${round2(100 - statement.sharePct)}% of direct fees)`,
      -statement.iOweAgency,
    ],
  ];
  const sumHead = ws.addRow(["Summary"]);
  sumHead.font = { bold: true, size: 12 };
  for (const [label, value] of lines) {
    const r = ws.addRow([label, "", "", "", value]);
    r.getCell(5).numFmt = money;
  }
  const net = ws.addRow([`Total ${payee.name} to reimburse you`, "", "", "", statement.net]);
  net.font = { bold: true };
  net.getCell(5).numFmt = money;

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payee.name.replace(/[^\w-]+/g, "_")}_${monthStr}_statement.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
