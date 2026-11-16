import { formatSGD } from "../lib/paymentNotice";
import { formatMonth } from "../utils/dateFormat";

function TagBadge({ tag }) {
  const styles = {
    Overdue: "bg-red-100 text-red-800",
    Pending: "bg-amber-100 text-amber-800",
    "Not yet billed": "bg-blue-100 text-blue-800",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[tag] ?? "bg-gray-100 text-gray-700"}`}
    >
      {tag}
    </span>
  );
}

export default function PendingBreakdownModal({
  monthDate,
  isCurrentMonth,
  rows,
  onClose,
  onMarkPaid,
  onWriteOff,
  onBillNow,
  onRemind,
  remindingStudentId,
  isPractitioner,
}) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const title = isCurrentMonth
    ? "All outstanding pending"
    : `Pending — ${formatMonth(monthDate)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="mt-0.5 text-sm font-semibold text-amber-700">
              {formatSGD(total)} pending
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto">
          {rows.length === 0 ? (
            <li className="p-5 text-sm text-gray-500">No pending amounts.</li>
          ) : (
            rows.map((row) => (
              <li
                key={row.cycleId ?? `mid-${row.studentId}`}
                className="px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-gray-900">
                    {row.studentName}
                  </span>
                  <span className="text-sm font-semibold text-gray-900">
                    {formatSGD(row.amount)}
                  </span>
                  <TagBadge tag={row.tag} />
                  {row.archived && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      Archived
                    </span>
                  )}
                  {row.deleted && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">
                      Deleted
                    </span>
                  )}
                </div>
                {!isPractitioner && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {row.type === "cycle" && row.student && (
                      <button
                        onClick={() => onRemind(row.student, row.cycle)}
                        disabled={remindingStudentId === row.studentId}
                        className="min-h-9 rounded-md bg-orange-500 px-3 text-xs font-medium text-white transition hover:bg-orange-600 disabled:opacity-60"
                      >
                        {remindingStudentId === row.studentId
                          ? "Preparing…"
                          : "💬 Remind"}
                      </button>
                    )}
                    {row.type === "cycle" && (
                      <button
                        onClick={() => onMarkPaid(row.cycleId)}
                        className="min-h-9 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
                      >
                        Mark as paid
                      </button>
                    )}
                    {row.type === "cycle" && (
                      <button
                        onClick={() => onWriteOff(row.cycleId, row.cycleStatus)}
                        className="min-h-9 rounded-md border border-gray-300 bg-white px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-100"
                      >
                        Write off
                      </button>
                    )}
                    {row.type === "mid_cycle" && (
                      <button
                        onClick={() => onBillNow(row.student)}
                        className="min-h-9 rounded-md bg-[#1b2d4f] px-3 text-xs font-medium text-white transition hover:bg-[#15243f]"
                      >
                        Bill now
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
