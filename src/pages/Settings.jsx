import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import {
  isGoogleTokenValid,
  requestGoogleCalendarAccess,
  revokeGoogleCalendarAccess,
} from "../lib/googleCalendar";

export default function Settings() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [paynowNumber, setPaynowNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [googleTutor, setGoogleTutor] = useState(null);
  const [connecting, setConnecting] = useState(false);

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
      const { data, error } = await supabase
        .from("tutors")
        .select("paynow_number, google_access_token, google_token_expiry")
        .eq("id", user.id)
        .single();
      if (error) setError(error.message);
      setPaynowNumber(data?.paynow_number ?? "");
      setGoogleTutor(data ?? null);
      setLoading(false);
    };
    load();
  }, [user.id]);

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
    </AppShell>
  );
}
