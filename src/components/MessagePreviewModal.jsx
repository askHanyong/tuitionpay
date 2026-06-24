import { useState } from "react";
import { buildWhatsAppLink } from "../lib/whatsapp";

export default function MessagePreviewModal({
  title,
  initialMessage,
  mode,
  onClose,
}) {
  const [text, setText] = useState(initialMessage);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSendWhatsApp = () => {
    window.open(buildWhatsAppLink(text), "_blank");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={handleCopy}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            {copied ? "Copied!" : "Copy to clipboard"}
          </button>
          {mode === "whatsapp" && (
            <button
              onClick={handleSendWhatsApp}
              className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
            >
              💬 Open WhatsApp
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
