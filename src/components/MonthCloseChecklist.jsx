import { useState } from "react";
import { Link } from "react-router-dom";
import { CHECKLIST_TYPES, carryKey, monthName, shiftMonth } from "../lib/monthClose";
import { formatSGD } from "../lib/paymentNotice";

const usd = (c) => formatSGD(c / 100);
const SHOW_LIMIT = 5;

const BTN =
  "min-h-11 rounded-md border px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const BTN_MAIN = `${BTN} border-[#1b2d4f] bg-[#1b2d4f] text-white hover:bg-[#15243f]`;
const BTN_PLAIN = `${BTN} border-gray-300 bg-white text-gray-700 hover:bg-gray-100`;
const BTN_CARRY = `${BTN} border-[#93d9c4] bg-white text-[#0f7a58] hover:bg-[#edf6f3]`;

export function Chip({ children, tone = "gray" }) {
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

function Chips({ item }) {
  return (
    <>
      {item.tag && (
        <Chip tone={item.tag === "Overdue" ? "red" : item.tag === "Pending" ? "amber" : "gray"}>{item.tag}</Chip>
      )}
      {item.chip && <Chip>{item.chip}</Chip>}
      {item.deleted ? <Chip tone="red">Deleted</Chip> : item.archived ? <Chip>Archived</Chip> : null}
    </>
  );
}

export default function MonthCloseChecklist({
  snap,
  items,
  monthStr,
  noticeCount,
  carriedKeys,
  busy,
  actionError,
  onCarry,
  onUncarry,
  onCarryAll,
  onMarkDone,
  onDeleteLesson,
  onMarkPaid,
  onWriteOff,
  onBillNow,
}) {
  const [expanded, setExpanded] = useState({});
  const mName = monthName(monthStr);
  const nextName = monthName(shiftMonth(monthStr, 1));
  const t = snap.totals;
  const rowsOf = (type) => items.filter((i) => i.type === type);
  const openCount = items.filter((i) => !carriedKeys.has(carryKey(i))).length;

  const renderRow = (it) => {
    if (carriedKeys.has(carryKey(it))) {
      return (
        <li key={it.key} className="flex items-start gap-3 py-2">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5ecfaa] text-xs font-bold text-[#1b2d4f]">
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-700">
              {it.label}, carried into {nextName}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Chips item={it} />
              <button
                type="button"
                onClick={() => onUncarry(it)}
                disabled={busy}
                className="text-xs font-medium text-[#0f7a58] underline disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li key={it.key} className="flex items-start gap-3 py-2">
        <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-amber-500 bg-white" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900">{it.label}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chips item={it} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {it.type === "undone_lesson" && (
              <>
                <button type="button" disabled={busy} onClick={() => onMarkDone(it)} className={BTN_MAIN}>
                  Mark done
                </button>
                <button type="button" disabled={busy} onClick={() => onDeleteLesson(it)} className={BTN_PLAIN}>
                  Didn&apos;t happen — delete
                </button>
              </>
            )}
            {it.type === "zero_rate_lesson" && (
              <Link to="/lessons" className={`${BTN_PLAIN} inline-flex items-center`}>
                Fix in Lessons
              </Link>
            )}
            {it.type === "unpaid_notice" && (
              <>
                <button type="button" disabled={busy} onClick={() => onMarkPaid(it)} className={BTN_MAIN}>
                  Mark as paid
                </button>
                <button type="button" disabled={busy} onClick={() => onWriteOff(it)} className={BTN_PLAIN}>
                  Write off
                </button>
              </>
            )}
            {it.type === "unbilled_student" && (
              <button type="button" disabled={busy} onClick={() => onBillNow(it)} className={BTN_MAIN}>
                Bill now
              </button>
            )}
            {it.type === "statement" && (
              <Link
                to={`/statements?payee=${it.payee_id}&month=${it.origin_month}`}
                className={`${BTN_PLAIN} inline-flex items-center`}
              >
                Open statement
              </Link>
            )}
            <button type="button" disabled={busy} onClick={() => onCarry(it)} className={BTN_CARRY}>
              Carry into {nextName}
            </button>
          </div>
        </div>
      </li>
    );
  };

  const group = (type, doneLines) => {
    const rows = rowsOf(type);
    const shown = expanded[type] ? rows : rows.slice(0, SHOW_LIMIT);
    return (
      <>
        {rows.length === 0 ? doneLines : null}
        {shown.map(renderRow)}
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

  return (
    <section className="mt-4 rounded-xl border border-[#b8e8d9] bg-white p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Before you close</h2>
        {openCount >= 3 && (
          <button
            type="button"
            onClick={onCarryAll}
            disabled={busy}
            className="text-xs font-medium text-[#0f7a58] underline disabled:opacity-50"
          >
            Carry all ({openCount})
          </button>
        )}
      </div>
      {actionError && (
        <p role="alert" className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {actionError}
        </p>
      )}
      <ul className="divide-y divide-gray-100">
        {group(
          CHECKLIST_TYPES[0],
          <DoneRow>{t.lessons > 0 ? `All ${t.lessons} lessons marked done` : "No lessons to mark done"}</DoneRow>,
        )}
        {group(CHECKLIST_TYPES[1], null)}
        {group(
          CHECKLIST_TYPES[2],
          <DoneRow>{noticeCount > 0 ? `Every ${mName} notice is paid` : `No payment notices for ${mName}`}</DoneRow>,
        )}
        {group(CHECKLIST_TYPES[3], <DoneRow>Every completed lesson is billed</DoneRow>)}
        {sentStatements.map((s) => (
          <DoneRow key={s.payee_id}>
            {s.name} statement sent{s.claimed_total_cents != null ? `, ${usd(s.claimed_total_cents)}` : ""}
          </DoneRow>
        ))}
        {rowsOf("statement").length > 0 && group(CHECKLIST_TYPES[4], null)}
        <DoneRow>
          {t.cash_written_off_cents > 0
            ? `Written off in ${mName}: ${usd(t.cash_written_off_cents)}`
            : "Nothing to write off"}
        </DoneRow>
      </ul>
    </section>
  );
}
