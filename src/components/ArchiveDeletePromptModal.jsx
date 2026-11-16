import { formatSGD } from "../lib/paymentNotice";

export default function ArchiveDeletePromptModal({
  student,
  action,
  pendingAmount,
  unbilledAmount,
  onBillNow,
  onWriteOffAll,
  onKeepAsOwed,
  onCancel,
  loading,
}) {
  const parts = [];
  if (unbilledAmount > 0) parts.push(`${formatSGD(unbilledAmount)} unbilled`);
  if (pendingAmount > 0) parts.push(`${formatSGD(pendingAmount)} pending`);
  const description = parts.join(" and ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">
          {student.name} has outstanding amounts
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {student.name} has {description} before you{" "}
          {action === "archive" ? "archive" : "delete"} them. What would you
          like to do?
        </p>

        <div className="mt-5 flex flex-col gap-3">
          {unbilledAmount > 0 && (
            <button
              onClick={onBillNow}
              disabled={loading}
              className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-50"
            >
              Bill now — create invoice then {action}
            </button>
          )}
          <button
            onClick={onWriteOffAll}
            disabled={loading}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Write off all — {action} without collecting
          </button>
          <button
            onClick={onKeepAsOwed}
            disabled={loading}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-500 transition hover:bg-gray-50 disabled:opacity-50"
          >
            Keep as owed — {action} and track anyway
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="mt-1 text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
