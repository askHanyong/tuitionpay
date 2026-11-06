import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  MessageCircle,
  Grid3x3,
  ListChecks,
  CalendarCheck,
  Wallet,
  MessageSquare,
  TrendingUp,
  ShieldCheck,
  User,
  Lock,
  AlertCircle,
  Link2,
  Building2,
    Check,
} from "lucide-react";

const PROBLEMS = [
  { Icon: MessageCircle, text: "Chasing payments over WhatsApp" },
  { Icon: Grid3x3,       text: "Tracking lessons in Excel spreadsheets" },
  { Icon: ListChecks,    text: "Forgetting which students haven't paid you" },
];

const FEATURES = [
  {
    Icon: CalendarCheck,
    title: "Schedule recurring lessons",
    description:
      "Set a weekly slot once. Hourly or flat per-session rates, synced to Google Calendar if you like.",
  },
  {
    Icon: Wallet,
    title: "Know who owes you",
    description:
      "Payment cycles your way: every few lessons, end of month, or a fixed date. Overdue payments are flagged automatically.",
  },
  {
    Icon: MessageSquare,
    title: "WhatsApp reminders in one tap",
    description:
      "A pre-filled message with lesson dates and the amount due opens straight in the parent's chat.",
  },
  {
    Icon: Link2,
    title: "Parent booking and payment links",
    description:
      "Share a private link so parents can request an open slot or see what's due, with your PayNow number on it.",
  },
  {
    Icon: Building2,
    title: "Agency statements",
    description:
      "Students through an agency? Build the monthly claim with your share, expenses and placement fees, then download it as Excel.",
  },
  {
    Icon: TrendingUp,
    title: "Monthly recap",
    description:
      "Collected, pending and projected earnings at a glance, including your take-home after agencies.",
  },
];

const TRUST_POINTS = [
  {
    Icon: User,
    title: "Only you can see your data",
    description:
      "Other tutors can never see your students, rates or earnings — enforced at the database level. As the developer, I have access for support and bug fixes, but I don't view individual accounts without reason.",
  },
  {
    Icon: Lock,
    title: "Bank-level encryption",
    description:
      "All data is encrypted in transit and at rest on Supabase (AWS infrastructure).",
  },
];

