import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";

const STEPS = [
  { label: "Add your first student" },
  { label: "Log your first lesson" },
  { label: "You're all set!" },
];

const today = () => new Date().toISOString().slice(0, 10);

export default function Onboarding({ onDismiss, onDone }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [student, setStudent] = useState(null);
  const [studentForm, setStudentForm] = useState({
    name: "",
    subject: "",
    hourly_rate: "",
    lesson_duration_hours: "",
  });
  const [lessonForm, setLessonForm] = useState({
    lesson_date: today(),
    duration_hours: "",
  });

  const handleAddStudent = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: studentForm.name.trim(),
        subject: studentForm.subject.trim() || null,
        hourly_rate:
          studentForm.hourly_rate === ""
            ? null
            : Number(studentForm.hourly_rate),
        lesson_duration_hours:
          studentForm.lesson_duration_hours === ""
            ? null
            : Number(studentForm.lesson_duration_hours),
        tutor_id: user.id,
      };
      const { data, error } = await supabase
        .from("students")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      setStudent(data);
      setLessonForm((f) => ({
        ...f,
        duration_hours: data.lesson_duration_hours ?? "",
      }));
      setStep(2);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogLesson = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const durationHours = Number(lessonForm.duration_hours);
      const { error } = await supabase.from("lessons").insert({
        tutor_id: user.id,
        student_id: student.id,
        lesson_date: lessonForm.lesson_date,
        duration_minutes: Math.round(durationHours * 60),
        rate: student.hourly_rate ?? null,
        is_completed: true,
      });
      if (error) throw error;
      setStep(3);
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    localStorage.setItem("chopeandpay_onboarding_dismissed", "true");
    onDismiss?.();
  };

  const handleFinish = () => {
    localStorage.setItem("chopeandpay_onboarding_dismissed", "true");
    onDone?.();
    navigate("/dashboard");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl sm:p-6">
        <div className="mb-6 flex items-center justify-between">
          <ol className="flex flex-1 items-center gap-2">
            {STEPS.map((s, i) => {
              const stepNum = i + 1;
              const active = stepNum === step;
              const done = stepNum < step;
              return (
                <li key={s.label} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      done
                        ? "bg-[#1b2d4f] text-white"
                        : active
                          ? "bg-[#d6ede6] text-[#0f7a58] ring-2 ring-[#1b2d4f]"
                          : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {done ? "✓" : stepNum}
                  </span>
                  {stepNum < STEPS.length && (
                    <span
                      className={`h-0.5 flex-1 ${done ? "bg-[#1b2d4f]" : "bg-gray-200"}`}
                    />
                  )}
                </li>
              );
            })}
          </ol>
          <button
            onClick={handleSkip}
            className="ml-3 text-sm font-medium text-gray-400 hover:text-gray-600"
          >
            Skip
          </button>
        </div>

        {step === 1 && (
          <form onSubmit={handleAddStudent} className="space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              Add your first student
            </h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                type="text"
                required
                value={studentForm.name}
                onChange={(e) =>
                  setStudentForm({ ...studentForm, name: e.target.value })
                }
                className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Subject
              </label>
              <input
                type="text"
                value={studentForm.subject}
                onChange={(e) =>
                  setStudentForm({ ...studentForm, subject: e.target.value })
                }
                className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Hourly rate
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={studentForm.hourly_rate}
                  onChange={(e) =>
                    setStudentForm({
                      ...studentForm,
                      hourly_rate: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Duration (hrs)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.25"
                  value={studentForm.lesson_duration_hours}
                  onChange={(e) =>
                    setStudentForm({
                      ...studentForm,
                      lesson_duration_hours: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              </div>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Add student"}
            </button>
          </form>
        )}

        {step === 2 && (
          <form onSubmit={handleLogLesson} className="space-y-4">
            <h2 className="text-base font-semibold text-gray-900">
              Log your first lesson for {student?.name}
            </h2>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Date
              </label>
              <input
                type="date"
                required
                value={lessonForm.lesson_date}
                onChange={(e) =>
                  setLessonForm({ ...lessonForm, lesson_date: e.target.value })
                }
                className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Duration (hours)
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.25"
                value={lessonForm.duration_hours}
                onChange={(e) =>
                  setLessonForm({
                    ...lessonForm,
                    duration_hours: e.target.value,
                  })
                }
                className="min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Log lesson"}
            </button>
          </form>
        )}

        {step === 3 && (
          <div className="space-y-4 text-center">
            <p className="text-4xl">🎉</p>
            <h2 className="text-base font-semibold text-gray-900">
              You're all set!
            </h2>
            <p className="text-sm text-gray-600">
              {student?.name} is added, and their first lesson is logged. You'll
              get a payment notice automatically after every 4 lessons.
            </p>
            <button
              onClick={handleFinish}
              className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f]"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
