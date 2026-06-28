import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import {
  buildGoogleAuthUrl,
  disconnectGoogleCalendar,
  isGoogleConnected,
} from "../lib/googleCalendar";
import {
  buildFeedbackMailtoLink,
  buildFeedbackWhatsAppLink,
} from "../lib/feedback";
import { formatDate } from "../utils/dateFormat";
import { formatLessonTime } from "../lib/date";

const CSV_COLUMN_SEPARATOR = ",";

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(CSV_COLUMN_SEPARATOR)];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(CSV_COLUMN_SEPARATOR));
  }
  return lines.join("\n");
}

function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function todayFilenameSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatAmount(value) {
  if (value == null) return "";
  return Number(value).toFixed(2);
}

const NOTIFICATION_TYPES = [
  {
    key: "notify_lesson_reminders",
    label: "Pre-lesson reminders",
    description: "Notify me 30 minutes before each scheduled lesson.",
  },
  {
    key: "notify_payment_due",
    label: "Payment due",
    description: "Notify me as soon as a student completes their 4th lesson.",
  },
  {
    key: "notify_weekly_summary",
    label: "Weekly summary",
    description: "Notify me every Sunday at 8pm with a summary of the week.",
  },
];

export default function Settings() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [paynowNumber, setPaynowNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [googleTutor, setGoogleTutor] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [exportingLessons, setExportingLessons] = useState(false);
  const [exportingPayments, setExportingPayments] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState({
    notify_lesson_reminders: true,
    notify_payment_due: true,
    notify_weekly_summary: true,
  });

  const loadGoogleStatus = async () => {
    const { data } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", user.id)
      .single();
    setGoogleTutor(data ?? null);
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("tutors")
        .select(
          "paynow_number, google_calendar_tokens, notify_lesson_reminders, notify_payment_due, notify_weekly_summary",
        )
        .eq("id", user.id)
        .single();
      if (error) setError(error.message);
      setPaynowNumber(data?.paynow_number ?? "");
      setGoogleTutor(data ?? null);
      if (data) {
        setNotifyPrefs({
          notify_lesson_reminders: data.notify_lesson_reminders,
          notify_payment_due: data.notify_payment_due,
          notify_weekly_summary: data.notify_weekly_summary,
        });
      }
      setLoading(false);
    };
    load();
  }, [user.id]);

  const handleToggleNotification = async (key) => {
    const nextValue = !notifyPrefs[key];
    setNotifyPrefs((prev) => ({ ...prev, [key]: nextValue }));
    const { error } = await supabase
      .from("tutors")
      .update({ [key]: nextValue })
      .eq("id", user.id);
    if (error) {
      setNotifyPrefs((prev) => ({ ...prev, [key]: !nextValue }));
      showToast(error.message, "error");
      return;
    }
    showToast("Notification preferences saved.");
  };

  const handleConnectGoogle = () => {
    window.location.href = buildGoogleAuthUrl();
  };

  const handleDisconnectGoogle = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogleCalendar(user.id);
      await loadGoogleStatus();
      showToast("Google Calendar disconnected.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const googleConnected = isGoogleConnected(googleTutor);
  const googleEmail = googleTutor?.google_calendar_tokens?.email;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from("tutors")
      .update({ paynow_number: paynowNumber.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    showToast("Settings saved.");
  };

  const handleExportLessons = async () => {
    setExportingLessons(true);
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("*, students(name, subject)")
        .eq("tutor_id", user.id)
        .order("lesson_date", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []).map((lesson) => {
        const durationHours = lesson.duration_minutes
          ? lesson.duration_minutes / 60
          : null;
        const amount =
          durationHours != null && lesson.rate != null
            ? durationHours * lesson.rate
            : null;
        return [
          lesson.students?.name ?? "",
          lesson.students?.subject ?? "",
          formatDate(lesson.lesson_date),
          lesson.lesson_time ? formatLessonTime(lesson.lesson_time) : "",
          durationHours != null ? durationHours.toFixed(2) : "",
          formatAmount(lesson.rate),
          formatAmount(amount),
          lesson.status ?? "",
          lesson.notes ?? "",
          lesson.payment_cycle_id ?? "",
        ];
      });

      const csv = toCSV(
        [
          "Student name",
          "Subject",
          "Lesson date",
          "Lesson time",
          "Duration (hrs)",
          "Rate (SGD/hr)",
          "Amount (SGD)",
          "Status",
          "Notes",
          "Payment cycle ID",
        ],
        rows,
      );
      downloadCSV(`chopeandpay_lessons_${todayFilenameSuffix()}.csv`, csv);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setExportingLessons(false);
    }
  };

  const handleExportPayments = async () => {
    setExportingPayments(true);
    try {
      const { data, error } = await supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
        .order("period_start", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []).map((cycle) => [
        cycle.students?.name ?? "",
        formatDate(cycle.period_start),
        formatDate(cycle.period_end),
        formatAmount(cycle.amount_due),
        cycle.status ?? "",
        cycle.paid_at ? formatDate(cycle.paid_at) : "",
      ]);

      const csv = toCSV(
        [
          "Student name",
          "Period start",
          "Period end",
          "Amount due (SGD)",
          "Status",
          "Paid at",
        ],
        rows,
      );
      downloadCSV(`chopeandpay_payments_${todayFilenameSuffix()}.csv`, csv);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setExportingPayments(false);
    }
  };

  return (
    <AppShell>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold text-gray-900">
          Payment settings
        </h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            PayNow number or UEN
          </label>
          <input
            type="text"
            value={paynowNumber}
            onChange={(e) => setPaynowNumber(e.target.value)}
            placeholder="e.g. 9123 4567"
            disabled={loading}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            Shown automatically in WhatsApp payment request messages.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || saving}
          className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Google Calendar
        </h2>
        <p className="text-sm text-gray-600">
          {googleConnected
            ? "Connected. Lessons you log will automatically be added to your Google Calendar."
            : "Connect your Google Calendar so every lesson you log is added automatically."}
        </p>
        {googleConnected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
              ✓ Connected{googleEmail ? ` as ${googleEmail}` : ""}
            </span>
            <button
              onClick={handleDisconnectGoogle}
              disabled={disconnecting}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnectGoogle}
            className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
          >
            Connect Google Calendar
          </button>
        )}
      </section>

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
        <ul className="divide-y divide-gray-100">
          {NOTIFICATION_TYPES.map((type) => (
            <li
              key={type.key}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {type.label}
                </p>
                <p className="text-xs text-gray-500">{type.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifyPrefs[type.key]}
                onClick={() => handleToggleNotification(type.key)}
                disabled={loading}
                className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full transition disabled:opacity-50 ${
                  notifyPrefs[type.key] ? "bg-green-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    notifyPrefs[type.key] ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Send Feedback</h2>
        <p className="text-sm text-gray-600">
          Got a suggestion or found a bug? We'd love to hear from you.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={buildFeedbackWhatsAppLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
          >
            💬 WhatsApp us
          </a>
          <a
            href={buildFeedbackMailtoLink()}
            className="flex min-h-11 items-center rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
          >
            ✉️ Send an email
          </a>
        </div>
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Export my data
        </h2>
        <p className="text-sm text-gray-600">
          Download your lesson and payment history as CSV files.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleExportLessons}
            disabled={exportingLessons}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {exportingLessons ? "Preparing..." : "📥 Download lessons"}
          </button>
          <button
            type="button"
            onClick={handleExportPayments}
            disabled={exportingPayments}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {exportingPayments ? "Preparing..." : "📥 Download payments"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Your data is exported as CSV, compatible with Excel and Google Sheets
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Legal</h2>
        <div className="flex flex-wrap gap-4">
          <Link
            to="/privacy"
            className="text-sm font-medium text-green-600 hover:text-green-700"
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms"
            className="text-sm font-medium text-green-600 hover:text-green-700"
          >
            Terms of Service
          </Link>
        </div>
        <p className="text-xs text-gray-500">
          <span aria-hidden="true">🔒</span> Your data is private — only you can
          see your students and earnings. The developer does not access
          individual tutor data. Read our Privacy Policy for full details.
        </p>
      </section>
    </AppShell>
  );
}
