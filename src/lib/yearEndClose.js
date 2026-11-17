// Year-end report x month-end close (spec 3.6, 4.8, 6.8). Pure: no Supabase,
// no clock (today is passed in). Money in cents until display.
import {
  buildMonthSnapshot,
  compareSnapshotToLive,
  monthBounds,
  monthShort,
  monthName,
} from "./monthClose";

const monthOf = (d) => String(d ?? "").slice(0, 7);

// One row per month of the year, with the figures to DISPLAY and a state.
// State comes only from month_closes.status (+ calc_version via compare).
//   closed | changed | old_calc | reopened | open | nothing | in_progress
export function buildYearRows({ year, students, payees, lessons, cycles, closes, changeLog = [], todayKey }) {
  const closeByMonth = new Map((closes ?? []).map((c) => [monthOf(c.month), c]));
  const logCount = new Map();
  for (const r of changeLog) {
    if (r.entity_type === "month_close") continue;
    logCount.set(monthOf(r.month), (logCount.get(monthOf(r.month)) ?? 0) + 1);
  }
  return Array.from({ length: 12 }, (_, i) => {
    const monthStr = `${year}-${String(i + 1).padStart(2, "0")}`;
    const live = buildMonthSnapshot({ monthStr, students, payees, lessons, cycles, takenAt: null });
    const over = todayKey >= monthBounds(monthStr).nextStart;
    const close = closeByMonth.get(monthStr);
    const lt = live.totals;
    let state;
    let snap = null;
    if (close?.status === "closed" && close.snapshot?.totals) {
      snap = close.snapshot;
      const compare = compareSnapshotToLive(snap, live);
      state = compare.status === "same" ? "closed" : compare.status === "changed" ? "changed" : "old_calc";
    } else if (close?.status === "reopened") {
      state = "reopened";
    } else if (!over) {
      state = "in_progress";
    } else {
      const hasNotice = cycles.some((c) => monthOf(c.period_end) === monthStr);
      const nothing =
        lt.lessons === 0 && lt.cash_collected_cents === 0 && lt.cash_written_off_cents === 0 && !hasNotice;
      state = nothing ? "nothing" : "open";
    }
    const t = snap ? snap.totals : lt;
    const hasNoticeInMonth = cycles.some((c) => monthOf(c.period_end) === monthStr);
    return {
      empty:
        t.lessons === 0 && t.cash_collected_cents === 0 && t.cash_written_off_cents === 0 &&
        lt.lessons === 0 && lt.cash_collected_cents === 0 && lt.cash_written_off_cents === 0 &&
        !hasNoticeInMonth,
      monthStr,
      state,
      locked: Boolean(snap),
      ready: state === "closed" || state === "nothing",
      over,
      lessons: t.lessons,
      gross: t.gross_cents,
      agency: t.agency_cents,
      revenue: t.revenue_cents,
      commissionB: t.commission_b_cents,
      collected: t.cash_collected_cents,
      writtenOff: t.cash_written_off_cents,
      liveRevenue: lt.revenue_cents,
      revenueDiff: snap ? lt.revenue_cents - snap.totals.revenue_cents : 0,
      loggedEdits: logCount.get(monthStr) ?? 0,
    };
  });
}

export function sumRows(rows) {
  const s = (k) => rows.reduce((a, r) => a + r[k], 0);
  return {
    lessons: s("lessons"), gross: s("gross"), agency: s("agency"), revenue: s("revenue"),
    commissionB: s("commissionB"), collected: s("collected"), writtenOff: s("writtenOff"),
  };
}

// "Jan–Mar" / "Jan, Mar–Apr"
function rangeText(monthStrs) {
  const out = [];
  let i = 0;
  while (i < monthStrs.length) {
    let j = i;
    while (j + 1 < monthStrs.length && Number(monthStrs[j + 1].slice(5)) === Number(monthStrs[j].slice(5)) + 1) j++;
    out.push(j > i ? `${monthShort(monthStrs[i])}–${monthShort(monthStrs[j])}` : monthShort(monthStrs[i]));
    i = j + 1;
  }
  return out.join(", ");
}

export function buildReadiness({ year, rows, todayKey }) {
  const yearOver = todayKey >= `${year + 1}-01-01`;
  const scope = yearOver ? rows : rows.filter((r) => r.over);
  const readyCount = scope.filter((r) => r.ready).length;
  const todo = scope.filter((r) => !r.ready).map((r) => r.monthStr);
  const nothing = rows.filter((r) => r.state === "nothing").map((r) => r.monthStr);
  const changed = rows.filter((r) => r.state === "changed");
  const allReady = yearOver && readyCount === 12;
  return {
    yearOver, total: scope.length, readyCount, todo, allReady, changed,
    noActivity: rows.every((r) => r.empty),
    nothingText: nothing.length ? `${rangeText(nothing)}: no lessons or payments, nothing to close.` : null,
  };
}

const nameList = (ms) => ms.map((m) => monthName(m)).join(", ");
export function readinessSentence(rd, year) {
  if (rd.noActivity) return `No lessons or payments in ${year}.`;
  if (rd.allReady) return "All 12 months closed and unchanged. Ready to share with your accountant.";
  if (!rd.yearOver) {
    const first = rd.todo[0];
    const tail = rd.todo.length === 1
      ? ` ${monthName(first)} isn't closed yet.`
      : rd.todo.length > 1 ? ` Not ready yet: ${nameList(rd.todo)}.` : "";
    return `${year} so far: ${rd.readyCount} of ${rd.total} finished months ready.${tail}`;
  }
  return `${rd.readyCount} of 12 months ready. Close or review: ${nameList(rd.todo)}.`;
}

const money = (cents) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const prettyDate = (key) => `${Number(key.slice(8))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export function buildSummaryText({ year, totals, rows, readiness, todayKey }) {
  const notReady = rows.filter((r) => !r.ready);
  const notClosed = notReady.filter((r) => !r.locked);
  const changed = rows.filter((r) => r.state === "changed" || r.state === "old_calc");
  let status;
  if (readiness.noActivity) status = `no lessons or payments in ${year}`;
  else if (readiness.allReady) status = "all 12 months closed and unchanged";
  else {
    const list = notClosed.map((r) => monthShort(r.monthStr)).join(", ");
    status = `DRAFT — ${notClosed.length} month${notClosed.length === 1 ? "" : "s"} not closed${list ? ` (${list})` : ""}`;
    if (changed.length) status += `; ${changed.length} changed since closing (${changed.map((r) => monthShort(r.monthStr)).join(", ")})`;
  }
  const lines = [
    `Income summary ${year} (Year of Assessment ${year + 1}), earned basis`,
    `Prepared from ChopeAndPay on ${prettyDate(todayKey)}`,
    `Status: ${status}`,
    "",
    `Revenue: ${money(totals.revenue)}`,
  ];
  if (totals.commissionB > 0) lines.push(`Commission paid to agencies: ${money(totals.commissionB)}`);
  lines.push(
    `Adjusted profit before expenses: ${money(totals.revenue - totals.commissionB)}`,
    `Bad debts written off in ${year}: ${money(totals.writtenOff)}`,
    `Collected in ${year}: ${money(totals.collected)}`,
    `Lessons taught: ${totals.lessons}`,
    "",
    "Expenses are not tracked in ChopeAndPay. Not tax advice.",
  );
  return lines.join("\n");
}
