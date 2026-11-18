import { useState } from "react";
import { Link } from "react-router-dom";
import { sgtDateKey } from "../utils/sgt";

const KEY = "chopeandpay_briefing_collapsed";

function readCollapsed(todayKey) {
  try {
    return localStorage.getItem(KEY) === todayKey;
  } catch {
    return false;
  }
}

// Top-of-Dashboard briefing card (tutors only). `briefing` comes from
// buildBriefing; `onAction(action)` handles scroll / modal rows.
export default function TodayBriefing({ briefing, loading, onAction }) {
  const todayKey = briefing.todayKey ?? sgtDateKey();
  const [collapsed, setCollapsed] = useState(() => readCollapsed(todayKey));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      if (next) localStorage.setItem(KEY, todayKey);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const rowClass = "flex min-h-11 w-full items-center justify-between gap-3 border-t border-gray-100 text-left text-sm text-gray-800 hover:bg-[#edf6f3]";
  const rowBody = (it) => (
    <>
      <span className="min-w-0">
        <span>{it.icon} {it.text}</span>
        {it.sub && <span className="block pl-6 text-xs text-gray-500">{it.sub}</span>}
      </span>
      <span aria-hidden="true" className="text-gray-400">→</span>
    </>
  );

  return (
    <section
      id="today-briefing"
      aria-label="Today's briefing"
      className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0f7a58]">{briefing.dateLabel}</p>
        {!loading && (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand briefing" : "Collapse briefing"}
            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100"
          >
            {collapsed ? "⌄" : "⌃"}
          </button>
        )}
      </div>
      <h2 className="mt-1 text-2xl font-bold text-[#1b2d4f]">{briefing.greeting}</h2>
      {loading ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <div className="h-4 w-11/12 animate-pulse rounded bg-gray-100" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
        </div>
      ) : (
        <p className="mt-1 text-sm text-gray-600">{briefing.sentence}</p>
      )}
      {!loading && !collapsed && briefing.items.length > 0 && (
        <ul className="mt-3">
          {briefing.items.map((it) => (
            <li key={it.key}>
              {it.to ? (
                <Link to={it.to} className={rowClass}>{rowBody(it)}</Link>
              ) : (
                <button type="button" onClick={() => onAction(it.action)} className={rowClass}>
                  {rowBody(it)}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
