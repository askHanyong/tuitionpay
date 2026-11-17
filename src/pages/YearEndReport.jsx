import { useEffect, useState, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { formatSGD } from "../lib/paymentNotice";
import { formatMonth } from "../utils/dateFormat";
import {
  buildChecks,
  computeMonthlyBreakdowns,
  computeBilledReconciliation,
  computePerStudentRows,
  isUnpaidNoticeInYear,
  sgtInYear,
  sgtMonth,
} from "../lib/yearEndReport";
import AppShell from "../components/AppShell";

const PAGE_SIZE = 900;
const THIS_YEAR = new Date().getFullYear();
const AVAILABLE_YEARS = Array.from({ length: THIS_YEAR - 2019 }, (_, i) => THIS_YEAR - i);
const LESSON_COLS =
  "id, student_id, lesson_date, lesson_time, is_completed, rate, rate_type, duration_minutes, payment_cycle_id";
const SETUP_LABEL = {
  direct: "Direct",
  A: "Agency collects",
  B: "You collect, pay agency",
};

// Supabase caps a query at 1,000 rows; keep paging until a short page comes back.
async function fetchPaged(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadReportData({ tutorId, year }) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year + 1}-01-01`;
  // paid_at / waived_at are filtered in UTC by the database, so the lower bound
  // is Singapore midnight on 1 Jan expressed in UTC.
  const yearStartUtc = new Date(`${yearStart}T00:00:00+08:00`).toISOString();

  const { data: studentsData, error: studentsErr } = await supabase
    .from("students")
    .select(
      "id, name, hourly_rate, payment_mode, payment_cycle_count, payee_id, fee_collected_by, placement_fee_agency, placement_fee_amount, placement_fee_start, archived, deleted_at",
    )
    .eq("tutor_id", tutorId);
  if (studentsErr) throw studentsErr;
  const students = studentsData ?? [];

  const { data: payeesData, error: payeesErr } = await supabase
    .from("payees")
    .select("id, name, share_percent")
    .eq("tutor_id", tutorId);
  if (payeesErr) throw payeesErr;
  const payees = payeesData ?? [];

  const lessonsBase = () =>
    supabase
      .from("lessons")
      .select(LESSON_COLS)
      .eq("tutor_id", tutorId)
      .eq("is_completed", true);
  const ordered = (q) =>
    q
      .order("lesson_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

  const yearLessons = await fetchPaged(() =>
    ordered(lessonsBase().gte("lesson_date", yearStart).lt("lesson_date", yearEnd)),
  );

  // A placement fee drains from the student's earliest lessons, possibly in
  // earlier years. Without a start date we cannot know where it began, so load
  // all of that student's earlier lessons; with one, load from the earliest start.
  const feeStudents = students.filter((s) => Number(s.placement_fee_amount) > 0);
  let priorLessons = [];
  if (feeStudents.length > 0) {
    const missingStart = feeStudents.some((s) => !s.placement_fee_start);
    const earliestStart = feeStudents.reduce(
      (min, s) =>
        s.placement_fee_start && (!min || s.placement_fee_start < min)
          ? s.placement_fee_start
          : min,
      null,
    );
    if (missingStart || earliestStart < yearStart) {
      priorLessons = await fetchPaged(() => {
        let q = lessonsBase()
          .in("student_id", feeStudents.map((s) => s.id))
          .lt("lesson_date", yearStart);
        if (!missingStart) q = q.gte("lesson_date", earliestStart);
        return ordered(q);
      });
    }
  }

  const cycles = await fetchPaged(() =>
    supabase
      .from("payment_cycles")
      .select(
        "id, student_id, amount_due, status, period_start, period_end, paid_at, waived_at, waived_from_status",
      )
      .eq("tutor_id", tutorId)
      .or(
        `period_end.gte.${yearStart},paid_at.gte.${yearStartUtc},waived_at.gte.${yearStartUtc}`,
      )
      .order("id", { ascending: true }),
  );

  // Any placement (active or ended) that overlaps the report year. Declined or
  // still-pending requests never ran, so they carry no income.
  const yearEndUtc = new Date(`${yearEnd}T00:00:00+08:00`).toISOString();
  const { data: placementsData, error: placementsErr } = await supabase
    .from("agency_placements")
    .select("id")
    .eq("tutor_id", tutorId)
    .in("status", ["active", "ended"])
    .lt("started_at", yearEndUtc)
    .or(`ended_at.is.null,ended_at.gte.${yearStartUtc}`)
    .limit(50);
  if (placementsErr) throw placementsErr;

  return {
    year,
    students,
    payees,
    lessons: [...priorLessons, ...yearLessons],
    cycles,
    agencyPlacements: placementsData ?? [],
  };
}

function downloadCSV({ year, perStudentRows, annualRevenue, annualCommissionB, writtenOffInYear, unpaidNoticesTotal }) {
  const header = ["Student", "Status", "Lessons", "Gross fees", "Agency/placement share", "Your revenue", "Commission paid (set-up B)", "Paid", "Written off", "Unpaid notices"];
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
      r.unpaidNotices.toFixed(2),
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
    unpaidNoticesTotal.toFixed(2),
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
  const tutorId = user?.id;
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";

  const [year, setYear] = useState(THIS_YEAR - 1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rawData, setRawData] = useState(null);
  const [studentsOpen, setStudentsOpen] = useState(false);

  useEffect(() => {
    if (!tutorId || isPractitioner) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setRawData(null);
      try {
        const data = await loadReportData({ tutorId, year });
        if (!cancelled) setRawData(data);
      } catch (e) {
        if (!cancelled) setError(e.message ?? "Failed to load report data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, tutorId, isPractitioner]);

  const report = useMemo(() => {
    if (!rawData) return null;
    const { year: dataYear, students, payees, lessons, cycles } = rawData;
    const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

    const baseMonths = computeMonthlyBreakdowns({ year: dataYear, students, payees, lessons });
    const annualRevenue = sum(baseMonths, (m) => m.revenue);
    const annualCommissionB = sum(baseMonths, (m) => m.commissionB);
    const annualGross = sum(baseMonths, (m) => m.gross);
    const annualAgencyShare = sum(baseMonths, (m) => m.agencyShare);
    const annualMine = sum(baseMonths, (m) => m.mine);
    const annualLessons = sum(baseMonths, (m) => m.lessonCount);

    const paidCycles = cycles.filter((c) => c.status === "paid" && c.paid_at);
    const waivedCycles = cycles.filter((c) => c.status === "waived" && c.waived_at);
    const amountSum = (list) => sum(list, (c) => Number(c.amount_due));
    const collectedInYear = amountSum(paidCycles.filter((c) => sgtInYear(c.paid_at, dataYear)));
    const writtenOffInYear = amountSum(waivedCycles.filter((c) => sgtInYear(c.waived_at, dataYear)));

    // Unpaid notices: what payers still owe, as billed (before any agency share).
    const unpaidNoticesTotal = amountSum(cycles.filter((c) => isUnpaidNoticeInYear(c, dataYear)));
    const reconciliation = computeBilledReconciliation({
      year: dataYear,
      students,
      lessons,
      cycles,
    });

    const months = baseMonths.map((m) => ({
      ...m,
      collected: amountSum(paidCycles.filter((c) => sgtMonth(c.paid_at) === m.monthPrefix)),
      writtenOff: amountSum(waivedCycles.filter((c) => sgtMonth(c.waived_at) === m.monthPrefix)),
    }));

    const perStudentRows = computePerStudentRows({
      year: dataYear,
      students,
      payees,
      lessons,
      cycles,
    });

    const checks = buildChecks({
      months,
      perStudentRows,
      annualRevenue,
      annualGross,
      annualAgencyShare,
      annualCommissionB,
      annualLessons,
      collectedInYear,
      writtenOffInYear,
      monthsCollected: sum(months, (m) => m.collected),
      monthsWrittenOff: sum(months, (m) => m.writtenOff),
      reconciliation,
    });

    return {
      year: dataYear,
      annualRevenue,
      annualCommissionB,
      annualGross,
      annualAgencyShare,
      annualMine,
      annualLessons,
      writtenOffInYear,
      collectedInYear,
      unpaidNoticesTotal,
      reconciliation,
      months,
      perStudentRows,
      checks,
      failedChecks: checks.filter((c) => !c.ok),
    };
  }, [rawData]);

  useEffect(() => {
    if (!report) return;
    for (const c of report.failedChecks) {
      console.error("[YearEndReport] Check failed:", c.label, c.a, c.b);
    }
  }, [report]);

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
                  onClick={() => downloadCSV({ year, perStudentRows: r.perStudentRows, annualRevenue: r.annualRevenue, annualCommissionB: r.annualCommissionB, writtenOffInYear: r.writtenOffInYear, unpaidNoticesTotal: r.unpaidNoticesTotal })}
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
            You have {rawData.agencyPlacements.length === 50 ? "50+" : rawData.agencyPlacements.length} agency
            placement{rawData.agencyPlacements.length !== 1 ? "s" : ""} that overlap {rawData.year}. Income from students placed through the agency platform isn't included in this report yet. Check with your agency for a separate statement.
          </div>
        )}

        {r && r.failedChecks.length > 0 && (
          <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-semibold">
              Some figures in this report don't add up. Don't rely on it until this is resolved.
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {r.failedChecks.map((c) => (
                <li key={c.label}>
                  {c.label}: {c.unit === "count" ? c.a : formatSGD(c.a)} vs{" "}
                  {c.unit === "count" ? c.b : formatSGD(c.b)}
                </li>
              ))}
            </ul>
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
                label="Unpaid notices"
                value={formatSGD(r.unpaidNoticesTotal)}
                sub="As billed, before any agency share"
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
                <div className="flex justify-between gap-4 font-semibold text-gray-800">
                  <span>Gross fees for lessons taught in {r.year}</span>
                  <span>{formatSGD(r.annualGross)}</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Paid</span>
                  <span>{formatSGD(r.reconciliation.paid)}</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Written off</span>
                  <span>{formatSGD(r.reconciliation.writtenOff)}</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Billed, still unpaid</span>
                  <span>{formatSGD(r.reconciliation.unpaid)}</span>
                </div>
                <div className="flex justify-between gap-4 text-gray-600">
                  <span>Not yet billed</span>
                  <span>{formatSGD(r.reconciliation.unbilled)}</span>
                </div>
                <div className="flex justify-between gap-4 border-t border-gray-200 pt-2 font-semibold text-[#1b2d4f]">
                  <span>Total</span>
                  <span>
                    {formatSGD(
                      r.reconciliation.paid + r.reconciliation.writtenOff + r.reconciliation.unpaid + r.reconciliation.unbilled,
                    )}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                All lines are fees as billed, before any agency share, split by the status of each lesson's notice today. Your revenue (after agency share) is shown above, not here.
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
                  <p className="px-5 py-3 text-xs text-gray-400">
                    Paid, written off and unpaid notices are amounts as billed to the payer, not your revenue. They are not subtracted from it.
                  </p>
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
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                          {SETUP_LABEL[row.setup]}
                        </span>
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
                          <p className="text-xs text-gray-400">
                            {row.setup === "A" ? `Unpaid (collected by ${row.payeeName})` : "Unpaid notices"}
                          </p>
                          <p className={`font-medium ${row.unpaidNotices > 0 ? "text-amber-700" : "text-gray-400"}`}>
                            {formatSGD(row.unpaidNotices)}
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

        {r && r.failedChecks.length === 0 && (
          <p className="no-print text-center text-xs text-gray-400">
            Consistency checks passed ({r.checks.length}/{r.checks.length})
          </p>
        )}

        {/* Footer */}
        <p className="pb-4 text-center text-xs text-gray-400">
          Prepared from your ChopeAndPay records. Not tax advice — check with IRAS or an accountant, especially for agency income.
        </p>
      </div>
    </AppShell>
  );
}
