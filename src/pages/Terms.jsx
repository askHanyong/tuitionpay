import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="min-h-screen bg-white px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          className="text-sm font-medium text-green-600 hover:text-green-700"
        >
          ← Back to TuitionPayLah
        </Link>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-gray-600">
          This is a placeholder Terms of Service page. Our full terms will be
          published here soon.
        </p>
      </div>
    </div>
  );
}
