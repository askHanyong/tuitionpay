// Monthly agency ("payee") statement maths.
// A lesson counts in the month it was TAUGHT. share_percent is the tutor's
// share of the fee. If the agency collected the fee, the agency owes the tutor
// that share. If the tutor collected it, the tutor owes the agency the rest.

import { lessonAmount } from "./paymentMode";

// "SSEC" -> "Paid directly by SSEC"; text that already starts with "Paid" is kept as typed.
export const directPayerLabel = (payer) =>
  /^paid\b/i.test(payer) ? payer : `Paid directly by ${payer}`;

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

// students: this payee's students. lessons: completed lessons up to the end
// of the statement month (earlier ones are needed to know how much of a
// one-off placement fee has already been used). range: { start, end } of the
// statement month, end exclusive.
export function buildStatement({ payee, students, lessons, items = [], range }) {
  const sharePct = Number(payee.share_percent);
  const inMonth = (d) => !range || (d >= range.start && d < range.end);

  const blocks = students
    .map((student) => {
      const sorted = lessons
        .filter((l) => l.student_id === student.id)
        .sort((a, b) =>
          `${a.lesson_date} ${a.lesson_time ?? ""} ${a.id}`.localeCompare(
            `${b.lesson_date} ${b.lesson_time ?? ""} ${b.id}`,
          ),
        );

      // One-off placement fee: comes off the earliest lessons (on/after the
      // start date, if set) until the total is used up.
      let feeLeft = Number(student.placement_fee_amount) || 0;
      const feeStart = student.placement_fee_start || null;

      const allRows = sorted.map((l) => {
        const perSession = l.rate_type === "per_session";
        const amount = round2(lessonAmount(l, student));
        let placementFee = 0;
        if (feeLeft > 0 && (!feeStart || l.lesson_date >= feeStart)) {
          placementFee = round2(Math.min(feeLeft, amount));
          feeLeft = round2(feeLeft - placementFee);
        }
        return {
          id: l.id,
          date: l.lesson_date,
          subject: l.subject || student.subject || "",
          hours: perSession ? null : (l.duration_minutes ?? 0) / 60,
          rate: l.rate ?? student.hourly_rate ?? 0,
          perSession,
          amount,
          placementFee,
          counted: round2(amount - placementFee),
        };
      });

      const rows = allRows.filter((r) => inMonth(r.date));
      const sum = (key) => round2(rows.reduce((t, r) => t + (r[key] ?? 0), 0));
      return {
        student,
        collectedBy: student.fee_collected_by === "me" ? "me" : "payee",
        directPayer: (student.direct_payer ?? "").trim(),
        placementAgency: student.placement_fee_agency || "referral agency",
        rows,
        total: sum("amount"),
        placementTotal: sum("placementFee"),
        countedTotal: sum("counted"),
        hours: sum("hours"),
      };
    })
    .filter((b) => b.rows.length > 0)
    .sort((a, b) => a.student.name.localeCompare(b.student.name));

  const feesCollectedByAgency = round2(
    blocks.filter((b) => b.collectedBy === "payee").reduce((s, b) => s + b.countedTotal, 0),
  );
  const feesCollectedByMe = round2(
    blocks.filter((b) => b.collectedBy === "me").reduce((s, b) => s + b.countedTotal, 0),
  );
  // Directly-collected fees grouped by who paid the tutor (SSEC, Edulab, ...).
  const groupMap = new Map();
  for (const b of blocks.filter((x) => x.collectedBy === "me")) {
    const key = b.directPayer || "Direct";
    const g = groupMap.get(key) ?? { payer: key, total: 0, students: [] };
    g.total = round2(g.total + b.countedTotal);
    g.students.push(b.student.name);
    groupMap.set(key, g);
  }
  const directGroups = [...groupMap.values()].sort((a, b) =>
    a.payer === "Direct" ? 1 : b.payer === "Direct" ? -1 : a.payer.localeCompare(b.payer),
  );

  const agencyOwesMe = round2((feesCollectedByAgency * sharePct) / 100);
  const iOweAgency = round2((feesCollectedByMe * (100 - sharePct)) / 100);

  const itemsTotal = round2(items.reduce((sum, i) => sum + Number(i.amount), 0));
  const placementTotal = round2(blocks.reduce((s, b) => s + b.placementTotal, 0));

  return {
    sharePct,
    items,
    itemsTotal,
    blocks,
    placementTotal,
    hasPlacement: placementTotal > 0,
    feesCollectedByAgency,
    feesCollectedByMe,
    directGroups,
    agencyOwesMe,
    iOweAgency,
    net: round2(agencyOwesMe - iOweAgency + itemsTotal),
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
  const wide = statement.hasPlacement;
  const lastCol = wide ? 7 : 5;
  ws.columns = wide
    ? [{ width: 24 }, { width: 20 }, { width: 10 }, { width: 12 }, { width: 14 }, { width: 22 }, { width: 14 }]
    : [{ width: 24 }, { width: 22 }, { width: 10 }, { width: 12 }, { width: 14 }];
  const money = '"$"#,##0.00';
  const pad = (cells) => {
    const out = [...cells];
    while (out.length < lastCol) out.splice(out.length - 1, 0, "");
    return out;
  };
  // Row with its amount in the last column, label in the first.
  const amountRow = (label, value) => {
    const r = ws.addRow(pad([label, value]));
    r.getCell(lastCol).numFmt = money;
    return r;
  };

  const title = ws.addRow([`${payee.name} — statement for ${monthLabelFromStr(monthStr)}`]);
  title.font = { bold: true, size: 14 };
  ws.addRow([`Tutor: ${tutorName || ""}`]);
  ws.addRow([]);

  for (const b of statement.blocks) {
    const collected =
      b.collectedBy === "me"
        ? b.directPayer
          ? directPayerLabel(b.directPayer)
          : "Paid to tutor"
        : "Paid to agency";
    const head = ws.addRow(
      pad([b.student.name, [b.student.subject, b.student.level].filter(Boolean).join(" · "), collected]),
    );
    head.font = { bold: true };
    head.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5EF" } };
    });
    const colHeads = wide
      ? ["Date", "Subject", "Hours", "Rate", "Billed", `Paid to ${b.placementAgency}`, "Counted"]
      : ["Date", "Subject", "Hours", "Rate", "Amount"];
    const cols = ws.addRow(colHeads);
    cols.font = { italic: true, color: { argb: "FF555555" } };
    for (const r of b.rows) {
      const cells = [fmtDate(r.date), r.subject, r.perSession ? "per session" : r.hours, r.rate, r.amount];
      if (wide) cells.push(r.placementFee > 0 ? r.placementFee : "", r.counted);
      const row = ws.addRow(cells);
      row.getCell(3).numFmt = "0.0#";
      for (let c = 4; c <= lastCol; c++) row.getCell(c).numFmt = money;
    }
    const subCells = ["Total", "", b.hours, "", b.total];
    if (wide) subCells.push(b.placementTotal > 0 ? b.placementTotal : "", b.countedTotal);
    const sub = ws.addRow(subCells);
    sub.font = { bold: true };
    sub.getCell(3).numFmt = "0.0#";
    for (let c = 5; c <= lastCol; c++) sub.getCell(c).numFmt = money;
    ws.addRow([]);
  }

  const sumHead = ws.addRow(["Summary"]);
  sumHead.font = { bold: true, size: 12 };
  amountRow(`Fees paid to ${payee.name}`, statement.feesCollectedByAgency);
  amountRow(`${payee.name} owes you (${statement.sharePct}%)`, statement.agencyOwesMe);
  if (statement.directGroups.length === 0) {
    amountRow("Fees paid directly to you", statement.feesCollectedByMe);
  } else {
    ws.addRow(["Fees paid directly to you"]).font = { bold: true };
    for (const g of statement.directGroups) {
      amountRow(`  ${g.payer} – ${g.students.join(", ")}`, g.total);
    }
    if (statement.directGroups.length > 1) {
      amountRow("  Total paid directly to you", statement.feesCollectedByMe).font = { bold: true };
    }
  }
  amountRow(
    `You owe ${payee.name} (${round2(100 - statement.sharePct)}% of direct fees)`,
    -statement.iOweAgency,
  );
  for (const item of statement.items ?? []) {
    amountRow(item.note ? `${item.description} (${item.note})` : item.description, Number(item.amount));
  }
  const net = amountRow(
    statement.net < 0 ? `Net: you owe ${payee.name}` : `Total ${payee.name} to reimburse you`,
    Math.abs(statement.net),
  );
  net.font = { bold: true };
  if (wide) {
    const note = ws.addRow(["Placement fees paid directly to a referral agency are excluded from the amounts above."]);
    note.font = { italic: true, color: { argb: "FF777777" } };
  }

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
