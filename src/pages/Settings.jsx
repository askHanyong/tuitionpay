import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";

export default function Settings() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [paynowNumber, setPaynowNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("tutors")
        .select("paynow_number")
        .eq("id", user.id)
        .single();
      if (error) setError(error.message);
      setPaynowNumber(data?.paynow_number ?? "");
      setLoading(false);
    };
    load();
  }, [user.id]);

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
    </AppShell>
  );
}
