import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { useAuth } from "../contexts/AuthContext";
import { formatSGD } from "../lib/paymentNotice";
import { loadMonthCloseData } from "../lib/monthCloseData";
import {
  CHECKLIST_TYPES,
  buildChecklist,
  buildMonthSnapshot,
  canCloseMonth,
  isMonthStr,
  monthLabel,
  monthName,
  monthShort,
  pickDefaultMonth,
  sgtDateKey,
  sgtStamp,
  sgtTodayKey,
  shiftMonth,
} from "../lib/monthClose";

const usd = (c) => formatSGD(c / 100);
const SHOW_LIMIT = 5;
const AGENCY_COLORS = ["#1b2d4f", "#3d5a8c", "#7c93bd", "#aab9d3"];
const monthOfDate = (d) => String(d ?? "").slice(0, 7);

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-[#b8e8d9] bg-white p-4 text-center">
      <p className={`text-xl font-semibold ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-600">{label}</p>
    </div>
  );
}

function Chip({ children, tone = "gray" }) {
  const tones = {
    gray: "bg-gray-100 text-gray-600",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-800",
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

function DoneRow({ children }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5ecfaa] text-xs font-bold text-[#1b2d4f]">
        ✓
      </span>
      <span className="text-sm text-gray-700">{children}</span>
    </li>
  );
}

function OpenRow({ item }) {
  return (
    <li className="flex items-start gap-3 py-2">
      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-amber-500 bg-white" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-gray-900">{item.label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.tag && <Chip tone={item.tag === "Overdue" ? "red" : item.tag === "Pending" ? "amber" : "gray"}>{item.tag}</Chip>}
          {item.chip && <Chip>{item.chip}</Chip>}
          {item.deleted ? <Chip tone="red">Deleted</Chip> : item.archived ? <Chip>Archived</Chip> : null}
          {item.type === "statement" && (
            <Link
              to={`/statements?payee=${item.payee_id}&month=${item.origin_month}`}
              className="text-xs font-medium text-[#0f7a58] hover:underline"
            >
              Open statement →
            </Link>
          )}
          {item.type === "zero_rate_lesson" && (
            <Link to="/lessons" className="text-xs font-medium text-[#0f7a58] hover:underline">
              Fix in Lessons →
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function WhoEarnsWhat({ snap, monthStr }) {
  const [openAgency, setOpenAgency] = useState(null);
  const t = snap.totals;
  const segments = [
    { key: "mine", cents: t.mine_cents, color: "#5ecfaa" },
    ...snap.agencies.map((a, i) => ({
      key: a.name,
      cents: a.cents,
      color: AGENCY_COLORS[i % AGENCY_COLORS.length],
    })),
  ];
  const pct = (n) => Number(n.toFixed(2));
  return (
    <section className="mt-4 rounded-xl border border-[#b8e8d9] bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Who earns what</h2>
      {t.gross_cents > 0 && (
        <div className="mb-3 flex h-3 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
          {segments.map((s) => (
            <div key={s.key} style={{ width: `${(s.cents / t.gross_cents) * 100}%`, background: s.color }} />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between py-0.5 text-sm">
        <span className="text-gray-700">My take-home</span>
        <span className="font-semibold text-[#0f7a58]">{usd(t.mine_cents)}</span>
      </div>
      {snap.agencies.map((a) => {
        const isOpen = openAgency === a.name.toLowerCase();
        const hasShare = a.lines.some((l) => l.kind === "share");
        const hasPlacement = a.lines.some((l) => l.kind === "placement");
        const sub = [
          hasShare && a.share_percent != null ? `${pct(100 - a.share_percent)}% share` : null,
          hasPlacement ? "placement fees" : null,
        ]
          .filter(Boolean)
          .join(" + ");
        return (
          <div key={a.name}>
            <button
              type="button"
              onClick={() => setOpenAgency(isOpen ? null : a.name.toLowerCase())}
              aria-expanded={isOpen}
              className="flex min-h-8 w-full items-center justify-between rounded py-0.5 text-sm text-gray-600 hover:bg-[#edf6f3]"
            >
              <span>
                {isOpen ? "▾" : "▸"} {a.name}
                {sub && <span className="text-xs text-gray-500">, {sub}</span>}
              </span>
              <span className="font-medium underline decoration-dotted underline-offset-2">{usd(a.cents)}</span>
            </button>
            {isOpen && (
              <div className="mb-1 ml-4 rounded-md bg-[#edf6f3] p-2 text-xs text-gray-600">
                {a.lines.map((l) => (
                  <div key={`${l.kind}-${l.student}`} className="flex items-start justify-between gap-2 py-0.5">
                    <span>
                      {l.student}
                      <span className="block text-[11px] text-gray-500">
                        {l.kind === "placement"
                          ? "Placement fee (100%)"
                          : `${pct(100 - a.share_percent)}% of ${usd(l.billed_cents)}${
                              l.collected_by === "me" ? " · you collected" : " · agency collected"
                            }`}
                      </span>
                    </span>
                    <span className="font-medium text-gray-800">{usd(l.cents)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-[#b8e8d9] pt-1 font-semibold text-gray-800">
                  <span>{a.name} earns</span>
                  <span>{usd(a.cents)}</span>
                </div>
                {a.payee_id && (
                  <Link
                    to={`/statements?payee=${a.payee_id}&month=${monthStr}`}
                    className="mt-1 inline-block font-medium text-[#0f7a58] hover:underline"
                  >
                    Open {a.name} statement →
                  </Link>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="mt-1 flex items-center justify-between border-t border-[#b8e8d9] pt-1.5 text-sm">
        <span className="font-medium text-gray-700">Total billed</span>
        <span className="font-semibold text-gray-900">{usd(t.gross_cents)}</span>
      </div>
    </section>
  );
}

function Checklist({ snap, items, monthStr, noticeCount }) {
  const [expanded, setExpanded] = useState({});
  const mName = monthName(monthStr);
  const t = snap.totals;
  const rowsOf = (type) => items.filter((i) => i.type === type);

  const group = (type, doneLines) => {
    const rows = rowsOf(type);
    const shown = expanded[type] ? rows : rows.slice(0, SHOW_LIMIT);
    return (
      <>
        {rows.length === 0 ? doneLines : null}
        {shown.map((it) => (
          <OpenRow key={it.key} item={it} />
        ))}
        {rows.length > SHOW_LIMIT && !expanded[type] && (
          <li className="py-1 pl-8">
            <button
              type="button"
              onClick={() => setExpanded((e) => ({ ...e, [type]: true }))}
              className="text-xs font-medium text-[#0f7a58] hover:underline"
            >
              Show {rows.length - SHOW_LIMIT} more
            </button>
          </li>
        )}
      </>
    );
  };

  const sentStatements = snap.statements.filter((s) => s.status !== "none");
  const statementRows = rowsOf("statement");

  return (
    <section className="mt-4 rounded-xl border border-[#b8e8d9] bg-white p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Before you close</h2>
      <ul className="divide-y divide-gray-100">
        {group(
          CHECKLIST_TYPES[0],
          <DoneRow>{t.lessons > 0 ? `All ${t.lessons} lessons marked done` : "No lessons to mark done"}</DoneRow>,
        )}
        {group(CHECKLIST_TYPES[1], null)}
        {group(
          CHECKLIST_TYPES[2],
          <DoneRow>
            {noticeCount > 0 ? `Every ${mName} notice is paid` : `No payment notices for ${mName}`}
          </DoneRow>,
        )}
        {group(CHECKLIST_TYPES[3], <DoneRow>Every completed lesson is billed</DoneRow>)}
        {sentStatements.map((s) => (
          <DoneRow key={s.payee_id}>
            {s.name} statement sent{s.claimed_total_cents != null ? `, ${usd(s.claimed_total_cents)}` : ""}
          </DoneRow>
        ))}
        {statementRows.length > 0 && group(CHECKLIST_TYPES[4], null)}
        <DoneRow>
          {t.cash_written_off_cents > 0
            ? `Written off in ${mName}: ${usd(t.cash_written_off_cents)}`
            : "Nothing to write off"}
        </DoneRow>
      </ul>
    </section>
  );
}

export default function MonthClose() {
  const { user } = useAuth();
  const tutorId = user?.id;
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";
  const [searchParams, setSearchParams] = useSearchParams();

  const currentMonth = sgtTodayKey().slice(0, 7);
  const rawParam = searchParams.get("month");
  // Invalid, future or absurdly old months fall back to the default month.
  const requested =
    isMonthStr(rawParam) && rawParam <= currentMonth && rawParam >= "2000-01" ? rawParam : null;

  const [phase, setPhase] = useState("loading");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadedMonthRef = useRef(null);

  useEffect(() => {
    if (!tutorId || isPractitioner) return;
    if (requested && loadedMonthRef.current === requested) return;
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setError(null);
      try {
        let target = requested ?? shiftMonth(sgtTodayKey().slice(0, 7), -1);
        let d = await loadMonthCloseData(tutorId, target);
        if (!requested) {
          const def = pickDefaultMonth({
            todayKey: d.todayKey,
            students: d.students,
            lessons: d.lessons,
            cycles: d.cycles,
            closes: d.closes,
          });
          if (def !== target) {
            target = def;
            d = await loadMonthCloseData(tutorId, def);
          }
        }
        if (cancelled) return;
        loadedMonthRef.current = target;
        setData({ ...d, loadedAt: sgtStamp() });
        setPhase("ready");
        if (!requested) setSearchParams({ month: target }, { replace: true });
      } catch (e) {
        if (cancelled) return;
        console.error("[MonthClose] load failed", e);
        setError(e?.message ?? "Unknown error");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tutorId, isPractitioner, requested, reloadKey, setSearchParams]);

  const view = useMemo(() => {
    if (!data) return null;
    const { monthStr } = data;
    const snap = buildMonthSnapshot({
      monthStr,
      students: data.students,
      payees: data.payees,
      lessons: data.lessons,
      cycles: data.cycles,
      statements: data.statements,
      carried: [],
      takenAt: data.loadedAt,
    });
    const items = buildChecklist({
      monthStr,
      students: data.students,
      payees: data.payees,
      lessons: data.lessons,
      cycles: data.cycles,
      statements: data.statements,
      closes: data.closes,
      upcomingStudentIds: data.upcomingStudentIds,
      snapshot: snap,
    });
    const realIds = new Set(data.students.filter((s) => !s.is_practice).map((s) => s.id));
    const noticeCount = data.cycles.filter(
      (c) => realIds.has(c.student_id) && monthOfDate(c.period_end) === monthStr,
    ).length;
    return { snap, items, noticeCount };
  }, [data]);

  const goToMonth = (m) => setSearchParams({ month: m });
  const tryAgain = () => {
    loadedMonthRef.current = null;
    setReloadKey((k) => k + 1);
  };

  if (isPractitioner) {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg p-6 text-sm text-gray-600">
          Month-end close is for tutors only.
        </div>
      </AppShell>
    );
  }

  if (phase === "error") {
    return (
      <AppShell>
        <div className="mx-auto max-w-lg px-4 py-6">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
            <p>Couldn&apos;t load this month. Check your connection and try again.</p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
            <button
              onClick={tryAgain}
              className="mt-3 min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Try again
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (phase === "loading" || !view) {
    return (
      <AppShell>
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-3 px-4 py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#5ecfaa] border-t-transparent" />
          <p className="text-sm text-gray-500">
            Adding up {requested ? monthName(requested) : "this month"}…
          </p>
        </div>
      </AppShell>
    );
  }

  const { snap, items, noticeCount } = view;
  const monthStr = data.monthStr;
  const t = snap.totals;
  const over = canCloseMonth(monthStr, data.todayKey);
  const nothing =
    over &&
    items.length === 0 &&
    t.lessons === 0 &&
    noticeCount === 0 &&
    t.cash_collected_cents === 0 &&
    t.cash_written_off_cents === 0;
  const closeRow = data.closes.find((c) => monthOfDate(c.month) === monthStr);
  const intro = !over
    ? `Preview. You can close ${monthName(monthStr)} from 1 ${monthShort(shiftMonth(monthStr, 1))}.`
    : items.length === 0
      ? "Everything is in order. Ready when you are."
      : items.length === 1
        ? "One thing left to decide, then you can close the month."
        : `${items.length} things left to decide, then you can close the month.`;

  return (
    <AppShell>
      <div className="mx-auto max-w-lg px-4 py-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Month-end close</p>
            <h1 className="text-xl font-bold text-[#1b2d4f]">{monthLabel(monthStr)}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToMonth(shiftMonth(monthStr, -1))}
              aria-label="Previous month"
              className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-2.5 text-sm text-gray-600 hover:bg-[#d6ede6]"
            >
              ←
            </button>
            <button
              onClick={() => goToMonth(shiftMonth(monthStr, 1))}
              disabled={monthStr >= currentMonth}
              aria-label="Next month"
              className="min-h-11 rounded-md border border-[#93d9c4] bg-white px-2.5 text-sm text-gray-600 hover:bg-[#d6ede6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              →
            </button>
          </div>
        </div>

        {nothing ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
            Nothing happened in {monthLabel(monthStr)} — no lessons, no payments. Nothing to close.
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-gray-600">{intro}</p>

            {closeRow && (
              <p className="mt-2 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-600">
                {closeRow.status === "closed"
                  ? `Closed on ${sgtDateKey(closeRow.closed_at)}. The closed view comes in the next update; these are live figures.`
                  : `Reopened. These are live figures.`}
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Tile label="Lessons taught" value={t.lessons} />
              <Tile label="My take-home" value={usd(t.mine_cents)} tone="text-[#0f7a58]" />
              <Tile label="Collected" value={usd(t.notices_paid_cents)} />
              <Tile label="Pending" value={usd(t.notices_pending_cents)} tone="text-amber-700" />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Cash received in {monthName(monthStr)} (any month&apos;s notices): {usd(t.cash_collected_cents)} ·
              Written off in {monthName(monthStr)}: {usd(t.cash_written_off_cents)}
            </p>

            <WhoEarnsWhat snap={snap} monthStr={monthStr} />
            <Checklist snap={snap} items={items} monthStr={monthStr} noticeCount={noticeCount} />

            <button
              disabled
              className="mt-5 min-h-11 w-full cursor-not-allowed rounded-md bg-gray-200 px-4 text-sm font-medium text-gray-500"
            >
              {over
                ? "Closing comes in the next update"
                : `You can close ${monthName(monthStr)} from 1 ${monthShort(shiftMonth(monthStr, 1))}`}
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
