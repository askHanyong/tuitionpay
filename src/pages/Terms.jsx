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

export default function Terms() {
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
          Terms of Service
        </h1>
        <p className="mt-2 text-xs text-gray-400">Last updated: June 2026</p>

        <Section title="Introduction">
          <p>
            By using ChopeAndPay (chopeandpay.com), you agree to these terms.
            ChopeAndPay is a free web application operated by Hanyong Lim
            (Singapore).
          </p>
        </Section>

        <Section title="Eligibility">
          <p>
            You must be 18 or older to use ChopeAndPay. The app is intended for
            private tutors/practitioners and education freelancers.
          </p>
        </Section>

        <Section title="Your account">
          <ul className="list-inside list-disc space-y-1">
            <li>
              You are responsible for maintaining the security of your account
              credentials
            </li>
            <li>You must provide accurate information when signing up</li>
            <li>One account per tutor/practitioner</li>
          </ul>
        </Section>

        <Section title="Acceptable use">
          <p>You may use ChopeAndPay to:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Track your own tutoring lessons and payments</li>
            <li>Manage your own student/client information</li>
            <li>Generate reports for your own use</li>
          </ul>
          <p>You may NOT use ChopeAndPay to:</p>
          <ul className="list-inside list-disc space-y-1">
            <li>Enter false or misleading information</li>
            <li>Attempt to access other tutors'/practitioners' data</li>
            <li>Use the app for any unlawful purpose</li>
            <li>Resell or commercialise the app or its data</li>
          </ul>
        </Section>

        <Section title="Student/Client data responsibility">
          <p>
            Tutors/Practitioners are solely responsible for ensuring they have appropriate
            consent to store student/client personal data in the app. ChopeAndPay is a
            tool — the tutor/practitioner is the data controller for their students'/clients'
            information under PDPA.
          </p>
        </Section>

        <Section title="Free service">
          <p>
            ChopeAndPay is currently free. We reserve the right to introduce
            paid features in the future with reasonable notice. Core features
            will remain free.
          </p>
        </Section>

        <Section title="No financial advice">
          <p>
            ChopeAndPay provides earnings tracking tools only. It does not
            constitute financial, tax or legal advice.
          </p>
        </Section>

        <Section title="Disclaimer of warranties">
          <p>
            ChopeAndPay is provided "as is". We do not guarantee uninterrupted
            or error-free service. We are not liable for any loss of data or
            income arising from use of the app.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the maximum extent permitted by Singapore law, Hanyong Lim shall
            not be liable for any indirect, incidental or consequential damages
            arising from use of ChopeAndPay.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of Singapore. Any disputes
            shall be subject to the exclusive jurisdiction of the Singapore
            courts.
          </p>
        </Section>

        <Section title="Changes to terms">
          <p>
            We may update these terms from time to time. Continued use of the
            app after changes constitutes acceptance of the new terms.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about these terms? Contact{" "}
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
