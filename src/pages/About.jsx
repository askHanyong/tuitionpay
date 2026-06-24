import { Link } from "react-router-dom";

const CREDENTIALS = [
  "Applied Mathematics · NUS",
  "20+ Years in Education",
  "IB Examiner",
  "O, A-Levels & IB",
  "Former DP Coordinator",
  "HL & SL Specialist",
];

export default function About() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-100">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <span aria-hidden="true">🍀</span>
            TuitionPayLah
          </Link>
          <Link
            to="/"
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            ← Back home
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-wide text-green-700">
          Built by
        </p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">
          Hanyong Lim
        </h1>
        <p className="mt-2 text-sm font-medium text-gray-600">
          IB, O-level, A-level and IP Math Teacher · IB Examiner · DP
          Coordinator · Applied Mathematics
        </p>

        <div className="mt-8 flex h-32 w-32 items-center justify-center rounded-full bg-gray-100 text-center text-xs font-medium text-gray-400">
          Photo coming soon
        </div>

        <div className="mt-8 space-y-4 text-base leading-relaxed text-gray-700">
          <p>
            I grew up passionate about Mathematics and went on to study Applied
            Mathematics at the National University of Singapore, then spent the
            next 20+ years teaching Mathematics across O-Levels, A-Levels, and
            IB in Singapore schools.
          </p>
          <p>
            As an active private tutor myself, I felt the pain of tracking
            lesson payments and schedules manually, often juggling WhatsApp
            messages, Excel sheets, Google calendar, and mental notes.
            TuitionPayLah was born out of that frustration. I wanted a simple,
            free tool built specifically for how Singapore private tutors work.
          </p>
          <p>
            I personally read every piece of feedback and respond to every
            message. If you have a suggestion, a bug report, or just want to say
            hi - please reach out!
          </p>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {CREDENTIALS.map((c) => (
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
            💬 WhatsApp me
          </a>
          <a
            href="mailto:mathstutorlimhy@gmail.com"
            className="flex min-h-11 items-center rounded-md border border-gray-300 px-5 text-sm font-semibold text-gray-700 transition hover:bg-gray-100"
          >
            ✉️ Email me
          </a>
        </div>
      </section>

      <footer className="border-t border-gray-100">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-8 text-sm text-gray-500 sm:flex-row sm:justify-between sm:px-6">
          <span className="flex items-center gap-2 font-medium text-gray-700">
            <span aria-hidden="true">🍀</span>
            TuitionPayLah
          </span>
          <span>
            © {new Date().getFullYear()} TuitionPayLah. All rights reserved.
          </span>
        </div>
      </footer>
    </div>
  );
}
