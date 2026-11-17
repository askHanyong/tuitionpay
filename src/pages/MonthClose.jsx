import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import Confetti from "../components/Confetti";
import MonthCloseChecklist from "../components/MonthCloseChecklist";
import ReopenMonthModal from "../components/ReopenMonthModal";
import { ChangedAfterClosePanel, SinceCloseStrip } from "../components/ClosedMonthChanges";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { formatSGD } from "../lib/paymentNotice";
import { clearClosedMonthsCache, confirmClosedMonthChange } from "../lib/closedMonths";
import { loadMonthCloseData } from "../lib/monthCloseData";
import {
  AFTER_SAVE_MISMATCH_MESSAGE,
  buildCarriedEntries,
  buildChecklist,
  buildMonthSnapshot,
  canCloseMonth,
  carriedKeySet,
  carryKey,
  checkSnapshot,
  classifyChanges,
  closedCardSentence,
  compareSnapshotToLive,
  dayLabel,
  findEarlierUnclosedMonth,
  isMonthStr,
  lessonToggleDates,
  mapCloseError,
  mapReopenError,
  monthLabel,
  monthName,
  monthShort,
  pendingIsCarried,
  pickDefaultMonth,
  pruneDraft,
  sameTotals,
  sgtDateKey,
  sgtStamp,
  sgtTodayKey,
  shiftMonth,
  unresolvedItems,
  BAD_SNAPSHOT_MESSAGE,
  STALE_PAGE_MESSAGE,
} from "../lib/monthClose";
import {
  billStudentNow,
  clearDraft,
  closeMonthRpc,
  deleteLessonWithCalendar,
  fetchUnbilledLessons,
  markLessonDone,
  markNoticePaid,
  readCloseRow,
  readDraft,
  reopenMonthRpc,
  sumLessons,
  writeDraft,
  writeOffNotice,
} from "../lib/monthCloseActions";

const usd = (c) => formatSGD(c / 100);
const AGENCY_COLORS = ["#1b2d4f", "#3d5a8c", "#7c93bd", "#aab9d3"];
const monthOfDate = (d) => String(d ?? "").slice(0, 7);

