import { useState } from "react";

// Switch with a confirm step. onChange(next) runs only after the user confirms.
// deferred: the change is saved later (e.g. with a form's Save button).
export default function PracticeToggle({ checked, onChange, disabled, deferred = false }) {
  const [pending, setPending] = useState(null);

  const confirm = async () => {
    const next = pending;
    setPending(null);
    await onChange(next);
  };

  return (
    <>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => setPending(!checked)}
          className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
            checked ? "bg-violet-600" : "bg-gray-300"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
              checked ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
        <span className="text-sm text-gray-700">
          Practice student (test data, excluded from my money figures and reports)
        </span>
      </label>

      {pending !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">
              {pending ? "Mark as practice student?" : "Count this student again?"}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {pending
                ? "This student's lessons and notices will stop counting in earnings, the monthly recap, Pending, stalled cycles, the year-end report and agency statements. They stay visible everywhere else."
                : "This student's lessons and notices will start counting again in earnings, the monthly recap, Pending, stalled cycles, the year-end report and agency statements, including their past lessons."}
            </p>
            {deferred && (
              <p className="mt-2 text-xs text-gray-500">This takes effect when you save.</p>
            )}
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={confirm}
                className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f]"
              >
                {pending ? "Yes, mark as practice" : "Yes, count them again"}
              </button>
              <button
                onClick={() => setPending(null)}
                className="min-h-11 w-full rounded-md px-4 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
