import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const STEPS = [
  { key: "student", label: "Add your first student" },
  { key: "scheduled", label: "Schedule a lesson" },
  { key: "completed", label: "Log a completed lesson" },
  { key: "paid", label: "Send your first WhatsApp receipt" },
];

export default function GettingStartedChecklist({
  tutorId,
  hasStudent,
  hasScheduledLesson,
  hasCompletedLesson,
  hasPaidCycle,
  dismissed,
  onDismissed,
}) {
  const [hidden, setHidden] = useState(false);

  const stepDone = {
    student: hasStudent,
    scheduled: hasScheduledLesson,
    completed: hasCompletedLesson,
    paid: hasPaidCycle,
  };
  const completedCount = STEPS.filter((s) => stepDone[s.key]).length;
  const allDone = completedCount === STEPS.length;
  const celebrating = allDone;

  useEffect(() => {
    if (!celebrating) return;
    const timer = setTimeout(async () => {
      setHidden(true);
      await supabase
        .from("tutors")
        .update({ onboarding_dismissed: true })
        .eq("id", tutorId);
      onDismissed?.();
    }, 5000);
    return () => clearTimeout(timer);
  }, [celebrating, tutorId, onDismissed]);

  const handleSkip = async () => {
    setHidden(true);
    await supabase
      .from("tutors")
      .update({ onboarding_dismissed: true })
      .eq("id", tutorId);
    onDismissed?.();
  };

  if (dismissed || hidden) return null;

  if (celebrating) {
    return (
      <div
        className="rounded-xl border-l-4 border-[#5ecfaa] p-5 shadow-sm"
        style={{ backgroundColor: "#edf6f3" }}
      >
        <p className="text-sm font-medium text-[#1b2d4f]">
          🎉 You&apos;re all set! You&apos;re ready to use ChopeAndPay like a
          pro.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border-l-4 border-[#5ecfaa] p-5 shadow-sm"
      style={{ backgroundColor: "#edf6f3" }}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          Getting started
        </h2>
        <span className="text-xs text-gray-500">
          {completedCount} of {STEPS.length} completed
        </span>
      </div>

      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-[#d6ede6]">
        <div
          className="h-full rounded-full bg-[#5ecfaa] transition-all"
          style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
        />
      </div>

      <ul className="space-y-2">
        {STEPS.map((step) => (
          <li key={step.key} className="flex items-center gap-2 text-sm">
            <span
              className={
                stepDone[step.key] ? "text-[#5ecfaa]" : "text-gray-400"
              }
            >
              {stepDone[step.key] ? "☑" : "☐"}
            </span>
            <span
              className={
                stepDone[step.key]
                  ? "text-gray-500 line-through"
                  : "text-gray-700"
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSkip}
          className="text-xs font-medium text-gray-500 hover:text-gray-700"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
