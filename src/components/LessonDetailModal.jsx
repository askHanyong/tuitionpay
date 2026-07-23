import { useState } from "react";
import { formatLessonTime } from "../lib/date";
import { formatDate } from "../utils/dateFormat";
import { buildGoogleMapsUrl } from "../lib/maps";
import { formatSGD } from "../lib/paymentNotice";
import { lessonAmount } from "../lib/paymentMode";
import { useTerms } from "../contexts/TerminologyContext";

export default function LessonDetailModal({
  lesson,
  lessonLabel,
  paymentCycle,
  companyName,
  onClose,
  onEdit,
  onMarkDone,
  onMarkPaid,
  onDelete,
}) {
  const address = lesson.students?.address;
  const isDone = lesson.is_completed;
  const isPaid = paymentCycle?.status === "paid";
  const amountDue = paymentCycle
    ? Number(paymentCycle.amount_due)
    : lessonAmount(lesson, lesson.students);

  const terms = useTerms();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(lesson.id);
    } catch (err) {
      setDeleteError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {lesson.students?.name}
            </h2>
            {companyName && (
              <p className="text-sm text-gray-500">{companyName}</p>
            )}
            {!companyName && lesson.students?.subject && (
              <p className="text-sm text-gray-500">{lesson.students.subject}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-1 text-sm text-gray-700">
          <p>
            {formatDate(lesson.lesson_date)}
            {lesson.lesson_time && ` · ${formatLessonTime(lesson.lesson_time)}`}
            {lesson.duration_minutes != null &&
              ` · ${(lesson.duration_minutes / 60).toFixed(2)}h`}
          </p>
          <p className="text-gray-500">{lessonLabel ?? `${terms.lesson} ?`}</p>
        </div>

        {address && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <span>📍 {address}</span>
            <a
              href={buildGoogleMapsUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
            >
              Open in Maps
            </a>
          </div>
        )}

        {lesson.notes && (
          <p className="mt-3 text-sm italic text-gray-500">{lesson.notes}</p>
        )}

        {isDone && lesson.students?.payment_mode === "per_lesson" && (
          <p
            className={`mt-3 text-sm font-medium ${
              isPaid ? "text-[#0f7a58]" : "text-red-700"
            }`}
          >
            {isPaid ? "Paid ✓" : `Unpaid — ${formatSGD(amountDue)} due`}
          </p>
        )}

        {confirmingDelete ? (
          <div className="mt-5 space-y-3 rounded-md border border-red-200 bg-red-50 p-3">
            {isPaid && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                ⚠️ This {terms.lesson.toLowerCase()} is part of a payment that&apos;s already been marked as paid. Deleting it won&apos;t reverse the payment — you&apos;ll need to handle that manually if needed.
              </div>
            )}
            <p className="text-sm text-red-800">
              Are you sure you want to delete this {terms.lesson.toLowerCase()}? This cannot be
              undone.
            </p>
            {deleteError && (
              <p className="text-sm text-red-600">{deleteError}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="min-h-11 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : isPaid ? "Delete anyway" : "Yes, delete"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={onEdit}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Edit {terms.lesson.toLowerCase()}
            </button>
            {!isDone && (
              <button
                onClick={onMarkDone}
                className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
              >
                ✅ Mark as Done
              </button>
            )}
            {isDone &&
              lesson.students?.payment_mode === "per_lesson" &&
              !isPaid &&
              paymentCycle && (
                <button
                  onClick={() => onMarkPaid(paymentCycle.id)}
                  className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
                >
                  💰 Mark as Paid
                </button>
              )}
            <button
              onClick={() => setConfirmingDelete(true)}
              className="min-h-11 rounded-md border border-red-300 px-4 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              Delete {terms.lesson.toLowerCase()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
