import { formatSGD } from "../lib/paymentNotice";

const usd = (c) => formatSGD(c / 100);
const signed = (c, fmt) => `${c > 0 ? "+" : c < 0 ? "−" : ""}${fmt(Math.abs(c))}`;

const ROWS = [
  ["lessons", "Lessons", (n) => String(n)],
  ["gross_cents", "Total billed", usd],
  ["agency_cents", "Agencies earn", usd],
  ["mine_cents", "My take-home", usd],
  ["revenue_cents", "Revenue", usd],
  ["commission_b_cents", "Commission paid", usd],
  ["cash_collected_cents", "Cash received", usd],
  ["cash_written_off_cents", "Written off", usd],
];

// Grey strip (4.6): payments and write-offs since the month was closed. These move
// money in later months but never change what was earned in the closed month.
export function SinceCloseStrip({ strip, monthName, outstandingCents }) {
  if (strip.length === 0) return null;
  return (
    <section className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
      <h2 className="mb-1 text-sm font-semibold text-gray-900">Since close</h2>
      <ul className="space-y-1 text-sm text-gray-700">
        {strip.map((s) => (
          <li key={s.id}>{s.text}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500">
        Still outstanding from {monthName} now: {usd(outstandingCents)}
      </p>
    </section>
  );
}

// Amber panel (4.6) driven by the snapshot-vs-live comparison (6.6) and the change log.
export function ChangedAfterClosePanel({ compare, panel, onReopen, busy }) {
  const hasChanges = compare.status === "changed";
  const noNetChange = compare.status === "same" && panel.length > 0;
  if (compare.status === "same" && panel.length === 0) return null;

  if (compare.status === "old_calc") {
    return (
      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">Changed after close</h2>
        <p className="mt-1 text-sm text-amber-900">Closed with an older calculation — reopen to refresh.</p>
        <button
          type="button"
          onClick={onReopen}
          disabled={busy}
          className="mt-3 min-h-11 rounded-md border border-amber-300 bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Reopen to update figures
        </button>
      </section>
    );
  }

  const rows = ROWS.filter(([key]) => compare.diffs.some((d) => d.key === key));
  return (
    <section
      className={`mt-4 rounded-xl border p-4 ${noNetChange ? "border-gray-200 bg-gray-50" : "border-amber-200 bg-amber-50"}`}
    >
      <h2 className={`text-sm font-semibold ${noNetChange ? "text-gray-600" : "text-amber-900"}`}>
        {noNetChange ? "Edited after close, no net change." : "Changed after close"}
      </h2>

      {hasChanges && (
        <table className="mt-2 w-full text-sm text-gray-800">
          <thead>
            <tr className="text-left text-xs text-gray-500">
              <th className="py-1 pr-2 font-medium" />
              <th className="py-1 pr-2 text-right font-medium">Closed</th>
              <th className="py-1 pr-2 text-right font-medium">Now</th>
              <th className="py-1 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label, fmt]) => {
              const d = compare.diffs.find((x) => x.key === key);
              return (
                <tr key={key} className="border-t border-amber-200">
                  <td className="py-1 pr-2">{label}</td>
                  <td className="py-1 pr-2 text-right">{fmt(d.closed)}</td>
                  <td className="py-1 pr-2 text-right">{fmt(d.now)}</td>
                  <td className="py-1 text-right font-medium">{signed(d.diff, fmt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {panel.length > 0 && (
        <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-gray-500">What changed</p>
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {panel.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ul>
        </>
      )}

      {hasChanges && panel.length === 0 && (
        <p className="mt-3 text-sm text-amber-900">
          No lesson edits were logged — a rate, agency share or placement-fee setting was probably changed.
        </p>
      )}

      {hasChanges && (
        <button
          type="button"
          onClick={onReopen}
          disabled={busy}
          className="mt-3 min-h-11 rounded-md border border-amber-300 bg-white px-4 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          Reopen to update figures
        </button>
      )}
    </section>
  );
}
