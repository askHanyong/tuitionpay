import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import AppShell from "../components/AppShell";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const PALETTE = [
  "bg-indigo-100 text-indigo-700",
  "bg-green-100 text-green-700",
  "bg-amber-100 text-amber-700",
  "bg-pink-100 text-pink-700",
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-teal-100 text-teal-700",
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

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("lessons")
        .select("*, students(name, subject)")
        .order("created_at", { ascending: true });
      setLessons(data ?? []);
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

  const studentColor = useMemo(() => {
    const colors = new Map();
    let i = 0;
    for (const lesson of lessons) {
      if (!colors.has(lesson.student_id)) {
        colors.set(lesson.student_id, PALETTE[i % PALETTE.length]);
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
    return map;
  }, [lessons]);

  const cells = useMemo(() => buildMonthGrid(monthDate), [monthDate]);
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

  return (
    <AppShell>
      <div className="flex flex-col gap-6 lg:flex-row">
        <section className="flex-1 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {monthDate.toLocaleDateString("en-SG", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => goToMonth(-1)}
                aria-label="Previous month"
                className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                ←
              </button>
              <button
                onClick={() => setMonthDate(startOfMonth(new Date()))}
                className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                Today
              </button>
              <button
                onClick={() => goToMonth(1)}
                aria-label="Next month"
                className="rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >
                →
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="grid grid-cols-7 gap-1 text-xs">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="px-1 py-1 text-center font-medium text-gray-500"
                >
                  {d}
                </div>
              ))}
              {cells.map((cell) => {
                const dayLessons = lessonsByDate.get(cell.key) ?? [];
                const isToday = cell.key === todayKey;
                const isSelected = cell.key === selectedKey;
                return (
                  <button
                    key={cell.key}
                    onClick={() => setSelectedKey(cell.key)}
                    className={`flex min-h-16 flex-col items-stretch gap-0.5 rounded-md border p-1 text-left transition sm:min-h-20 ${
                      isSelected
                        ? "border-indigo-400 bg-indigo-50"
                        : "border-gray-100 hover:bg-gray-50"
                    } ${cell.isCurrentMonth ? "" : "opacity-40"}`}
                  >
                    <span
                      className={`text-xs font-medium ${
                        isToday
                          ? "flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white"
                          : "text-gray-700"
                      }`}
                    >
                      {cell.date.getDate()}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {dayLessons.slice(0, 2).map((l) => (
                        <span
                          key={l.id}
                          className={`truncate rounded px-1 py-0.5 text-[10px] font-medium ${studentColor.get(l.student_id) ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {l.students?.name}
                        </span>
                      ))}
                      {dayLessons.length > 2 && (
                        <span className="text-[10px] font-medium text-gray-400">
                          +{dayLessons.length - 2} more
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="w-full rounded-xl border border-gray-100 bg-white p-5 shadow-sm lg:w-80">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {selectedKey
                ? new Date(selectedKey).toLocaleDateString("en-SG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Select a date"}
            </h2>
            <button
              onClick={handleLogLesson}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
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
                  className="rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <p className="text-sm font-medium text-gray-900">
                    {l.students?.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {l.students?.subject || "—"} · Lesson{" "}
                    {lessonPosition.get(l.id) ?? "?"} of 4
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
