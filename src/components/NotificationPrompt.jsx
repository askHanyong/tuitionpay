import { useState } from "react";
import {
  isNotificationSupported,
  requestNotificationPermission,
} from "../lib/notifications";
import { useTerms } from "../contexts/TerminologyContext";

const DISMISS_KEY = "notification-prompt-dismissed";

export default function NotificationPrompt() {
  const terms = useTerms();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  if (
    dismissed ||
    !isNotificationSupported() ||
    Notification.permission !== "default"
  ) {
    return null;
  }

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleEnable = async () => {
    await requestNotificationPermission();
    dismiss();
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[#b8e8d9] bg-[#edf6f3] p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-gray-800">
        Enable notifications to get reminders before your {terms.lessons.toLowerCase()} 🔔
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleEnable}
          className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f]"
        >
          Enable
        </button>
        <button
          onClick={dismiss}
          className="min-h-11 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