function computeView(data) {
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
}

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-[#b8e8d9] bg-white p-4 text-center">
      <p className={`text-xl font-semibold ${tone ?? "text-gray-900"}`}>{value}</p>
      <p className="mt-1 text-xs font-medium text-gray-600">{label}</p>
    </div>
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

export default function MonthClose() {
  const { user } = useAuth();
  const { showToast } = useToast();
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

  const [draft, setDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [closeError, setCloseError] = useState(null);
  const [justClosed, setJustClosed] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenError, setReopenError] = useState(null);

  // Show fresh data and keep the carry draft in step with it: entries whose item
  // no longer exists are dropped (6.5).
  const applyFresh = useCallback(
    (d, currentDraft) => {
      const withStamp = { ...d, loadedAt: sgtStamp() };
      const v = computeView(withStamp);
      const pruned = pruneDraft(currentDraft, v.items);
      if (pruned.length) writeDraft(tutorId, d.monthStr, pruned);
      else clearDraft(tutorId, d.monthStr);
      setDraft(pruned);
      setData(withStamp);
      return { view: v, pruned, data: withStamp };
    },
    [tutorId],
  );

  useEffect(() => {
    if (!tutorId || isPractitioner) return;
    if (requested && loadedMonthRef.current === requested) return;
    let cancelled = false;
    (async () => {
      setPhase("loading");
      setError(null);
      setActionError(null);
      setCloseError(null);
      setJustClosed(false);
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
        applyFresh(d, readDraft(tutorId, target));
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
  }, [tutorId, isPractitioner, requested, reloadKey, setSearchParams, applyFresh]);

  const view = useMemo(() => (data ? computeView(data) : null), [data]);
  const clearConfetti = useCallback(() => setJustClosed(false), []);

  const goToMonth = (m) => setSearchParams({ month: m });
  const tryAgain = () => {
    loadedMonthRef.current = null;
    setReloadKey((k) => k + 1);
  };

  const refresh = async (useDraft = draft) => {
    const d = await loadMonthCloseData(tutorId, data.monthStr);
    return applyFresh(d, useDraft);
  };

  // Runs one checklist action: no double submits, visible error, reload after.
  // The action returns false when the tutor cancelled a confirm (nothing happens).
  const runAction = async (fn) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await fn();
      if (result === false) return;
      await refresh();
    } catch (e) {
      console.error("[MonthClose] action failed", e);
      const message = e?.message ?? "Something went wrong.";
      setActionError(message);
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
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

  const { snap: liveSnap, items, noticeCount } = view;
  const monthStr = data.monthStr;
  const mName = monthName(monthStr);
  const nextName = monthName(shiftMonth(monthStr, 1));
  const over = canCloseMonth(monthStr, data.todayKey);
  const closeRow = data.closes.find((c) => monthOfDate(c.month) === monthStr) ?? null;
  // State comes ONLY from month_closes.status (never from reopened_at / reopen_reason,
  // which stay set after a reopened month is closed again).
  const isClosed = closeRow?.status === "closed";
  const isReopened = closeRow?.status === "reopened";
  const snap = isClosed ? closeRow.snapshot : liveSnap;
  const t = snap.totals;
  const unresolved = unresolvedItems(items, draft);
  const openCount = unresolved.length;
  const carriedKeys = carriedKeySet(draft);
  const previousClose = data.closes.find(
    (c) => monthOfDate(c.month) === shiftMonth(monthStr, -1) && c.status === "closed",
  );
  const earlierUnclosed =
    isClosed || !over
      ? null
      : findEarlierUnclosedMonth({
          todayKey: data.todayKey,
          monthStr,
          students: data.students,
          lessons: data.lessons,
          cycles: data.cycles,
          closes: data.closes,
        });
  const nothing =
    !isClosed &&
    over &&
    items.length === 0 &&
    t.lessons === 0 &&
    noticeCount === 0 &&
    t.cash_collected_cents === 0 &&
    t.cash_written_off_cents === 0;
  const pendingCarried = pendingIsCarried({
    monthStr,
    items,
    draft,
    closed: isClosed,
    pendingCents: t.notices_pending_cents,
  });

  const compare = isClosed ? compareSnapshotToLive(closeRow.snapshot, liveSnap) : null;
  const changes = isClosed ? classifyChanges(data.changes, closeRow.closed_at, monthStr) : null;
  const openReopen = () => {
    setReopenError(null);
    setReopenOpen(true);
  };

  const intro = isClosed
    ? `Closed on ${dayLabel(sgtDateKey(closeRow.closed_at), monthStr)}. Figures are locked.`
    : !over
      ? `Preview. You can close ${mName} from 1 ${monthShort(shiftMonth(monthStr, 1))}.`
      : openCount === 0
        ? "Everything is in order. Ready when you are."
        : openCount === 1
          ? "One thing left to decide, then you can close the month."
          : `${openCount} things left to decide, then you can close the month.`;

  // ── Carry (draft in state + localStorage) ──
  const commitDraft = (next) => {
    setDraft(next);
    if (next.length) writeDraft(tutorId, monthStr, next);
    else clearDraft(tutorId, monthStr);
  };
  const toEntry = (it) => ({ type: it.type, ref_id: it.ref_id, origin_month: it.origin_month });
  const onCarry = (it) => commitDraft(pruneDraft([...draft, toEntry(it)], items));
  const onUncarry = (it) => commitDraft(draft.filter((d) => carryKey(d) !== carryKey(it)));
  const onCarryAll = () => commitDraft(pruneDraft([...draft, ...unresolved.map(toEntry)], items));

  // ── Checklist actions (same calls as Payments / Dashboard / Lessons) ──
  const onMarkDone = (it) =>
    runAction(async () => {
      if (!(await confirmClosedMonthChange({ tutorId, kind: "lesson", dateKeys: lessonToggleDates({ lesson_date: it.date, is_completed: false }, true) }))) return false;
      await markLessonDone(tutorId, it.ref_id);
      showToast("Lesson marked done ✓");
    });

  // Not guarded: only not-done lessons are listed here, and a lesson that is not done
  // before or after does not count in any closed figure.
  const onDeleteLesson = (it) =>
    runAction(async () => {
      if (!window.confirm(`Delete this lesson on ${dayLabel(it.date, monthStr)}? It won't be counted or billed.`)) {
        return false;
      }
      await deleteLessonWithCalendar(tutorId, it.ref_id);
      showToast("Lesson deleted.");
    });

  const onMarkPaid = (it) =>
    runAction(async () => {
      if (!(await confirmClosedMonthChange({ tutorId, kind: "paid", dateKeys: [it.origin_month] }))) return false;
      await markNoticePaid(tutorId, it.ref_id);
      showToast("Marked as paid.");
    });

  const onWriteOff = (it) =>
    runAction(async () => {
      const cycle = data.cycles.find((c) => c.id === it.ref_id);
      if (!cycle) throw new Error("That notice no longer exists. Please reload.");
      if (
        !window.confirm(
          `Write off ${usd(it.amount_cents)} from ${it.student}? This removes it from Pending. It won't count as Collected.`,
        )
      ) {
        return false;
      }
      if (!(await confirmClosedMonthChange({ tutorId, kind: "notice", dateKeys: [it.origin_month] }))) return false;
      await writeOffNotice(tutorId, cycle);
      showToast("Written off.");
    });

  const onBillNow = (it) =>
    runAction(async () => {
      const student = data.students.find((s) => s.id === it.ref_id);
      if (!student) throw new Error("That student no longer exists. Please reload.");
      // Bill now bills ALL of the student's unbilled completed lessons, including
      // ones dated after this month, so count them all for the confirm.
      const unbilled = await fetchUnbilledLessons(tutorId, student.id);
      if (unbilled.length === 0) throw new Error("There are no unbilled lessons for this student any more.");
      const afterMonth = unbilled.filter((l) => monthOfDate(l.lesson_date) > monthStr).length;
      const n = unbilled.length;
      const text =
        `Bill ${student.name} now? This creates one notice for ${n === 1 ? "the" : "all"} ${n} unbilled ` +
        `${n === 1 ? "lesson" : "lessons"} (${formatSGD(sumLessons(unbilled, student))}).` +
        (afterMonth > 0 ? ` ${afterMonth} of them ${afterMonth === 1 ? "is" : "are"} dated after ${mName}.` : "");
      if (!window.confirm(text)) return false;
      if (!(await confirmClosedMonthChange({ tutorId, kind: "notice", dateKeys: [unbilled.map((l) => l.lesson_date).sort().pop()] }))) return false;
      await billStudentNow(student.id);
      showToast("Billed. A payment notice was created.");
    });

  // ── Close (6.13, 4.9, 6.2 "After saving") ──
  const handleClose = async () => {
    if (busy || closing || !tutorId) return;
    setClosing(true);
    setBusy(true);
    setCloseError(null);
    setActionError(null);
    try {
      // Reload everything, rebuild the checklist and snapshot from fresh data.
      const fresh = await loadMonthCloseData(tutorId, monthStr);
      const { view: v, pruned, data: freshData } = applyFresh(fresh, draft);
      const freshRow = fresh.closes.find((c) => monthOfDate(c.month) === monthStr);
      if (freshRow?.status === "closed") {
        clearClosedMonthsCache(); // closed elsewhere: treat as success
        return;
      }
      if (!canCloseMonth(monthStr, fresh.todayKey)) {
        setCloseError(mapCloseError("MONTH_NOT_OVER", monthStr).text);
        return;
      }
      if (unresolvedItems(v.items, pruned).length > 0) {
        setCloseError(STALE_PAGE_MESSAGE);
        return;
      }
      const snapshot = buildMonthSnapshot({
        monthStr,
        students: freshData.students,
        payees: freshData.payees,
        lessons: freshData.lessons,
        cycles: freshData.cycles,
        statements: freshData.statements,
        carried: buildCarriedEntries(v.items, pruned),
        takenAt: sgtStamp(),
      });
      const failed = checkSnapshot(snapshot);
      if (failed.length > 0) {
        console.error("[MonthClose] snapshot self-check failed; month not closed", failed);
        setCloseError(BAD_SNAPSHOT_MESSAGE);
        return;
      }

      let alreadyClosed = false;
      try {
        await closeMonthRpc(monthStr, snapshot);
      } catch (e) {
        const mapped = mapCloseError(e?.message, monthStr);
        if (mapped.kind !== "already") {
          setCloseError(mapped.text);
          return;
        }
        alreadyClosed = true;
      }

      clearClosedMonthsCache();
      if (!alreadyClosed) {
        clearDraft(tutorId, monthStr);
        setDraft([]);
        // Re-read the row and compare the saved totals with what was sent.
        let mismatch = false;
        try {
          const stored = await readCloseRow(tutorId, monthStr);
          mismatch = !sameTotals(stored?.snapshot?.totals, snapshot.totals);
          if (mismatch) console.error("[MonthClose] saved totals differ from the snapshot sent", stored?.snapshot?.totals, snapshot.totals);
        } catch (e) {
          console.error("[MonthClose] could not re-read the closed row", e);
          mismatch = true;
        }
        if (mismatch) setCloseError(AFTER_SAVE_MISMATCH_MESSAGE);
        else setJustClosed(true);
        showToast(`${mName} closed.`);
      }
      await refresh([]); // the draft was just removed; do not bring it back
    } catch (e) {
      console.error("[MonthClose] close failed", e);
      setCloseError(mapCloseError(e?.message, monthStr).text);
    } finally {
      setClosing(false);
      setBusy(false);
    }
  };

  // ── Reopen ──
  const handleReopen = async (reason) => {
    if (busy) return;
    setBusy(true);
    setReopenError(null);
    try {
      await reopenMonthRpc(monthStr, reason);
    } catch (e) {
      const mapped = mapReopenError(e?.message, monthStr);
      if (mapped.kind === "not_closed") {
        clearClosedMonthsCache();
        setReopenOpen(false);
        try {
          await refresh();
        } catch (e2) {
          setActionError(e2?.message ?? "Couldn't refresh the page.");
        }
      } else {
        setReopenError(mapped.text);
      }
      setBusy(false);
      return;
    }
    clearClosedMonthsCache();
    setReopenOpen(false);
    setJustClosed(false);
    setCloseError(null);
    try {
      await refresh([]);
      showToast(`${mName} reopened.`);
    } catch (e) {
      setActionError(`Reopened, but the page couldn't refresh: ${e?.message ?? "unknown error"}. Please reload.`);
    } finally {
      setBusy(false);
    }
  };

  const closeLabel = closing
    ? "Closing…"
    : !over
      ? `You can close ${mName} from 1 ${monthShort(shiftMonth(monthStr, 1))}`
      : openCount > 0
        ? `Resolve ${openCount} item${openCount === 1 ? "" : "s"} to close`
        : isReopened
          ? `Close ${mName} again`
          : `Close ${mName}`;
  const canClose = over && openCount === 0 && !busy && !closing;

  return (
    <AppShell>
      {justClosed && <Confetti onDone={clearConfetti} />}
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

        {actionError && (isClosed || nothing) && (
          <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {actionError}
          </p>
        )}

        {nothing ? (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
            Nothing happened in {monthLabel(monthStr)} — no lessons, no payments. Nothing to close.
          </div>
        ) : (
          <>
            {isClosed && (
              <section
                className={`mt-4 rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 ${justClosed ? "cnp-pop" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1b2d4f] text-base font-bold text-white">
                    ✓
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-[#1b2d4f]">{mName} closed</h2>
                    <p className="mt-0.5 text-sm text-gray-700">
                      {closedCardSentence({
                        monthStr,
                        snapshot: closeRow.snapshot,
                        previousSnapshot: previousClose?.snapshot,
                      })}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setReopenError(null);
                        setReopenOpen(true);
                      }}
                      disabled={busy}
                      className="mt-2 text-sm font-medium text-[#1b2d4f] underline disabled:opacity-50"
                    >
                      Reopen {mName}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {isReopened && (
              <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>
                  Reopened on {dayLabel(sgtDateKey(closeRow.reopened_at), monthStr)}
                  {closeRow.reopen_reason ? ` — '${closeRow.reopen_reason}'` : ""}. Last closed figures are kept
                  below for comparison.
                </p>
              </section>
            )}

            <p className="mt-3 text-sm text-gray-600">{intro}</p>

            {earlierUnclosed && (
              <p className="mt-2 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-600">
                {monthName(earlierUnclosed)} isn&apos;t closed yet. Closing oldest first keeps carried items tidy.{" "}
                <Link to={`/month-close?month=${earlierUnclosed}`} className="font-medium text-[#0f7a58] underline">
                  Go to {monthName(earlierUnclosed)}
                </Link>
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Tile label="Lessons taught" value={t.lessons} />
              <Tile label="My take-home" value={usd(t.mine_cents)} tone="text-[#0f7a58]" />
              <Tile label="Collected" value={usd(t.notices_paid_cents)} />
              <Tile
                label={pendingCarried ? "Pending, carried" : "Pending"}
                value={usd(t.notices_pending_cents)}
                tone="text-amber-700"
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Cash received in {mName} (any month&apos;s notices): {usd(t.cash_collected_cents)} · Written off in{" "}
              {mName}: {usd(t.cash_written_off_cents)}
            </p>

            <WhoEarnsWhat snap={snap} monthStr={monthStr} />

            {isClosed && (
              <>
                <SinceCloseStrip
                  strip={changes.strip}
                  monthName={mName}
                  outstandingCents={liveSnap.totals.notices_pending_cents}
                />
                <ChangedAfterClosePanel
                  compare={compare}
                  panel={changes.panel}
                  busy={busy}
                  onReopen={openReopen}
                />
              </>
            )}

            {isClosed ? (
              closeRow.snapshot.carried?.length > 0 && (
                <section className="mt-4 rounded-xl border border-[#b8e8d9] bg-white p-4">
                  <h2 className="mb-1 text-sm font-semibold text-gray-900">Carried into {nextName}</h2>
                  <ul className="divide-y divide-gray-100">
                    {closeRow.snapshot.carried.map((c) => (
                      <li key={`${c.type}:${c.ref_id}:${c.origin_month}`} className="py-2 text-sm text-gray-700">
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </section>
              )
            ) : (
              <MonthCloseChecklist
                snap={liveSnap}
                items={items}
                monthStr={monthStr}
                noticeCount={noticeCount}
                carriedKeys={carriedKeys}
                busy={busy}
                actionError={actionError}
                onCarry={onCarry}
                onUncarry={onUncarry}
                onCarryAll={onCarryAll}
                onMarkDone={onMarkDone}
                onDeleteLesson={onDeleteLesson}
                onMarkPaid={onMarkPaid}
                onWriteOff={onWriteOff}
                onBillNow={onBillNow}
              />
            )}

            {isReopened && closeRow.snapshot?.totals && (
              <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-gray-900">Last closed figures</h2>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-700">
                  <span>Lessons taught</span>
                  <span className="text-right font-medium">{closeRow.snapshot.totals.lessons}</span>
                  <span>Total billed</span>
                  <span className="text-right font-medium">{usd(closeRow.snapshot.totals.gross_cents)}</span>
                  <span>Agencies earn</span>
                  <span className="text-right font-medium">{usd(closeRow.snapshot.totals.agency_cents)}</span>
                  <span>My take-home</span>
                  <span className="text-right font-medium">{usd(closeRow.snapshot.totals.mine_cents)}</span>
                </div>
              </section>
            )}

            {closeError && (
              <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {closeError}
              </p>
            )}

            {!isClosed && (
              <button
                type="button"
                onClick={handleClose}
                disabled={!canClose}
                className={`mt-5 min-h-11 w-full rounded-md px-4 text-sm font-medium transition ${
                  canClose
                    ? "bg-[#5ecfaa] text-[#1b2d4f] hover:brightness-95"
                    : "cursor-not-allowed bg-gray-200 text-gray-500"
                }`}
              >
                {closeLabel}
              </button>
            )}
          </>
        )}
      </div>

      {reopenOpen && (
        <ReopenMonthModal
          monthName={mName}
          busy={busy}
          error={reopenError}
          onCancel={() => setReopenOpen(false)}
          onConfirm={handleReopen}
        />
      )}
    </AppShell>
  );
}
