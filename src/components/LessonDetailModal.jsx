import { formatLessonTime } from "../lib/date";
import { formatDate } from "../utils/dateFormat";
import { buildGoogleMapsUrl } from "../lib/maps";

export default function LessonDetailModal({
  lesson,
  lessonNumber,
  onClose,
  onEdit,
  onMarkDone,
}) {
  const address = lesson.students?.address;
  const isDone = lesson.is_completed;

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
            {lesson.students?.subject && (
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
          <p className="text-gray-500">Lesson {lessonNumber ?? "?"} of 4</p>
        </div>

        {address && (
          <div className="mt-3 flex items-center gap-2 text-sm text-gray-600">
            <span>📍 {address}</span>
            <a
              href={buildGoogleMapsUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-green-600 hover:text-green-700"
            >
              Open in Maps
            </a>
          </div>
        )}

        {lesson.notes && (
          <p className="mt-3 text-sm italic text-gray-500">{lesson.notes}</p>
        )}

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onEdit}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Edit lesson
          </button>
          {!isDone && (
            <button
              onClick={onMarkDone}
              className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
            >
              ✅ Mark as Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
