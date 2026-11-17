export default function PracticeBadge({ className = "" }) {
  return (
    <span
      title="Practice student: test data, not counted in your money figures"
      className={`inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 ${className}`}
    >
      Practice
    </span>
  );
}
