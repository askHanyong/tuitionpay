import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

// Landing page for the link in the "reset your password" email.
// Supabase signs the user in with a temporary recovery session when they
// arrive here, so we wait for that session, then let them set a new password.
export default function ResetPassword() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  // If no recovery session appears within a few seconds, the link is
  // invalid or has expired.
  useEffect(() => {
    const t = setTimeout(() => setWaitedTooLong(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message || "Could not update your password. Please try again.");
      return;
    }
    setDone(true);
    setTimeout(() => navigate("/dashboard", { replace: true }), 1500);
  };

  const inputClass =
    "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <Link to="/" className="mb-1 flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <span aria-hidden="true">🍀</span>
          ChopeAndPay
        </Link>
        <h1 className="mt-3 text-lg font-semibold text-gray-900">Set a new password</h1>

        {done ? (
          <p className="mt-4 text-sm text-[#0f7a58]">
            Password updated. Taking you to your dashboard…
          </p>
        ) : !session ? (
          waitedTooLong ? (
            <div className="mt-4 space-y-4">
              <p className="text-sm text-red-600">
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <Link
                to="/login?mode=forgot"
                className="flex min-h-11 w-full items-center justify-center rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f]"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-500">Checking your reset link…</p>
          )
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1 block text-sm font-medium text-gray-700">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-500">At least 6 characters.</p>
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium text-gray-700">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
            >
              {submitting ? "Please wait..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
