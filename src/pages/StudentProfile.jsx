import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatSGD } from "../lib/paymentNotice";
import { formatDate, formatDateFull, formatMonth } from "../utils/dateFormat";
import { paymentModeLabel } from "../lib/paymentMode";
import { useToast } from "../contexts/ToastContext";
import {
  buildPaidReceiptMessage,
  buildPaymentRequestMessage,
} from "../lib/whatsapp";
import { useAuth } from "../contexts/AuthContext";
import { buildGoogleMapsUrl } from "../lib/maps";
import AppShell from "../components/AppShell";
import StatusBadge from "../components/StatusBadge";
import ScheduleLessonsModal from "../components/ScheduleLessonsModal";
import MessagePreviewModal from "../components/MessagePreviewModal";
import ProgressReportModal from "../components/ProgressReportModal";

export default function StudentProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [student, setStudent] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [cycles, setCycles] = useState([]);
  const [tutorProfile, setTutorProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [savingNoteId, setSavingNoteId] = useState(null);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [scheduling, setScheduling] = useState(false);
  const [preview, setPreview] = useState(null);
  const [reporting, setReporting] = useState(false);

  const load = async () => {
    const [
      { data: studentData, error: studentError },
      { data: lessonsData },
      { data: cyclesData },
      { data: tutorData },
    ] = await Promise.all([
      supabase.from("students").select("*").eq("id", id).single(),
      supabase
        .from("lessons")
        .select("*")
        .eq("student_id", id)
        .order("lesson_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_cycles")
        .select("*")
        .eq("student_id", id)
        .order("period_end", { ascending: false }),
      supabase
        .from("tutors")
        .select("full_name, paynow_number")
        .eq("id", user.id)
        .single(),
    ]);
    if (studentError) setError(studentError.message);
    setStudent(studentData ?? null);
    setLessons(lessonsData ?? []);
    setCycles(cyclesData ?? []);
    setTutorProfile(tutorData ?? {});
    setNoteDrafts(
      Object.fromEntries((lessonsData ?? []).map((l) => [l.id, l.notes ?? ""])),
    );
    setLoading(false);
  };

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      await load();
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const lessonPosition = useMemo(() => {
    const sorted = [...lessons].sort((a, b) =>
      a.lesson_date < b.lesson_date
        ? -1
        : a.lesson_date > b.lesson_date
          ? 1
          : 0,
    );
    const positions = new Map();
    sorted.forEach((l, i) => positions.set(l.id, (i % 4) + 1));
    return positions;
  }, [lessons]);

  const completedLessons = lessons.filter((l) => l.status === "completed");
  const totalLessons = completedLessons.length;
  const totalEarned = cycles
    .filter((c) => c.status === "paid")
    .reduce((sum, c) => sum + Number(c.amount_due), 0);
  const openCount = completedLessons.filter((l) => !l.payment_cycle_id).length;
  const currentCycleProgress = `Lesson ${Math.min(openCount, 4)} of 4`;
  const lessonsThisMonth = useMemo(() => {
    const now = new Date();
    return lessons.filter((l) => {
      const d = new Date(`${l.lesson_date}T00:00:00`);
      return (
        d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      );
    }).length;
  }, [lessons]);

  const lessonDatesByCycle = useMemo(() => {
    const map = new Map();
    for (const c of cycles) {
      map.set(
        c.id,
        lessons
          .filter(
            (l) =>
              l.status === "completed" &&
              l.lesson_date >= c.period_start &&
              l.lesson_date <= c.period_end,
          )
          .map((l) => l.lesson_date)
          .sort(),
      );
    }
    return map;
  }, [lessons, cycles]);

  const handleRequestPayment = (cycle) => {
    const message = buildPaymentRequestMessage({
      studentName: student.name,
      subject: student.subject,
      lessonDates: lessonDatesByCycle.get(cycle.id) ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
      paynowNumber: tutorProfile.paynow_number,
      paymentMode: student.payment_mode,
      monthLabel: formatMonth(cycle.period_end),
      dueDateLabel: formatDateFull(cycle.period_end),
    });
    setPreview({ title: "Payment request", message, mode: "whatsapp" });
  };

  const handleSendReceipt = (cycle) => {
    const message = buildPaidReceiptMessage({
      studentName: student.name,
      subject: student.subject,
      lessonDates: lessonDatesByCycle.get(cycle.id) ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
    });
    setPreview({ title: "Payment receipt", message, mode: "whatsapp" });
  };

  const handleSaveNote = async (lessonId) => {
    setSavingNoteId(lessonId);
    const { error } = await supabase
      .from("lessons")
      .update({ notes: noteDrafts[lessonId]?.trim() || null })
      .eq("id", lessonId);
    setSavingNoteId(null);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setLessons((prev) =>
      prev.map((l) =>
        l.id === lessonId
          ? { ...l, notes: noteDrafts[lessonId]?.trim() || null }
          : l,
      ),
    );
    setEditingNoteId(null);
    showToast("Note saved.");
  };

  if (loading) {
    return (
      <AppShell>
        <p className="text-sm text-gray-500">Loading...</p>
      </AppShell>
    );
  }

  if (!student) {
    return (
      <AppShell>
        <p className="text-sm text-red-600">{error || "Student not found."}</p>
        <Link
          to="/students"
          className="text-sm font-medium text-green-600 hover:text-green-700"
        >
          ← Back to students
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Link
        to="/students"
        className="text-sm font-medium text-gray-500 hover:text-gray-900"
      >
        ← Back to students
      </Link>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm transition hover:shadow-md">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">
                {student.name}
              </h1>
              {student.subject && (
                <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                  {student.subject}
                </span>
              )}
              {student.level && (
                <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {student.level}
                </span>
              )}
              <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                {paymentModeLabel(student)}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {student.hourly_rate != null
                ? `$${student.hourly_rate}/hr`
                : "Rate not set"}
              {student.lesson_duration_hours != null &&
                ` · ${student.lesson_duration_hours}h lessons`}
            </p>
            {student.address && (
              <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                <span>📍 {student.address}</span>
                <a
                  href={buildGoogleMapsUrl(student.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-green-600 hover:text-green-700"
                >
                  Open in Maps
                </a>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setScheduling(true)}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Schedule Lessons
            </button>
            <button
              onClick={() =>
                navigate("/students", { state: { editStudentId: student.id } })
              }
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Edit Student
            </button>
            <button
              onClick={() => setReporting(true)}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              📄 Progress Report
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm transition hover:shadow-md">
          <p className="text-2xl font-semibold text-gray-900">{totalLessons}</p>
          <p className="mt-1 text-xs font-medium text-gray-500">
            Total lessons taught
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm transition hover:shadow-md">
          <p className="text-2xl font-semibold text-green-700">
            {formatSGD(totalEarned)}
          </p>
          <p className="mt-1 text-xs font-medium text-gray-500">
            Total earned (paid)
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-5 text-center shadow-sm transition hover:shadow-md">
          <p className="text-2xl font-semibold text-gray-900">
            {Math.min(openCount, 4)}/4
          </p>
          <p className="mt-1 text-xs font-medium text-gray-500">
            Current cycle progress
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Lesson history
        </h2>
        {lessons.length === 0 ? (
          <p className="text-sm text-gray-500">No lessons logged yet.</p>
        ) : (
          <ul className="space-y-4 divide-y divide-gray-100">
            {lessons.map((l) => (
              <li key={l.id} className="pt-4 first:pt-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {formatDate(l.lesson_date)}
                    </span>
                    {l.status === "scheduled" && (
                      <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Scheduled
                      </span>
                    )}
                    <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                      Lesson {lessonPosition.get(l.id) ?? "?"} of 4
                    </span>
                    <button
                      onClick={() =>
                        setEditingNoteId((prev) =>
                          prev === l.id ? null : l.id,
                        )
                      }
                      aria-label="Edit lesson notes"
                      className="text-sm text-gray-400 hover:text-gray-600"
                    >
                      ✏️
                    </button>
                  </div>
                  <span className="text-xs text-gray-500">
                    {(l.duration_minutes / 60).toFixed(2)}h
                    {l.rate != null && ` · $${l.rate}/hr`}
                  </span>
                </div>
                {l.notes && editingNoteId !== l.id && (
                  <p className="mt-1 text-sm italic text-gray-500">{l.notes}</p>
                )}
                {editingNoteId === l.id && (
                  <>
                    <textarea
                      value={noteDrafts[l.id] ?? ""}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [l.id]: e.target.value,
                        }))
                      }
                      placeholder="Add a quick note for this lesson..."
                      rows={2}
                      className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                    {noteDrafts[l.id] !== (l.notes ?? "") && (
                      <button
                        onClick={() => handleSaveNote(l.id)}
                        disabled={savingNoteId === l.id}
                        className="mt-2 min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
                      >
                        {savingNoteId === l.id ? "Saving..." : "Save note"}
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Payment history
        </h2>
        {cycles.length === 0 ? (
          <p className="text-sm text-gray-500">No payment cycles yet.</p>
        ) : (
          <ol className="space-y-4 border-l border-gray-200 pl-4">
            {cycles.map((c) => (
              <li key={c.id} className="relative">
                <span
                  className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${
                    c.status === "paid" ? "bg-green-500" : "bg-red-500"
                  }`}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-gray-700">
                    {formatDate(c.period_start)} – {formatDate(c.period_end)}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {formatSGD(c.amount_due)}
                    </span>
                    <StatusBadge status={c.status} />
                  </span>
                </div>
                {c.paid_at && (
                  <p className="mt-0.5 text-xs text-gray-400">
                    Paid on {formatDate(c.paid_at)}
                  </p>
                )}
                {c.status === "paid" ? (
                  <button
                    onClick={() => handleSendReceipt(c)}
                    className="mt-2 min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white transition hover:bg-green-700 hover:shadow"
                  >
                    💬 Send WhatsApp Receipt
                  </button>
                ) : (
                  <button
                    onClick={() => handleRequestPayment(c)}
                    className="mt-2 min-h-11 rounded-md bg-orange-500 px-3 text-xs font-medium text-white transition hover:bg-orange-600 hover:shadow"
                  >
                    💬 Request Payment
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {scheduling && (
        <ScheduleLessonsModal
          student={student}
          onClose={() => setScheduling(false)}
          onScheduled={load}
        />
      )}

      {preview && (
        <MessagePreviewModal
          title={preview.title}
          initialMessage={preview.message}
          mode={preview.mode}
          onClose={() => setPreview(null)}
        />
      )}

      {reporting && (
        <ProgressReportModal
          student={student}
          lessons={lessons}
          cycles={cycles}
          tutorName={tutorProfile.full_name}
          lessonPosition={lessonPosition}
          currentCycleProgress={currentCycleProgress}
          lessonsThisMonth={lessonsThisMonth}
          onClose={() => setReporting(false)}
        />
      )}
    </AppShell>
  );
}
