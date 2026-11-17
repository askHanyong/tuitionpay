import { useEffect } from "react";

const COLORS = ["#5ecfaa", "#1b2d4f", "#f3c98b", "#9fb0cc"];
const PIECES = 26;

const prefersReducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

// 26 falling rectangles, pure CSS, no packages. Shown once right after a month is
// closed, removed after 3 s (onDone), and skipped for reduced-motion users.
export default function Confetti({ onDone }) {
  const reduced = prefersReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => onDone?.(), 3000);
    return () => clearTimeout(timer);
  }, [onDone]);

  if (reduced) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`
        @keyframes cnp-confetti-fall {
          0% { transform: translateY(-12vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(108vh) rotate(var(--r)); opacity: 0.9; }
        }
        @keyframes cnp-pop {
          0% { transform: scale(0.92); opacity: 0; }
          60% { transform: scale(1.03); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .cnp-pop { animation: cnp-pop 0.45s ease-out both; }
      `}</style>
      {Array.from({ length: PIECES }, (_, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: 0,
            left: `${(i * 37 + 5) % 100}%`,
            width: 6 + (i % 3) * 2,
            height: 10 + (i % 4) * 2,
            background: COLORS[i % COLORS.length],
            borderRadius: 1,
            "--r": `${(i % 2 ? 1 : -1) * (360 + i * 23)}deg`,
            animation: `cnp-confetti-fall ${2.2 + (i % 5) * 0.18}s ease-in ${(i % 7) * 0.12}s forwards`,
          }}
        />
      ))}
    </div>
  );
}
