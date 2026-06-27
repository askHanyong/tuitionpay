import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { useToast } from "../../contexts/ToastContext";
import { exchangeCodeForTokens } from "../../lib/googleCalendar";

export default function GoogleCallback() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const run = async () => {
      const code = searchParams.get("code");
      const oauthError = searchParams.get("error");
      if (oauthError) {
        setError("Google sign-in was cancelled or denied.");
        return;
      }
      if (!code) {
        setError("Missing authorization code from Google.");
        return;
      }
      try {
        const tokens = await exchangeCodeForTokens(code);
        const { error: dbError } = await supabase
          .from("tutors")
          .update({
            google_calendar_tokens: {
              access_token: tokens.access_token,
              refresh_token: tokens.refresh_token,
              expiry_date: tokens.expiry_date,
              email: tokens.email ?? null,
            },
          })
          .eq("id", user.id);
        if (dbError) throw dbError;
        showToast("Google Calendar connected.");
        navigate("/settings", { replace: true });
      } catch (err) {
        setError(err.message);
      }
    };

    run();
  }, [searchParams, user.id, navigate, showToast]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-6 text-center">
        {error ? (
          <>
            <p className="mb-4 text-sm text-red-600">{error}</p>
            <button
              onClick={() => navigate("/settings", { replace: true })}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
            >
              Back to Settings
            </button>
          </>
        ) : (
          <p className="text-sm text-gray-600">Connecting Google Calendar...</p>
        )}
      </div>
    </div>
  );
}
