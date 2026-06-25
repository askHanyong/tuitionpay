import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const PROBLEMS = [
  { emoji: "📱", text: "Chasing payments over WhatsApp" },
  { emoji: "📊", text: "Tracking lessons in Excel spreadsheets" },
  { emoji: "😰", text: "Forgetting which students haven't paid you" },
];

const FEATURES = [
  {
    emoji: "📅",
    title: "Schedule recurring lessons",
    description: "Set it once, never forget.",
  },
  {
    emoji: "💰",
    title: "Track payments automatically",
    description: "Know exactly which lesson and when payment is due.",
  },
  {
    emoji: "📲",
    title: "Send WhatsApp receipts",
    description: "Professional payment confirmations in one tap.",
  },
  {
    emoji: "📊",
    title: "Monthly earnings reports",
    description: "See your income at a glance.",
  },
];

const TESTIMONIALS = [
  {
    name: "Rachel Tan",
    subject: "Sec Math & A Math",
    quote: "I used to lose track of who owed me what. Now it's all automatic.",
  },
  {
    name: "Wei Jie Koh",
    subject: "JC H2 Chemistry",
    quote: "Sending payment reminders takes seconds instead of an evening.",
  },
  {
    name: "Aisha Rahman",
    subject: "Primary English",
    quote: "Finally something built for how Singapore tutors actually work.",
  },
];

