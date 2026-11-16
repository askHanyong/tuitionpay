import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { formatSGD } from "../lib/paymentNotice";
import { lessonAmount } from "../lib/paymentMode";
import { buildEarningsBreakdown } from "../lib/collectedBreakdown";
import { formatMonth } from "../utils/dateFormat";
import AppShell from "../components/AppShell";

const PAGE_SIZE = 900;
const THIS_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from({ length: THIS_YEAR - 2019 }, (_, i) => THIS_YEAR - i);

async function fetchAllLessons(tutorId, fromDate) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("lessons")
      .select("id, student_id, lesson_date, is_completed, rate, rate_type, duration_minutes, payment_cycle_id")
      .eq("tutor_id", tutorId)
      .eq("is_completed", true)
      .gte("lesson_date", fromDate)
      .order("lesson_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data ?? []);
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function computeMonthlyBreakdowns({ year, students, payees, lessons }) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const monthDate = new Date(year, m, 1);
    const bd = buildEarningsBreakdown({ monthDate, students, payees, lessons });
    let commissionB = 0;
    for (const agency of bd.agencies) {
      for (const line of agency.lines) {
        if (line.collectedBy === "me") commissionB += line.amount;
      }
    }
    const monthPrefix = `${year}-${String(m + 1).padStart(2, "0")}`;
    const lessonCount = lessons.filter(
      (l) => l.lesson_date.startsWith(monthPrefix),
    ).length;
    months.push({
      monthDate,
      monthPrefix,
      bd,
      commissionB,
      revenue: bd.mine + commissionB,
      gross: bd.total,
      agencyShare: bd.agencyTotal,
      mine: bd.mine,
      lessonCount,
    });
  }
  return months;
}

function computePerStudentRows({ year, students, payees, lessons, cycles }) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));
  const cyclesByStudent = new Map();
  for (const c of cycles) {
    if (!cyclesByStudent.has(c.student_id)) cyclesByStudent.set(c.student_id, []);
    cyclesByStudent.get(c.student_id).push(c);
  }
  const lessonsByStudent = new Map();
  for (const l of lessons) {
    if (!lessonsByStudent.has(l.student_id)) lessonsByStudent.set(l.student_id, []);
    lessonsByStudent.get(l.student_id).push(l);
  }

  const rows = [];
  for (const student of students) {
    const allLessons = (lessonsByStudent.get(student.id) ?? []).sort((a, b) =>
      a.lesson_date.localeCompare(b.lesson_date),
    );
    const yearLessons = allLessons.filter(
      (l) => l.lesson_date >= yearStart && l.lesson_date < yearEnd,
    );
    if (yearLessons.length === 0) continue;

    // Track placement fee consumption across ALL lessons (from start)
    let feeLeft = Number(student.placement_fee_amount) || 0;
    const feeStart = student.placement_fee_start || null;
    let placementFeeYear = 0;

    for (const l of allLessons) {
      if (feeLeft <= 0) break;
      if (feeStart && l.lesson_date < feeStart) continue;
      const amt = lessonAmount(l, student);
      const take = Math.min(feeLeft, amt);
      feeLeft -= take;
      if (l.lesson_date >= yearStart && l.lesson_date < yearEnd) {
        placementFeeYear += take;
      }
    }

    let gross = 0;
    for (const l of yearLessons) gross += lessonAmount(l, student);

    const counted = gross - placementFeeYear;
    const payee = student.payee_id ? payeesById.get(student.payee_id) : null;
    let agencyShareA = 0;
    let commissionB = 0;
    if (payee && counted > 0) {
      const share = Number(payee.share_percent ?? 80);
      const byMe = student.fee_collected_by === "me";
      const agencyAmt = byMe
        ? Math.round((counted * (100 - share)) / 100 * 100) / 100
        : Math.round((counted * (100 - share)) / 100 * 100) / 100;
      if (byMe) commissionB = agencyAmt;
      else agencyShareA = agencyAmt;
    }

    // revenue: gross - placementFee - agencyShareA
    // (commissionB is a separate deduction; gross for set-up B includes commission)
    const revenue = gross - placementFeeYear - agencyShareA;

    // paid and written-off from cycles
    const studentCycles = cyclesByStudent.get(student.id) ?? [];
    let paid = 0;
    let writtenOff = 0;
    for (const c of studentCycles) {
      if (c.status === "paid" && c.paid_at && c.paid_at >= yearStart && c.paid_at < yearEnd) {
        paid += Number(c.amount_due);
      }
      if (c.status === "waived" && c.waived_at && c.waived_at >= yearStart && c.waived_at < yearEnd) {
        writtenOff += Number(c.amount_due);
      }
    }
    const outstanding = Math.max(0, revenue - paid - writtenOff);

    rows.push({
      student,
      lessonCount: yearLessons.length,
      gross,
      placementFee: placementFeeYear,
      agencyShareA,
      commissionB,
      revenue,
      paid,
      writtenOff,
      outstanding,
    });
  }

  return rows.sort((a, b) => a.student.name.localeCompare(b.student.name));
}

