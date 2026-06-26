import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { buildLessonIcs, downloadIcs } from "../lib/ics";
import { formatLessonTime } from "../lib/date";
import { formatDateFull, formatMonth } from "../utils/dateFormat";
import AppShell from "../components/AppShell";
import LessonDetailModal from "../components/LessonDetailModal";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PALETTE = [
  "bg-green-100 text-green-700",
  "bg-green-100 text-green-700",
  "bg-amber-100 text-amber-700",
  "bg-pink-100 text-pink-700",
  "bg-blue-100 text-blue-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
];

// Lighter, muted counterpart for each PALETTE entry, used for lessons that
// are scheduled but not yet completed, paired with a dotted border so
// tutors can tell done vs upcoming apart at a glance.
const MUTED_PALETTE = [
  "bg-green-50 text-green-500 border border-dashed border-green-300",
  "bg-green-50 text-green-500 border border-dashed border-green-300",
  "bg-amber-50 text-amber-500 border border-dashed border-amber-300",
  "bg-pink-50 text-pink-500 border border-dashed border-pink-300",
  "bg-blue-50 text-blue-500 border border-dashed border-blue-300",
  "bg-rose-50 text-rose-500 border border-dashed border-rose-300",
  "bg-teal-50 text-teal-500 border border-dashed border-teal-300",
];

const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);

function buildMonthGrid(monthDate) {
  const start = startOfMonth(monthDate);
  const startWeekday = (start.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
  ).getDate();

  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - startWeekday);

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    cells.push({
      date,
      key: toDateKey(date),
      isCurrentMonth: date.getMonth() === monthDate.getMonth(),
    });
  }
  return cells;
}

