import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const STEPS = [
  { key: "student", label: "Add your first student" },
  { key: "lesson", label: "Log your first lesson" },
  { key: "calendar", label: "Connect Google Calendar" },
];

export default function GettingStartedChecklist({
  tutorId,
  hasStudent,
  hasLesson,
  googleCalendarConnected,
  dismissed,
  onDismissed,
}) {
  const [hidden, setHidden] = useState(false);

  const stepDone = {
    student: hasStudent,
    lesson: hasLesson,
    calendar: googleCalendarConnected,
  };
  const completedCount = STEPS.filter((s) => stepDone[s.key]).length;
  const allDone = completedCount === STEPS.length;

  useEffect(() => {
    if (!allDone) return;
    const timer = setTimeout(async () => {
      setHidden(true);
      await supabase
        .from("tutors")
        .update({ onboarding_dismissed: true })
        .eq("id", tutorId);
      onDismissed?.();
    }, 3000);
    return () => clearTimeout(timer);
  }, [allDone, tutorId, onDismissed]);

  const handleDismiss = async () => {
    setHidden(true);
    await supabase
      .from("tutors")
      .update({ onboarding_dismissed: true })
      .eq("id", tutorId);
    onDismissed?.();
  };

  if (dismissed || hidden) return null;

  return (
    <div className="relative rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 pr-10 shadow-sm sm:p-5">
      <button
        onClick={handleDismiss}
        aria-label="Dismiss checklist"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-[#0f7a58] hover:bg-[#d6ede6]"
      >
        ✕
      </button>

      <div className="mb-3 flex items-center justify-between pr-6">
        <p className="text-sm font-semibold text-[#0f1e35]">
          🚀 Getting started
        </p>
        <span className="text-xs text-[#0f7a58]">
          {completedCount} of {STEPS.length} done
        </span>
      </div>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#d6ede6]">
        <div
          className="h-full rounded-full bg-[#5ecfaa] transition-all duration-500"
          style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
        />
      </div>

      {allDone ? (
        <p className="text-sm font-medium text-[#0f7a58]">
          🎉 You&apos;re all set! Enjoy ChopeAndPay.
        </p>
      ) : (
        <ul className="space-y-2">
          {STEPS.map((step) => (
            <li key={step.key} className="flex items-center gap-2 text-sm">
              <span className={stepDone[step.key] ? "text-[#5ecfaa]" : "text-gray-300"}>
                {stepDone[step.key] ? "✓" : "○"}
              </span>
              <span
                className={
                  stepDone[step.key]
                    ? "text-gray-400 line-through"
                    : "text-[#1b2d4f]"
                }
              >
                {step.label}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
