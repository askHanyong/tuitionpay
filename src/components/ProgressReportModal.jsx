import { useState } from "react";
import {
  DATE_RANGE_OPTIONS,
  downloadProgressReportPdf,
  filterLessonsByRange,
} from "../lib/progressReport";
import { buildProgressReportMessage, buildWhatsAppLink } from "../lib/whatsapp";
import { formatMonth } from "../utils/dateFormat";

export default function ProgressReportModal({
  student,
  lessons,
  cycles,
  tutorName,
  lessonPosition,
  currentCycleProgress,
  lessonsThisMonth,
  onClose,
}) {
  const [rangeOption, setRangeOption] = useState("3m");
  const [note, setNote] = useState("");
  const [generated, setGenerated] = useState(false);

  const handleGenerate = () => {
    const rangeLessons = filterLessonsByRange(lessons, rangeOption);
    downloadProgressReportPdf({
      student,
      rangeLessons,
      cycles,
      tutorName,
      note,
      lessonPosition,
      currentCycleProgress,
      lessonsThisMonth,
    });
    setGenerated(true);
  };

  const handleShareWhatsApp = () => {
    const monthLabel = formatMonth(new Date());
    const message = buildProgressReportMessage({
      studentName: student.name,
      monthLabel,
      tutorName,
    });
    window.open(buildWhatsAppLink(message), "_blank");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">
            Progress report for {student.name}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Date range
            </label>
            <select
              value={rangeOption}
              onChange={(e) => setRangeOption(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              {DATE_RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              A note for the parent (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`e.g. ${student.name} has been making great progress with algebra. Keep practising the worksheets!`}
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            onClick={handleGenerate}
            className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
          >
            📄 Generate PDF
          </button>
          <button
            onClick={handleShareWhatsApp}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            💬 Share via WhatsApp
          </button>
        </div>
        {generated && (
          <p className="mt-3 text-xs text-gray-500">
            PDF downloaded. Attach it in WhatsApp before sending.
          </p>
        )}
      </div>
    </div>
  );
}
