import { formatDate } from "../utils/dateFormat";
import LessonTopicsPanel from "./LessonTopicsPanel";

// Small standalone modal so topics can be logged straight from a lesson row
// (e.g. right after tapping Done on the dashboard).
export default function LessonTopicsModal({ lesson, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{lesson.students?.name}</h2>
            <p className="text-sm text-gray-500">{formatDate(lesson.lesson_date)}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        <LessonTopicsPanel lessonId={lesson.id} studentId={lesson.student_id} />
      </div>
    </div>
  );
}
