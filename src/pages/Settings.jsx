import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import {
  isGoogleTokenValid,
  requestGoogleCalendarAccess,
  revokeGoogleCalendarAccess,
} from "../lib/googleCalendar";
import {
  buildReferralLink,
  buildReferralWhatsAppMessage,
} from "../lib/referral";
import { buildWhatsAppLink } from "../lib/whatsapp";
import {
  buildFeedbackMailtoLink,
  buildFeedbackWhatsAppLink,
} from "../lib/feedback";

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
  const [connecting, setConnecting] = useState(false);
  const [referralCode, setReferralCode] = useState(null);
  const [referralCount, setReferralCount] = useState(0);
  const [linkCopied, setLinkCopied] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState({
    notify_lesson_reminders: true,
    notify_payment_due: true,
    notify_weekly_summary: true,
  });

  const loadGoogleStatus = async () => {
    const { data } = await supabase
      .from("tutors")
      .select("google_access_token, google_token_expiry")
      .eq("id", user.id)
      .single();
    setGoogleTutor(data ?? null);
  };

  useEffect(() => {
    const load = async () => {
      const [{ data, error }, { data: referralCountData }] = await Promise.all([
        supabase
          .from("tutors")
          .select(
            "paynow_number, google_access_token, google_token_expiry, notify_lesson_reminders, notify_payment_due, notify_weekly_summary, referral_code",
          )
          .eq("id", user.id)
          .single(),
        supabase.rpc("referral_count"),
      ]);
      if (error) setError(error.message);
      setPaynowNumber(data?.paynow_number ?? "");
      setGoogleTutor(data ?? null);
      setReferralCode(data?.referral_code ?? null);
      setReferralCount(referralCountData ?? 0);
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

  const handleCopyReferralLink = async () => {
    await navigator.clipboard.writeText(buildReferralLink(referralCode));
    setLinkCopied(true);
    showToast("Referral link copied.");
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleShareReferralWhatsApp = () => {
    window.open(
      buildWhatsAppLink(buildReferralWhatsAppMessage(referralCode)),
      "_blank",
    );
  };

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

  const handleConnectGoogle = async () => {
    setConnecting(true);
    try {
      const { accessToken, expiresAt } = await requestGoogleCalendarAccess();
      const { error } = await supabase
        .from("tutors")
        .update({
          google_access_token: accessToken,
          google_token_expiry: expiresAt,
        })
        .eq("id", user.id);
      if (error) throw error;
      await loadGoogleStatus();
      showToast("Google Calendar connected.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    revokeGoogleCalendarAccess(googleTutor?.google_access_token);
    const { error } = await supabase
      .from("tutors")
      .update({ google_access_token: null, google_token_expiry: null })
      .eq("id", user.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    await loadGoogleStatus();
    showToast("Google Calendar disconnected.");
  };

  const googleConnected = isGoogleTokenValid(googleTutor);

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
              ✓ Connected
            </span>
            <button
              onClick={handleDisconnectGoogle}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnectGoogle}
            disabled={connecting}
            className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow disabled:opacity-50"
          >
            {connecting ? "Connecting..." : "Connect Google Calendar"}
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
        <h2 className="text-base font-semibold text-gray-900">
          Refer a Friend
        </h2>
        <p className="text-sm text-gray-600">
          Invite other tutors to ChopeAndPay and help us grow!
        </p>

        {referralCode && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Your referral link
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  readOnly
                  value={buildReferralLink(referralCode)}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                />
                <button
                  type="button"
                  onClick={handleCopyReferralLink}
                  className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                >
                  {linkCopied ? "Copied!" : "Copy link"}
                </button>
                <button
                  type="button"
                  onClick={handleShareReferralWhatsApp}
                  className="min-h-11 rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
                >
                  💬 Share via WhatsApp
                </button>
              </div>
            </div>

            <p className="text-sm font-medium text-gray-900">
              You've referred {referralCount}{" "}
              {referralCount === 1 ? "tutor" : "tutors"} so far! 🎉
            </p>
          </>
        )}

        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          🏆 Top referrers will get exclusive perks when we launch premium
          features — keep sharing!
        </div>
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
      </section>
    </AppShell>
  );
}