function PhoneMockup() {
  return (
    <div className="hidden flex-none lg:block">
      <div className="w-72 rounded-[2.5rem] border-8 border-gray-900 bg-gray-900 p-2 shadow-2xl">
        <div className="overflow-hidden rounded-[2rem] bg-gray-50">
          <div className="flex items-center gap-1.5 bg-white px-4 py-3">
            <span className="inline-flex rounded-md bg-[#edf6f3] p-1">
              <svg className="h-3 w-3 text-[#1b2d4f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </span>
            <p className="text-xs font-semibold text-gray-900">ChopeAndPay</p>
          </div>
          <div className="space-y-3 p-4">
            <div className="rounded-lg bg-[#edf6f3] p-3">
              <p className="text-[10px] font-medium text-gray-500">
                Today's lesson
              </p>
              <p className="mt-1 text-xs font-semibold text-gray-900">
                Marcus · 4:00pm
              </p>
            </div>
            <div className="rounded-lg border border-gray-100 bg-white p-3">
              <p className="text-[10px] font-medium text-gray-500">
                This month
              </p>
              <p className="mt-1 text-sm font-bold text-[#0f7a58]">
                $3,150 collected
              </p>
            </div>
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <div className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3 text-red-600" aria-hidden="true" />
                <p className="text-[10px] font-medium text-red-700">Payment due</p>
              </div>
              <p className="mt-1 text-xs text-red-800">
                Chloe — $360, 3 lessons completed
              </p>
            </div>
            <div className="space-y-2">
              {[
                { name: "Marcus", width: "w-3/4" },
                { name: "Chloe",  width: "w-1/2" },
                { name: "Reuben", width: "w-1/4" },
              ].map(({ name, width }) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 shadow-sm"
                >
                  <span className="text-xs font-medium text-gray-800">
                    {name}
                  </span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100">
                    <span className={`block h-full ${width} rounded-full bg-[#5ecfaa]`} />
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
      <header className="bg-[#1b2d4f]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <span aria-hidden="true">🍀</span>
            ChopeAndPay
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <a
              href="#pricing"
              className="hidden min-h-11 rounded-md px-3 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white sm:flex items-center"
            >
              Pricing
            </a>
            <Link
              to="/about"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white flex items-center"
            >
              About
            </Link>
            <Link
              to="/faq"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white flex items-center"
            >
              FAQ
            </Link>
            <Link
              to="/login"
              className="min-h-11 rounded-md px-3 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white flex items-center"
            >
              Log in
            </Link>
            <Link
              to="/login?mode=signup"
              className="flex min-h-11 items-center rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
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
              Chope your slots. Track every session. Get paid on time.
            </p>
            <p className="mt-3 text-base text-gray-600">
              Built for Singapore tutors and session-based freelancers: lessons,
              parent bookings, payment tracking and WhatsApp reminders in one
              simple app.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row lg:justify-start justify-center">
              <Link
                to="/login?mode=signup"
                className="flex min-h-12 items-center rounded-md bg-[#1b2d4f] px-8 text-base font-semibold text-white shadow-lg transition hover:bg-[#15243f] hover:shadow-xl"
              >
                Sign up free
              </Link>
              <a
                href="#features"
                className="flex min-h-12 items-center rounded-md px-4 text-base font-medium text-[#1b2d4f] hover:underline"
              >
                See what's inside
              </a>
            </div>
            <p className="mt-3 text-sm text-gray-500 text-center lg:text-left">
              Free for up to 3 students · No credit card needed · Works on any
              phone
            </p>
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
                <span className="inline-flex rounded-xl bg-[#edf6f3] p-2.5">
                  <p.Icon className="h-6 w-6 text-[#1b2d4f]" aria-hidden="true" />
                </span>
                <p className="mt-4 text-sm font-medium text-gray-800">
                  {p.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
            Everything you need, built in
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <span className="inline-flex rounded-xl bg-[#edf6f3] p-2.5">
                  <f.Icon className="h-6 w-6 text-[#1b2d4f]" aria-hidden="true" />
                </span>
                <h3 className="mt-3 text-sm font-semibold text-gray-900">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
            Simple pricing
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Start free. Upgrade only when you have more than 3 students.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="rounded-2xl border border-[#b8e8d9] bg-[#edf6f3] p-8 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900">Free</h3>
              <p className="mt-1 text-3xl font-bold text-gray-900">
                SGD 0
              </p>
              <p className="text-sm text-gray-600">No credit card needed</p>
              <ul className="mt-5 space-y-2 text-sm text-gray-700">
                {["Up to 3 students", "Lessons, payments and reminders", "Parent booking and payment links"].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-[#0f7a58]" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
              <Link
                to="/login?mode=signup"
                className="mt-6 flex min-h-12 items-center justify-center rounded-md bg-[#1b2d4f] px-8 text-base font-semibold text-white shadow-lg transition hover:bg-[#15243f] hover:shadow-xl"
              >
                Sign up free
              </Link>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-gray-900">Unlimited</h3>
              <p className="mt-1 text-3xl font-bold text-gray-900">
                SGD 9.99
                <span className="text-base font-medium text-gray-500"> / month</span>
              </p>
              <p className="text-sm text-gray-600">
                or SGD 59.99 / year (save about 50%)
              </p>
              <ul className="mt-5 space-y-2 text-sm text-gray-700">
                {["Unlimited students", "Everything in Free", "Cancel anytime"].map((t) => (
                  <li key={t} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-[#0f7a58]" aria-hidden="true" />
                    {t}
                  </li>
                ))}
              </ul>
              <Link
                to="/login?mode=signup"
                className="mt-6 flex min-h-12 items-center justify-center rounded-md border border-[#1b2d4f] px-8 text-base font-semibold text-[#1b2d4f] transition hover:bg-gray-50"
              >
                Start free, upgrade anytime
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="flex items-center justify-center gap-3 text-2xl font-bold text-gray-900 sm:text-3xl">
            <span className="inline-flex rounded-xl bg-[#edf6f3] p-2.5">
              <ShieldCheck className="h-6 w-6 text-[#1b2d4f]" aria-hidden="true" />
            </span>
            Your data is private
          </h2>
          <div className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2">
            {TRUST_POINTS.map((t) => (
              <div
                key={t.title}
                className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"
              >
                <span className="inline-flex rounded-xl bg-[#edf6f3] p-2.5">
                  <t.Icon className="h-6 w-6 text-[#1b2d4f]" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm font-semibold text-gray-900">{t.title}</p>
                <p className="mt-2 text-sm text-gray-600">{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        style={{ backgroundColor: "#edf6f3" }}
        className="py-16 sm:py-20"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0f7a58]">
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
                className="rounded-full bg-[#d6ede6] px-3 py-1 text-xs font-medium text-[#1b2d4f]"
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
              className="flex min-h-11 items-center rounded-md bg-[#1b2d4f] px-5 text-sm font-semibold text-white shadow-lg transition hover:bg-[#15243f] hover:shadow-xl"
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
              <Link to="/faq" className="hover:text-gray-700">
                FAQ
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
                className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                WhatsApp us
              </a>{" "}
              or email{" "}
              <a
                href="mailto:mathstutorlimhy@gmail.com"
                className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
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
