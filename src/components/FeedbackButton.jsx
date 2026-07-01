import { useState } from "react";
import FeedbackModal from "./FeedbackModal";

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 flex h-10 items-center gap-1.5 rounded-full bg-[#1b2d4f] px-4 text-sm font-medium text-white shadow-lg transition hover:bg-[#15243f] hover:shadow-xl lg:bottom-6"
      >
        💬 Feedback
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}