function PhoneMockup() {
  return (
    <div className="hidden flex-none lg:block">
      <div className="w-72 rounded-[2.5rem] border-8 border-gray-900 bg-gray-900 p-2 shadow-2xl">
        <div className="overflow-hidden rounded-[2rem] bg-gray-50">
          <div className="bg-white px-4 py-3">
            <p className="text-xs font-semibold text-gray-900">
              🌿 ChopeAndPay
            </p>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-lg bg-green-50 p-3">
              <p className="text-[10px] font-medium text-gray-500">
                Today's lessons
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-900">
                Wei Ming · 3:30pm
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-[10px] font-medium text-gray-500">
                June recap
              </p>
              <p className="mt-1 text-sm font-bold text-green-700">
                $2,840 collected
              </p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="text-[10px] font-medium text-red-700">
                ⚠️ Payment due
              </p>
              <p className="mt-1 text-xs text-red-800">
                Priya — $540, 4 lessons completed
              </p>
            </div>
            <div className="space-y-2">
              {["Danial", "Sarah", "Wei Ming"].map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm"
                >
                  <span className="text-xs font-medium text-gray-800">
                    {name}
                  </span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full w-2/3 rounded-full bg-green-500" />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { session } = useAuth();

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <span aria-hidden="true">🍀</span>
            ChopeAndPay
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              to="/about"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 flex items-center"
            >
              About
            </Link>
            <Link
              to="/login"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 flex items-center"
            >
              Log in
            </Link>
            <Link
              to="/login?mode=signup"
              className="flex min-h-11 items-center rounded-md bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
            >
              Sign up free
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-col items-center gap-12 lg:flex-row lg:justify-between">
          <div className="max-w-xl text-center lg:text-left">
            <h1 className="text-3xl font-bold leading-tight text-gray-900 sm:text-5xl">
              Stop tracking payments in WhatsApp. Start using ChopeAndPay.
            </h1>
            <p className="mt-5 text-lg text-gray-600">
              Chope your slots. Track your lessons. Get paid on time.
            </p>
            <div className="mt-8 flex justify-center lg:justify-start">
              <Link
                to="/login?mode=signup"
                className="flex min-h-12 items-center rounded-md bg-green-600 px-8 text-base font-semibold text-white shadow-lg transition hover:bg-green-700 hover:shadow-xl"
              >
                Sign up free
              </Link>
            </div>
          </div>
          <PhoneMockup />
        </div>
      </section>

      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
            Sound familiar?
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {PROBLEMS.map((p) => (
              <div
                key={p.text}
                className="rounded-xl border border-gray-100 bg-white p-6 text-center shadow-sm"
              >
                <p className="text-4xl">{p.emoji}</p>
                <p className="mt-4 text-sm font-medium text-gray-800">
                  {p.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
            Everything you need, built in
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <p className="text-3xl">{f.emoji}</p>
                <h3 className="mt-3 text-sm font-semibold text-gray-900">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
            Loved by tutors across Singapore
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div
                key={t.name}
                className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
              >
                <p className="text-sm italic text-gray-700">“{t.quote}”</p>
                <p className="mt-4 text-sm font-semibold text-gray-900">
                  {t.name}
                </p>
                <p className="text-xs text-gray-500">{t.subject}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-xl px-4 text-center sm:px-6">
          <div className="rounded-2xl border border-green-200 bg-green-50 p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-gray-900">Free forever</h2>
            <p className="mt-2 text-sm text-gray-700">
              No credit card needed. Built for Singapore tutors.
            </p>
            <Link
              to="/login?mode=signup"
              className="mt-6 flex min-h-12 items-center justify-center rounded-md bg-green-600 px-8 text-base font-semibold text-white shadow-lg transition hover:bg-green-700 hover:shadow-xl"
            >
              Sign up free
            </Link>
          </div>
        </div>
      </section>

      <section
        style={{ backgroundColor: "#f0fdf4" }}
        className="py-16 sm:py-20"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
            Built by
          </p>
          <h2 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
            Hanyong Lim
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-600">
            IB Math Teacher · IB Examiner · DP Coordinator · 20+ Years in
            Education
          </p>
          <p className="mt-6 text-base leading-relaxed text-gray-700">
            I'm a Singapore maths tutor with 20+ years of teaching experience
            across O-Levels, A-Levels, and IB. I built ChopeAndPay because I was
            tired of tracking lesson payments in WhatsApp and Excel, and I knew
            other tutors felt the same.
          </p>
          <p className="mt-4 text-base italic leading-relaxed text-gray-600">
            I personally read every piece of feedback. This app is built for
            tutors, by a tutor.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {[
              "Applied Mathematics · NUS",
              "20+ Years in Education",
              "IB Examiner",
              "O, A-Levels & IB",
            ].map((c) => (
              <span
                key={c}
                className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800"
              >
                {c}
              </span>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://wa.me/6580448247"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center rounded-md bg-green-600 px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-green-700 hover:shadow-xl"
            >
              💬 WhatsApp Hanyong
            </a>
            <a
              href="mailto:mathstutorlimhy@gmail.com"
              className="flex min-h-11 items-center rounded-md border border-gray-300 bg-white px-5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
            >
              ✉️ Email Hanyong
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-gray-100">
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-8 text-sm text-gray-500 sm:px-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
            <span className="flex items-center gap-2 font-medium text-gray-700">
              <span aria-hidden="true">🍀</span>
              ChopeAndPay
            </span>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link to="/about" className="hover:text-gray-700">
                About
              </Link>
              <Link to="/privacy" className="hover:text-gray-700">
                Privacy Policy
              </Link>
              <Link to="/terms" className="hover:text-gray-700">
                Terms of Service
              </Link>
            </div>
          </div>
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 pt-4 text-center sm:flex-row sm:justify-between">
            <span>
              Questions?{" "}
              <a
                href="https://wa.me/6580448247"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-green-600 hover:text-green-700"
              >
                WhatsApp us
              </a>{" "}
              or email{" "}
              <a
                href="mailto:mathstutorlimhy@gmail.com"
                className="font-medium text-green-600 hover:text-green-700"
              >
                mathstutorlimhy@gmail.com
              </a>
            </span>
            <span>
              ChopeAndPay · Built by{" "}
              <Link to="/about" className="font-medium hover:text-gray-700">
                Hanyong Lim
              </Link>{" "}
              · Singapore
            </span>
          </div>
          <p className="text-center text-xs text-gray-400">
            © {new Date().getFullYear()} ChopeAndPay. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
