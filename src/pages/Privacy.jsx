import { Link } from "react-router-dom";

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-[#0f7a58]">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-gray-700">
        {children}
      </div>
    </section>
  );
}

export default function Privacy() {
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
          Privacy Policy
        </h1>
        <p className="mt-2 text-xs text-gray-400">Last updated: June 2026</p>

        <Section title="Introduction">
          <p>
            ChopeAndPay (chopeandpay.com) is operated by Hanyong Lim, a private
            individual based in Singapore. This policy explains how we collect,
            use and protect your personal data in accordance with Singapore's
            Personal Data Protection Act 2012 (PDPA).
          </p>
        </Section>

        <Section title="Data we collect">
          <p>
            <strong>Account data:</strong> name and email address collected at
            signup via Supabase Auth.
          </p>
          <p>
            <strong>Student data:</strong> student names, subjects, levels,
            hourly rates, lesson dates, lesson notes, and home addresses entered
            by the tutor.
          </p>
          <p>
            <strong>Usage data:</strong> lesson history, payment cycles, and app
            activity.
          </p>
          <p>
            <strong>Anonymous benchmarking data:</strong> anonymised hourly
            rates used to calculate subject/level averages across all tutors.
          </p>
        </Section>

        <Section title="How we use your data">
          <ul className="list-inside list-disc space-y-1">
            <li>To provide the ChopeAndPay service</li>
            <li>
              To show anonymised rate benchmarks to tutors (no individual data
              is ever shown)
            </li>
            <li>
              To send app notifications and weekly summaries (only if enabled)
            </li>
          </ul>
          <p className="font-medium text-gray-900">
            We do NOT sell your data to any third party.
          </p>
          <p className="font-medium text-gray-900">
            We do NOT use your data for advertising.
          </p>
          <p className="font-medium text-gray-900">
            The app developer does not access individual tutor data. Your
            students, rates and earnings are visible only to you.
          </p>
        </Section>

        <Section title="Developer Data Access Policy">
          <p>
            As the developer of ChopeAndPay, Hanyong Lim commits to the
            following:
          </p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              I do not access, view, browse or use any individual tutor's data,
              including student names, lesson details, hourly rates or earnings
              figures.
            </li>
            <li>
              I do not run queries against individual tutor records for any
              purpose other than technical debugging when explicitly requested
              by the affected tutor.
            </li>
            <li>
              The only data I may review is anonymous aggregate statistics such
              as total number of registered users or total lessons logged across
              the platform — never individual records.
            </li>
            <li>
              Rate benchmark features are calculated using anonymised database
              averages only. No individual tutor's rate is ever identified,
              viewed or shared.
            </li>
          </ul>
          <p>
            This is a personal project built in good faith for the Singapore
            tutor community. Your trust means everything to me.
          </p>
          <p className="font-medium text-gray-900">— Hanyong Lim, Developer</p>
        </Section>

        <Section title="Data storage">
          <p>
            All data is stored securely on Supabase (hosted on AWS
            infrastructure). Data is encrypted in transit and at rest.
          </p>
        </Section>

        <Section title="Data access">
          <p>
            Each tutor can only access their own data. Row Level Security is
            enforced at the database level.
          </p>
        </Section>

        <Section title="Student data">
          <p>
            Tutors are responsible for obtaining appropriate consent from
            students or parents before entering student personal data (names,
            addresses, contact details) into the app.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            Your data is retained as long as your account is active. You may
            request deletion of your account and all associated data by emailing{" "}
            <a
              href="mailto:mathstutorlimhy@gmail.com"
              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
            >
              mathstutorlimhy@gmail.com
            </a>
            .
          </p>
        </Section>

        <Section title="Your rights under PDPA">
          <ul className="list-inside list-disc space-y-1">
            <li>Right to access your personal data</li>
            <li>Right to correct inaccurate data</li>
            <li>Right to withdraw consent and request deletion</li>
          </ul>
          <p>
            To exercise these rights, contact{" "}
            <a
              href="mailto:mathstutorlimhy@gmail.com"
              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
            >
              mathstutorlimhy@gmail.com
            </a>
            .
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            We use minimal cookies required for authentication only. We do not
            use tracking or advertising cookies.
          </p>
        </Section>

        <Section title="Third party services">
          <p>We use the following third party services:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>
              <a
                href="https://supabase.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                Supabase
              </a>{" "}
              — database and authentication
            </li>
            <li>
              <a
                href="https://www.netlify.com/privacy/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
              >
                Netlify
              </a>{" "}
              — hosting
            </li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            For any privacy queries, contact Hanyong Lim at{" "}
            <a
              href="mailto:mathstutorlimhy@gmail.com"
              className="font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
            >
              mathstutorlimhy@gmail.com
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}
