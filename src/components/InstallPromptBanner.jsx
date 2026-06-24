import { useEffect, useState } from "react";

const DISMISS_KEY = "install-prompt-dismissed";

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

export default function InstallPromptBanner() {
  const [deferredEvent, setDeferredEvent] = useState(null);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "1",
  );

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredEvent(event);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
    };
  }, []);

  if (dismissed || !deferredEvent || isStandalone()) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const handleInstall = async () => {
    await deferredEvent.prompt();
    setDeferredEvent(null);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 border-t border-gray-200 bg-white px-4 py-3 shadow-lg sm:px-6">
      <p className="text-sm font-medium text-gray-800">
        Add ChopeAndPay to your home screen for quick access 📲
      </p>
      <div className="flex flex-none items-center gap-2">
        <button
          onClick={handleInstall}
          className="min-h-9 rounded-md bg-green-600 px-3 text-sm font-medium text-white transition hover:bg-green-700"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
