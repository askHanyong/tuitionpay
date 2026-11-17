import { useState } from "react";

// onConfirm(reason) is called with the trimmed reason; `error` is a server-side
// message to show under the field (the page owns the request).
export default function ReopenMonthModal({ monthName, onCancel, onConfirm, busy, error }) {
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setLocalError("Please add a short reason.");
      return;
    }
    setLocalError(null);
    onConfirm(trimmed);
  };

  const shown = localError ?? error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reopen-title"
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="reopen-title" className="text-base font-semibold text-gray-900">
          Reopen {monthName}?
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Closed figures will be kept for comparison until you close it again.
        </p>
        <label htmlFor="reopen-reason" className="mt-4 block text-sm font-medium text-gray-700">
          Why are you reopening it?
        </label>
        <textarea
          id="reopen-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          disabled={busy}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
        />
        {shown && (
          <p role="alert" className="mt-1 text-xs text-red-600">
            {shown}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] disabled:opacity-50"
          >
            {busy ? "Reopening…" : "Reopen"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 w-full rounded-md px-4 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
