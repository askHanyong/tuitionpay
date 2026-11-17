import { useEffect, useId, useRef, useState } from "react";

// Small "i" button. Mouse: hover shows the tip, click pins it. Touch: tap
// toggles. Esc, tapping elsewhere, scrolling or resizing closes it. The tip is
// position:fixed and clamped to the viewport so it never runs off a phone screen.
export default function InfoTip({ text, label = "More info" }) {
  const id = useId();
  const btnRef = useRef(null);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState(null);
  const open = hover || pinned;

  const place = () => {
    const r = btnRef.current.getBoundingClientRect();
    const width = Math.min(256, window.innerWidth - 16);
    const left = Math.min(
      Math.max(r.left + r.width / 2 - width / 2, 8),
      window.innerWidth - width - 8,
    );
    setPos({ left, top: r.bottom + 6, width });
  };

  const close = () => {
    setHover(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!btnRef.current?.contains(e.target)) close();
    };
    const onKey = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <span className="inline-block align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          place();
          setHover(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHover(false);
        }}
        onClick={() => {
          if (!pinned) place();
          setPinned((p) => !p);
        }}
        className="relative ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-gray-400 text-[10px] font-semibold leading-none text-gray-500 hover:bg-white hover:text-gray-700 after:absolute after:-inset-3 after:content-['']"
      >
        i
      </button>
      {open && pos && (
        <span
          role="tooltip"
          id={id}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
          className="z-50 rounded-lg bg-gray-900 px-3 py-2 text-left text-xs font-normal leading-snug text-white shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
