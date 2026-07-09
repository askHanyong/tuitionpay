import { useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

export default function Auth() {
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(
    searchParams.get("mode") === "signup" ? "signup" : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [userType, setUserType] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Prevent the session-triggered redirect from firing while signup is in flight.
  // onAuthStateChange can set `session` before our async handler finishes.
  const signingUpRef = useRef(false);

  const { session, signIn, signUp } = useAuth();
  const navigate = useNavigate();

  if (session && !signingUpRef.current) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    try {
      if (mode === "signup") {
        if (!userType) {
          setError("Please select whether you're a tutor or a practitioner.");
          return;
        }

        signingUpRef.current = true;

        const { data, error: signUpError } = await signUp(email, password, fullName, userType);

        if (signUpError) {
          // Map common Supabase auth error messages to friendlier copy.
          const msg = signUpError.message ?? "";
          if (msg.toLowerCase().includes("password")) {
            throw new Error("Password must be at least 6 characters.");
          }
          if (msg.toLowerCase().includes("already registered") || msg.toLowerCase().includes("user already exists")) {
            throw new Error("An account with this email already exists. Try logging in instead.");
          }
          throw signUpError;
        }

        const uid = data?.user?.id;

        if (data?.session) {
          // Email confirmation is disabled — user is signed in immediately.
          // Upsert user_type now that we have an active session.
          if (uid) {
            await new Promise((r) => setTimeout(r, 800));
            const { error: upsertError } = await supabase
              .from("tutors")
              .upsert({ id: uid, user_type: userType }, { onConflict: "id" });
            if (upsertError) {
              // Non-fatal: user_type is already in auth metadata as a fallback.
              console.error("user_type upsert failed:", upsertError.message, upsertError);
            }
          }
          signingUpRef.current = false;
          navigate("/dashboard", { replace: true });
        } else {
          // Email confirmation is required — no session yet.
          // user_type is already saved in auth metadata (passed to signUp above).
          // The DB trigger upsert will happen when they confirm and first log in.
          signingUpRef.current = false;
          setInfo("Check your email to confirm your account, then log in.");
          setMode("login");
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) {
          const msg = signInError.message ?? "";
          if (msg.toLowerCase().includes("invalid") || msg.toLowerCase().includes("credentials")) {
            throw new Error("Incorrect email or password. Please try again.");
          }
          throw signInError;
        }
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      signingUpRef.current = false;
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 shadow">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-semibold text-gray-900">
          <span aria-hidden="true">🌿</span>
          ChopeAndPay
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {mode === "login"
            ? "Log in to your account"
            : "Create your account"}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Full name
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                />
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">
                  I am a…
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "tutor", emoji: "📚", label: "Tutor", sub: "Students · Lessons" },
                    { value: "practitioner", emoji: "🩺", label: "Practitioner", sub: "Clients · Sessions" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setUserType(opt.value)}
                      className="relative flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-4 text-center transition"
                      style={
                        userType === opt.value
                          ? { borderColor: "#5ecfaa", backgroundColor: "#edf6f3" }
                          : { borderColor: "#e5e7eb", backgroundColor: "#ffffff" }
                      }
                    >
                      {userType === opt.value && (
                        <span
                          className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-white text-xs"
                          style={{ backgroundColor: "#5ecfaa" }}
                        >
                          ✓
                        </span>
                      )}
                      <span className="text-2xl">{opt.emoji}</span>
                      <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
                      <span className="text-xs text-gray-500">{opt.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-[#5ecfaa]">{info}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-11 w-full rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
          >
            {submitting
              ? "Please wait..."
              : mode === "login"
                ? "Log in"
                : "Sign up"}
          </button>

          {mode === "signup" && (
            <p className="text-center text-xs text-gray-500">
              <span aria-hidden="true">🔒</span> Free · Your data is private ·
              No credit card needed
            </p>
          )}
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          {mode === "login"
            ? "Don't have an account?"
            : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError(null);
              setInfo(null);
            }}
            className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
          >
            {mode === "login" ? "Sign up" : "Log in"}
          </button>
        </p>
      </div>
    </div>
  );
}