function downloadCSV({ year, perStudentRows, annualRevenue, annualCommissionB, writtenOffInYear, outstandingAtYearEnd }) {
  const header = ["Student", "Status", "Lessons", "Gross fees", "Agency/placement share", "Your revenue", "Commission paid (set-up B)", "Paid", "Written off", "Outstanding"];
  const rows = perStudentRows.map((r) => {
    const status = r.student.deleted_at ? "Deleted" : r.student.archived ? "Archived" : "Active";
    return [
      r.student.name,
      status,
      r.lessonCount,
      r.gross.toFixed(2),
      (r.placementFee + r.agencyShareA).toFixed(2),
      r.revenue.toFixed(2),
      r.commissionB.toFixed(2),
      r.paid.toFixed(2),
      r.writtenOff.toFixed(2),
      r.outstanding.toFixed(2),
    ];
  });
  const summary = [
    "TOTAL",
    "",
    perStudentRows.reduce((s, r) => s + r.lessonCount, 0),
    perStudentRows.reduce((s, r) => s + r.gross, 0).toFixed(2),
    perStudentRows.reduce((s, r) => s + r.placementFee + r.agencyShareA, 0).toFixed(2),
    annualRevenue.toFixed(2),
    annualCommissionB.toFixed(2),
    perStudentRows.reduce((s, r) => s + r.paid, 0).toFixed(2),
    writtenOffInYear.toFixed(2),
    outstandingAtYearEnd.toFixed(2),
  ];
  const csvLines = [header, ...rows, [], summary].map((row) =>
    row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
  );
  const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `income_report_${year}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function StatTile({ label, value, sub, accent }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? "border-[#b8e8d9] bg-[#edf6f3]" : "border-gray-200 bg-white"} shadow-sm`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[#1b2d4f]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export default function YearEndReport() {
  const { user } = useAuth();
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";

  const [year, setYear] = useState(THIS_YEAR - 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState(null);
  const [studentsOpen, setStudentsOpen] = useState(false);

  useEffect(() => {
    if (!user || isPractitioner) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, user]);

  async function load() {
    setLoading(true);
    setError(null);
    setRawData(null);
    try {
      const tutorId = user.id;
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year + 1}-01-01`;

      // Students (all including archived/deleted)
      const { data: studentsData, error: studentsErr } = await supabase
        .from("students")
        .select("id, name, hourly_rate, payment_mode, payment_cycle_count, payee_id, fee_collected_by, placement_fee_agency, placement_fee_amount, placement_fee_start, archived, deleted_at")
        .eq("tutor_id", tutorId);
      if (studentsErr) throw studentsErr;
      const students = studentsData ?? [];

      // Payees
      const { data: payeesData, error: payeesErr } = await supabase
        .from("payees")
        .select("id, name, share_percent")
        .eq("tutor_id", tutorId);
      if (payeesErr) throw payeesErr;
      const payees = payeesData ?? [];

      // Determine earliest lesson fetch date (placement fees may need history before year start)
      let fromDate = yearStart;
      for (const s of students) {
        if (s.placement_fee_amount && Number(s.placement_fee_amount) > 0 && s.placement_fee_start) {
          if (s.placement_fee_start < fromDate) fromDate = s.placement_fee_start;
        }
      }

      // Lessons (paged)
      const lessons = await fetchAllLessons(tutorId, fromDate);

      // Payment cycles for the year (wider window to capture paid_at / waived_at)
      const { data: cyclesData, error: cyclesErr } = await supabase
        .from("payment_cycles")
        .select("id, student_id, amount_due, status, period_start, period_end, paid_at, waived_at, waived_from_status")
        .eq("tutor_id", tutorId)
        .or(`period_end.gte.${yearStart},paid_at.gte.${yearStart},waived_at.gte.${yearStart}`);
      if (cyclesErr) throw cyclesErr;
      const cycles = cyclesData ?? [];

      // Agency placements check
      const { data: placementsData } = await supabase
        .from("agency_placements")
        .select("id")
        .eq("tutor_id", tutorId)
        .is("ended_at", null)
        .limit(5);
      const agencyPlacements = placementsData ?? [];

      setRawData({ students, payees, lessons, cycles, agencyPlacements });
    } catch (e) {
      setError(e.message ?? "Failed to load report data.");
    } finally {
      setLoading(false);
    }
  }

  const report = useMemo(() => {
    if (!rawData) return null;
    const { students, payees, lessons, cycles } = rawData;
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year + 1}-01-01`;

    const months = computeMonthlyBreakdowns({ year, students, payees, lessons });

    const annualRevenue = months.reduce((s, m) => s + m.revenue, 0);
    const annualCommissionB = months.reduce((s, m) => s + m.commissionB, 0);
    const annualGross = months.reduce((s, m) => s + m.gross, 0);
    const annualAgencyShare = months.reduce((s, m) => s + m.agencyShare, 0);
    const annualMine = months.reduce((s, m) => s + m.mine, 0);
    const annualLessons = months.reduce((s, m) => s + m.lessonCount, 0);

    // Dev check
    const sumOfMonths = months.reduce((s, m) => s + m.revenue, 0);
    if (Math.abs(sumOfMonths - annualRevenue) > 0.01) {
      console.error("[YearEndReport] Monthly sum mismatch", sumOfMonths, annualRevenue);
    }

    const writtenOffInYear = cycles
      .filter((c) => c.status === "waived" && c.waived_at && c.waived_at >= yearStart && c.waived_at < yearEnd)
      .reduce((s, c) => s + Number(c.amount_due), 0);

    const collectedInYear = cycles
      .filter((c) => c.status === "paid" && c.paid_at && c.paid_at >= yearStart && c.paid_at < yearEnd)
      .reduce((s, c) => s + Number(c.amount_due), 0);

    // Outstanding: pending/overdue cycles with period_end in year
    const outstandingCycles = cycles
      .filter(
        (c) =>
          (c.status === "pending" || c.status === "overdue") &&
          c.period_end >= yearStart &&
          c.period_end < yearEnd,
      )
      .reduce((s, c) => s + Number(c.amount_due), 0);

    // Plus unbilled lessons in year
    const yearLessons = lessons.filter(
      (l) => l.lesson_date >= yearStart && l.lesson_date < yearEnd,
    );
    const unbilledStudentIds = new Set(
      yearLessons.filter((l) => !l.payment_cycle_id).map((l) => l.student_id),
    );
    let unbilledAmount = 0;
    for (const stuId of unbilledStudentIds) {
      const stu = students.find((s) => s.id === stuId);
      if (!stu) continue;
      const stuUnbilled = yearLessons.filter(
        (l) => l.student_id === stuId && !l.payment_cycle_id,
      );
      unbilledAmount += stuUnbilled.reduce((s, l) => s + lessonAmount(l, stu), 0);
    }
    const outstandingAtYearEnd = outstandingCycles + unbilledAmount;

    // Add collected/writtenOff per month from cycles
    const monthsWithCash = months.map((m) => {
      const collected = cycles
        .filter((c) => c.status === "paid" && c.paid_at && c.paid_at.startsWith(m.monthPrefix))
        .reduce((s, c) => s + Number(c.amount_due), 0);
      const writtenOff = cycles
        .filter((c) => c.status === "waived" && c.waived_at && c.waived_at.startsWith(m.monthPrefix))
        .reduce((s, c) => s + Number(c.amount_due), 0);
      return { ...m, collected, writtenOff };
    });

    const perStudentRows = computePerStudentRows({ year, students, payees, lessons, cycles });

    return {
      year,
      annualRevenue,
      annualCommissionB,
      annualGross,
      annualAgencyShare,
      annualMine,
      annualLessons,
      writtenOffInYear,
      collectedInYear,
      outstandingAtYearEnd,
      months: monthsWithCash,
      perStudentRows,
    };
  }, [rawData, year]);

  if (isPractitioner) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-gray-600">Year-end income report is for tutors only.</div>
      </AppShell>
    );
  }

  const r = report;

  return (
    <AppShell>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <div>
            <h1 className="text-xl font-bold text-[#1b2d4f]">Year-End Income Report</h1>
            <p className="text-sm text-gray-500">For Singapore Form B/B1 income tax filing</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5ecfaa]"
            >
              {AVAILABLE_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y} {y === THIS_YEAR ? "(current)" : y === THIS_YEAR - 1 ? "(last year)" : ""}
                </option>
              ))}
            </select>
            {r && (
              <>
                <button
                  onClick={() => downloadCSV({ year, perStudentRows: r.perStudentRows, annualRevenue: r.annualRevenue, annualCommissionB: r.annualCommissionB, writtenOffInYear: r.writtenOffInYear, outstandingAtYearEnd: r.outstandingAtYearEnd })}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Export CSV
                </button>
                <button
                  onClick={() => window.print()}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Print / PDF
                </button>
              </>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#5ecfaa] border-t-transparent" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Agency placements notice */}
        {rawData && rawData.agencyPlacements.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            You have {rawData.agencyPlacements.length} active agency placement
            {rawData.agencyPlacements.length !== 1 ? "s" : ""}. Income from those students via the agency platform isn't included in this report yet. Check with your agency for a separate statement.
          </div>
        )}

        {r && (
          <>
            {/* Headline tiles */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Revenue"
                value={formatSGD(r.annualRevenue)}
                sub={`${r.annualLessons} lessons taught`}
                accent
              />
              {r.annualCommissionB > 0 && (
                <StatTile
                  label="Commission paid to agencies"
                  value={formatSGD(r.annualCommissionB)}
                  sub="Set-up B: you collected, agency's cut"
                />
              )}
              <StatTile
                label="Written off in year"
                value={formatSGD(r.writtenOffInYear)}
                sub="By write-off date"
              />
              <StatTile
                label="Outstanding at year end"
                value={formatSGD(r.outstandingAtYearEnd)}
                sub="Unpaid + unbilled"
              />
            </div>

            {/* 2-line statement */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-[#1b2d4f]">2-Line Statement — Year of Assessment {r.year + 1}</h2>
              <div className="space-y-1 font-mono text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-700">Revenue</span>
                  <span className="font-semibold text-[#1b2d4f]">{formatSGD(r.annualRevenue)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-gray-700">Adjusted profit / loss</span>
                  <span className="font-semibold text-[#1b2d4f]">{formatSGD(r.annualRevenue - r.annualCommissionB)}</span>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                Singapore 2-line statement for revenue ≤ $200k. Revenue = lessons taught in {r.year} at your share of each student's fee.
                {r.annualCommissionB > 0 && ` Adjusted profit deducts ${formatSGD(r.annualCommissionB)} commission you paid to agencies.`}
              </p>
            </div>

            {/* By-month table */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-3">
                <h2 className="text-sm font-semibold text-[#1b2d4f]">Monthly Breakdown — {r.year}</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                      <th className="px-4 py-2 font-medium">Month</th>
                      <th className="px-4 py-2 text-right font-medium">Lessons</th>
                      <th className="px-4 py-2 text-right font-medium">Gross fees</th>
                      <th className="px-4 py-2 text-right font-medium">Agency's share</th>
                      <th className="px-4 py-2 text-right font-medium">Your revenue</th>
                      <th className="px-4 py-2 text-right font-medium">Collected</th>
                      <th className="px-4 py-2 text-right font-medium">Written off</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.months.map((m) => (
                      <tr
                        key={m.monthPrefix}
                        className={`border-b border-gray-50 ${m.lessonCount === 0 ? "text-gray-300" : "text-gray-800"}`}
                      >
                        <td className="px-4 py-2">{formatMonth(m.monthDate)}</td>
                        <td className="px-4 py-2 text-right">{m.lessonCount || "—"}</td>
                        <td className="px-4 py-2 text-right">{m.gross > 0 ? formatSGD(m.gross) : "—"}</td>
                        <td className="px-4 py-2 text-right">{m.agencyShare > 0 ? formatSGD(m.agencyShare) : "—"}</td>
                        <td className="px-4 py-2 text-right font-medium">{m.revenue > 0 ? formatSGD(m.revenue) : "—"}</td>
                        <td className="px-4 py-2 text-right">{m.collected > 0 ? formatSGD(m.collected) : "—"}</td>
                        <td className="px-4 py-2 text-right">{m.writtenOff > 0 ? formatSGD(m.writtenOff) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-semibold text-[#1b2d4f]">
                      <td className="px-4 py-3">Total</td>
                      <td className="px-4 py-3 text-right">{r.annualLessons}</td>
                      <td className="px-4 py-3 text-right">{formatSGD(r.annualGross)}</td>
                      <td className="px-4 py-3 text-right">{formatSGD(r.annualAgencyShare)}</td>
                      <td className="px-4 py-3 text-right">{formatSGD(r.annualRevenue)}</td>
                      <td className="px-4 py-3 text-right">{formatSGD(r.collectedInYear)}</td>
                      <td className="px-4 py-3 text-right">{formatSGD(r.writtenOffInYear)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Reconciliation */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-semibold text-[#1b2d4f]">Reconciliation</h2>
              <div className="space-y-1 font-mono text-sm">
                <div className="flex justify-between gap-4 text-gray-800">
                  <span>Revenue earned (lessons taught in {r.year})</span>
                  <span>{formatSGD(r.annualRevenue)}</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Less: Collected in {r.year}</span>
                  <span>({formatSGD(r.collectedInYear)})</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Less: Written off in {r.year}</span>
                  <span>({formatSGD(r.writtenOffInYear)})</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 font-semibold text-[#1b2d4f]">
                  <span>Still owed at year end</span>
                  <span>{formatSGD(Math.max(0, r.annualRevenue - r.collectedInYear - r.writtenOffInYear))}</span>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                Still owed = outstanding cycles for this year's lessons + unbilled lessons. Collected/written-off figures use payment date, not lesson date, so small timing differences are normal.
              </p>
            </div>

            {/* Per-student record cards */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                onClick={() => setStudentsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <h2 className="text-sm font-semibold text-[#1b2d4f]">
                  Per-Student Records ({r.perStudentRows.length} student{r.perStudentRows.length !== 1 ? "s" : ""})
                </h2>
                <span className="text-sm text-gray-400">{studentsOpen ? "▲ Hide" : "▼ Show"}</span>
              </button>

              {studentsOpen && (
                <div className="divide-y divide-gray-100 border-t border-gray-100">
                  {r.perStudentRows.length === 0 && (
                    <p className="px-5 py-4 text-sm text-gray-400">No completed lessons in {r.year}.</p>
                  )}
                  {r.perStudentRows.map((row) => (
                    <div key={row.student.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-[#1b2d4f]">{row.student.name}</span>
                        {row.student.deleted_at && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Deleted</span>
                        )}
                        {!row.student.deleted_at && row.student.archived && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Archived</span>
                        )}
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                        <div>
                          <p className="text-xs text-gray-400">Lessons</p>
                          <p className="font-medium text-gray-800">{row.lessonCount}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Gross fees</p>
                          <p className="font-medium text-gray-800">{formatSGD(row.gross)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Agency / placement share</p>
                          <p className="font-medium text-gray-800">{formatSGD(row.placementFee + row.agencyShareA)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Your revenue</p>
                          <p className="font-medium text-[#1b2d4f]">{formatSGD(row.revenue)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Paid</p>
                          <p className="font-medium text-green-700">{formatSGD(row.paid)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Written off</p>
                          <p className="font-medium text-gray-500">{formatSGD(row.writtenOff)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Outstanding</p>
                          <p className={`font-medium ${row.outstanding > 0 ? "text-amber-700" : "text-gray-400"}`}>
                            {formatSGD(row.outstanding)}
                          </p>
                        </div>
                        {row.commissionB > 0 && (
                          <div>
                            <p className="text-xs text-gray-400">Commission paid</p>
                            <p className="font-medium text-gray-500">{formatSGD(row.commissionB)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        <p className="pb-4 text-center text-xs text-gray-400">
          Prepared from your ChopeAndPay records. Not tax advice — check with IRAS or an accountant, especially for agency income.
        </p>
      </div>
    </AppShell>
  );
}
