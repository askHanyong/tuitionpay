import {
  buildFeedbackMailtoLink,
  buildFeedbackWhatsAppLink,
} from "../lib/feedback";

export default function FeedbackModal({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              We'd love your feedback! 🙏
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Help us make ChopeAndPay better for Singapore tutors and
              freelancers.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <a
            href={buildFeedbackWhatsAppLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-green-300 hover:bg-green-50"
          >
            <span className="text-2xl">💬</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">WhatsApp us</p>
              <p className="text-xs text-gray-500">Quick chat, fast reply</p>
            </div>
          </a>
          <a
            href={buildFeedbackMailtoLink()}
            className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 transition hover:border-green-300 hover:bg-green-50"
          >
            <span className="text-2xl">✉️</span>
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Send an email
              </p>
              <p className="text-xs text-gray-500">mathstutorlimhy@gmail.com</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
