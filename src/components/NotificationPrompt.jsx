import { useState } from "react";
import {
  isNotificationSupported,
  requestNotificationPermission,
} from "../lib/notifications";

const DISMISS_KEY = "notification-prompt-dismissed";

export default function NotificationPrompt() {
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
    <section className="flex flex-col gap-3 rounded-xl border border-green-200 bg-green-50 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-gray-800">
        Enable notifications to get reminders before your lessons 🔔
      </p>
      <div className="flex gap-2">
        <button
          onClick={handleEnable}
          className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700"
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