export default function Calendar() {
  const navigate = useNavigate();
  const [monthDate, setMonthDate] = useState(startOfMonth(new Date()));
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailLesson, setDetailLesson] = useState(null);

  const reloadLessons = async () => {
    const { data } = await supabase
      .from("lessons")
      .select("*, students(name, subject, hourly_rate, address)")
      .order("created_at", { ascending: true });
    setLessons(data ?? []);
  };

  useEffect(() => {
    const load = async () => {
      await reloadLessons();
      setLoading(false);
    };
    load();
  }, []);

  // Position each lesson within its running 4-lesson billing sequence, based
  // purely on chronological lesson_date (not insertion order or which
  // payment_cycle_id it was actually billed under).
  const lessonPosition = useMemo(() => {
    const lessonsByStudent = new Map();
    for (const lesson of lessons) {
      if (!lessonsByStudent.has(lesson.student_id))
        lessonsByStudent.set(lesson.student_id, []);
      lessonsByStudent.get(lesson.student_id).push(lesson);
    }
    const positions = new Map();
    for (const group of lessonsByStudent.values()) {
      const sorted = [...group].sort((a, b) =>
        a.lesson_date < b.lesson_date
          ? -1
          : a.lesson_date > b.lesson_date
            ? 1
            : 0,
      );
      sorted.forEach((lesson, i) => positions.set(lesson.id, (i % 4) + 1));
    }
    return positions;
  }, [lessons]);

  const studentColorIndex = useMemo(() => {
    const colors = new Map();
    let i = 0;
    for (const lesson of lessons) {
      if (!colors.has(lesson.student_id)) {
        colors.set(lesson.student_id, i % PALETTE.length);
        i++;
      }
    }
    return colors;
  }, [lessons]);

  const lessonsByDate = useMemo(() => {
    const map = new Map();
    for (const lesson of lessons) {
      if (!lesson.lesson_date) continue;
      if (!map.has(lesson.lesson_date)) map.set(lesson.lesson_date, []);
      map.get(lesson.lesson_date).push(lesson);
    }
    for (const dayLessons of map.values()) {
      dayLessons.sort((a, b) =>
        (a.lesson_time ?? "").localeCompare(b.lesson_time ?? ""),
      );
    }
    return map;
  }, [lessons]);

  const cells = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
  const hasLessonsThisMonth = useMemo(
    () =>
      lessons.some(
        (l) =>
          l.lesson_date &&
          new Date(l.lesson_date).getFullYear() === monthDate.getFullYear() &&
          new Date(l.lesson_date).getMonth() === monthDate.getMonth(),
      ),
    [lessons, monthDate],
  );
  const todayKey = toDateKey(new Date());
  const selectedLessons = selectedKey
    ? (lessonsByDate.get(selectedKey) ?? [])
    : [];

  const goToMonth = (offset) => {
    setMonthDate(
      (prev) => new Date(prev.getFullYear(), prev.getMonth() + offset, 1),
    );
  };

  const handleLogLesson = () => {
    navigate("/lessons", { state: { lessonDate: selectedKey ?? todayKey } });
  };

  const handleAddToCalendar = (lesson) => {
    const ics = buildLessonIcs({
      lesson,
      studentName: lesson.students?.name ?? "Lesson",
      subject: lesson.students?.subject,
      lessonNumber: lessonPosition.get(lesson.id) ?? 1,
      rate: lesson.rate ?? lesson.students?.hourly_rate ?? null,
    });
    downloadIcs(
      `${lesson.students?.name ?? "lesson"}-${lesson.lesson_date}.ics`,
      ics,
    );
  };

  const handleEditLesson = (lesson) => {
    navigate("/lessons", { state: { editLessonId: lesson.id } });
  };

  const handleDeleteLesson = async (lesson) => {
    if (!window.confirm("Delete this lesson? This cannot be undone.")) return;
    await supabase.from("lessons").delete().eq("id", lesson.id);
    await reloadLessons();
  };

  const handleMarkDone = async (lesson) => {
    setDetailLesson(null);
    const { error } = await supabase
      .from("lessons")
      .update({ is_completed: true })
      .eq("id", lesson.id);
    if (error) {
      window.alert(error.message);
      return;
    }
    await reloadLessons();
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="flex-1 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {formatMonth(monthDate)}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToMonth(-1)}
                aria-label="Previous month"
                className="min-h-11 rounded-md border border-gray-300 px-2.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                ←
              </button>
              <button
                onClick={() => setMonthDate(startOfMonth(new Date()))}
                className="min-h-11 rounded-md border border-gray-300 px-2.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                Today
              </button>
              <button
                onClick={() => goToMonth(1)}
                aria-label="Next month"
                className="min-h-11 rounded-md border border-gray-300 px-2.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                →
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : !hasLessonsThisMonth ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <p className="mb-4 text-5xl">📅</p>
              <p className="max-w-sm text-sm text-gray-600">
                No lessons this month. Log a lesson to see it here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] grid-cols-7 gap-1 text-xs sm:min-w-0 lg:gap-2 lg:text-sm">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="px-1 py-1 text-center font-medium text-gray-500 lg:py-2"
                  >
                    {d}
                  </div>
                ))}
                {cells.map((cell) => {
                  const dayLessons = lessonsByDate.get(cell.key) ?? [];
                  const isToday = cell.key === todayKey;
                  const isSelected = cell.key === selectedKey;
                  return (
                    <div
                      key={cell.key}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedKey(cell.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ")
                          setSelectedKey(cell.key);
                      }}
                      className={`flex min-h-16 flex-col items-stretch gap-0.5 rounded-md border p-1 text-left transition sm:min-h-20 lg:min-h-32 lg:gap-1 lg:rounded-lg lg:p-2 ${
                        isSelected
                          ? "border-green-400 bg-green-50"
                          : "border-gray-100 hover:border-gray-200 hover:bg-gray-50 hover:shadow-sm"
                      } ${cell.isCurrentMonth ? "" : "opacity-40"}`}
                    >
                      <span
                        className={`text-xs font-medium lg:text-sm ${
                          isToday
                            ? "flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-white lg:h-6 lg:w-6"
                            : "text-gray-700"
                        }`}
                      >
                        {cell.date.getDate()}
                      </span>
                      <div className="flex flex-col gap-0.5 lg:gap-1">
                        {dayLessons.slice(0, 2).map((l) => {
                          const label = `${l.students?.name ?? ""}${
                            l.lesson_time
                              ? ` ${formatLessonTime(l.lesson_time)}`
                              : ""
                          }`;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              title={label}
                              onClick={(e) => {
                                e.stopPropagation();
                                setDetailLesson(l);
                              }}
                              className={`truncate rounded px-1 py-0.5 text-left text-[10px] font-medium lg:rounded-md lg:px-1.5 lg:py-1 lg:text-xs ${
                                l.is_completed
                                  ? PALETTE[
                                      studentColorIndex.get(l.student_id) ?? 0
                                    ]
                                  : MUTED_PALETTE[
                                      studentColorIndex.get(l.student_id) ?? 0
                                    ]
                              }`}
                            >
                              {label}
                              <span className="hidden lg:inline">
                                {" "}
                                ({lessonPosition.get(l.id) ?? "?"}/4)
                              </span>
                            </button>
                          );
                        })}
                        {dayLessons.length > 2 && (
                          <span className="text-[10px] font-medium text-gray-400 lg:text-xs">
                            +{dayLessons.length - 2} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="w-full rounded-xl border border-gray-100 bg-white p-5 shadow-sm lg:w-80">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {selectedKey ? formatDateFull(selectedKey) : "Select a date"}
            </h2>
            <button
              onClick={handleLogLesson}
              className="min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700"
            >
              + Log Lesson
            </button>
          </div>

          {!selectedKey ? (
            <p className="text-sm text-gray-500">
              Click a date on the calendar to see lessons logged that day.
            </p>
          ) : selectedLessons.length === 0 ? (
            <p className="text-sm text-gray-500">No lessons on this day.</p>
          ) : (
            <ul className="space-y-3">
              {selectedLessons.map((l) => (
                <li
                  key={l.id}
                  className="rounded-md border border-gray-100 bg-gray-50 p-3 transition hover:border-gray-200 hover:shadow-sm"
                >
                  <Link
                    to={`/students/${l.student_id}`}
                    className="text-sm font-medium text-gray-900 hover:text-green-700"
                  >
                    {l.students?.name}
                  </Link>
                  <p className="mb-2 text-xs text-gray-500">
                    {l.lesson_time && `${formatLessonTime(l.lesson_time)} · `}
                    {l.students?.subject || "—"} · Lesson{" "}
                    {lessonPosition.get(l.id) ?? "?"} of 4 ·{" "}
                    {(l.duration_minutes / 60).toFixed(2)}h
                  </p>
                  {l.notes && (
                    <p className="mb-2 text-xs italic text-gray-500">
                      {l.notes}
                    </p>
                  )}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleAddToCalendar(l)}
                      className="text-xs font-medium text-green-600 hover:text-green-700"
                    >
                      📅 Add to Calendar
                    </button>
                    <button
                      onClick={() => handleEditLesson(l)}
                      className="text-xs font-medium text-gray-700 hover:text-gray-900"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDeleteLesson(l)}
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detailLesson && (
        <LessonDetailModal
          lesson={detailLesson}
          lessonNumber={lessonPosition.get(detailLesson.id)}
          onClose={() => setDetailLesson(null)}
          onEdit={() => {
            setDetailLesson(null);
            handleEditLesson(detailLesson);
          }}
          onMarkDone={() => handleMarkDone(detailLesson)}
        />
      )}
    </AppShell>
  );
}
