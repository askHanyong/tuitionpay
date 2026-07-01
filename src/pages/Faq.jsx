import { useState } from "react";
import { Link } from "react-router-dom";

const SECTIONS = [
  {
    title: "About the app",
    items: [
      {
        q: "Is ChopeAndPay really free?",
        a: "Yes, completely free. No credit card needed, no hidden charges. Core features will always remain free.",
      },
      {
        q: "Who built this app?",
        a: "Hanyong Lim, a Singapore maths tutor with 20+ years of teaching experience. Built as a personal project to solve his own payment tracking frustrations.",
      },
      {
        q: "Is this only for maths tutors?",
        a: "No — it works for any subject and any level. English, Science, Chinese, Music, or any other subject. Also works for therapists and other freelancers who teach by the session.",
      },
      {
        q: "Do my students need to sign up too?",
        a: "No. Only the tutor signs up. Students and parents don't need an account — the app is purely for tutors to manage their own schedules and payments.",
      },
    ],
  },
  {
    title: "Privacy & security",
    items: [
      {
        q: "Is my students' data safe?",
        a: "Yes. All data is encrypted and stored securely on Supabase (AWS infrastructure). Only you can see your own students — no other tutor can access your data.",
      },
      {
        q: "Will you sell my data?",
        a: "Never. Your data is yours.",
      },
      {
        q: "Is this compliant with Singapore's PDPA?",
        a: (
          <>
            Yes. ChopeAndPay has a PDPA-compliant Privacy Policy. You can read
            it at{" "}
            <Link
              to="/privacy"
              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
            >
              chopeandpay.com/privacy
            </Link>
            .
          </>
        ),
      },
      {
        q: "Can the developer see my students' names and how much I earn?",
        a: "No. The developer has committed not to access, view or use any individual tutor data — including student names, hourly rates or earnings. Only anonymous aggregate statistics (like total number of app users) are ever reviewed. Your data is yours alone.",
      },
      {
        q: "How do the rate benchmarks work — can you see what I charge?",
        a: "No. Rate benchmarks are calculated using anonymous database averages across all tutors teaching the same subject and level. The system only ever sees the average, minimum and maximum — never which tutor charges what. Your individual rate is completely private.",
      },
    ],
  },
  {
    title: "Using the app",
    items: [
      {
        q: "Does it work on iPhone and Android?",
        a: "Yes. Works on any phone browser. You can also install it on your home screen like a native app — it's a Progressive Web App (PWA).",
      },
      {
        q: "Does it only work for pay-after-4-lessons?",
        a: "No. You can customise the payment cycle for each student — every X lessons, end of month, after each lesson, or on a specific date each month.",
      },
      {
        q: "Can I send payment reminders to parents and students?",
        a: "Yes. The app generates a pre-filled WhatsApp message with the student's lesson dates and amount due. One tap to send — no typing needed.",
      },
      {
        q: "Can I track multiple students?",
        a: "Yes, as many students as you need. Each student has their own profile, lesson history, payment cycles and progress tracking.",
      },
      {
        q: "Do I need to download anything?",
        a: "No download needed. Just open chopeandpay.com in your phone browser and sign up. Takes less than a minute.",
      },
    ],
  },
  {
    title: "Technical",
    items: [
      {
        q: "What happens to my data if the app shuts down?",
        a: "You can export all your lesson and payment data as a CSV at any time from the Settings page. Your data is always accessible and portable.",
      },
    ],
  },
];

function AccordionItem({ q, a, isOpen, onToggle }) {
  return (
    <div className="border-b border-gray-100">
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex min-h-14 w-full items-center justify-between gap-4 py-4 text-left text-sm font-medium text-gray-900"
      >
        {q}
        <svg
          className={
            isOpen
              ? "h-5 w-5 flex-none rotate-180 text-[#5ecfaa] transition-transform"
              : "h-5 w-5 flex-none text-gray-400 transition-transform"
          }
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <p className="pb-4 text-sm leading-relaxed text-gray-600">{a}</p>
      )}
    </div>
  );
}

export default function Faq() {
  const [openKey, setOpenKey] = useState(null);

  return (
    <div className="min-h-screen bg-white px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
        >
          ← Back to Home
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">
          Frequently Asked Questions
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Everything you need to know about ChopeAndPay.
        </p>

        <div className="mt-8 space-y-10">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h2 className="text-lg font-semibold text-[#0f7a58]">
                {section.title}
              </h2>
              <div className="mt-2">
                {section.items.map((item) => {
                  const key = `${section.title}__${item.q}`;
                  return (
                    <AccordionItem
                      key={key}
                      q={item.q}
                      a={item.a}
                      isOpen={openKey === key}
                      onToggle={() =>
                        setOpenKey((current) => (current === key ? null : key))
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
