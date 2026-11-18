import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { initials } from "../lib/parentPortal";
import PayTab from "../components/portal/PayTab";

// Parent page behind one private link (spec: parent-portal 4.1). Reads only through
// the get_parent_portal RPC; this file makes no direct table queries.
export default function ParentPortal() {
  const { token } = useParams();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState({ status: "loading", data: null });
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // Fetch outside React state so the first load needs no setState in an effect.
  const fetchPortal = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_parent_portal", { p_token: token });
      if (error) throw error;
      return data ? { status: "ready", data } : { status: "notfound", data: null };
    } catch {
      return { status: "error", data: null };
    }
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    fetchPortal().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPortal]);

  // "Try again" (and, later, reload after an action).
  const load = useCallback(async () => {
    setState((s) => ({ status: s.data ? s.status : "loading", data: s.data }));
    setState(await fetchPortal());
  }, [fetchPortal]);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const data = state.data;
  const studentName = data?.student?.name;

  useEffect(() => {
    if (studentName) document.title = `${studentName}'s lessons · ChopeAndPay`;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex";
    const referrer = document.createElement("meta");
    referrer.name = "referrer";
    referrer.content = "no-referrer";
    document.head.append(robots, referrer);
    return () => {
      robots.remove();
      referrer.remove();
    };
  }, [studentName]);

  const shell = (children) => (
    <div className="min-h-screen bg-[#f2f6f4] text-[#1b2d4f]">
      <div className="mx-auto max-w-md pb-10">{children}</div>
    </div>
  );

  if (state.status === "loading") {
    return shell(
      <div role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <div className="rounded-b-[24px] bg-[#1b2d4f] p-5">
          <div className="h-12 w-12 animate-pulse rounded-full bg-white/20" />
          <div className="mt-3 h-6 w-2/3 animate-pulse rounded bg-white/20" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-white/20" />
        </div>
        <div className="mx-4 mt-4 h-48 animate-pulse rounded-[20px] bg-white" />
      </div>,
    );
  }

  if (state.status === "notfound") {
    return shell(
      <div className="px-4 pt-16">
        <div className="rounded-[20px] bg-white p-6 text-center shadow-[0_2px_12px_rgba(27,45,79,0.07)]">
          <p className="text-4xl" aria-hidden="true">🔒</p>
          <p className="mt-3 text-base">This link isn't active any more. Please ask your tutor for a new one.</p>
        </div>
      </div>,
    );
  }

  if (state.status === "error") {
    return shell(
      <div className="px-4 pt-16">
        <div className="rounded-[20px] bg-white p-6 text-center shadow-[0_2px_12px_rgba(27,45,79,0.07)]">
          <p className="text-base">We couldn't load this page just now. Please check your connection and try again.</p>
          <button type="button" onClick={load} className="mt-4 min-h-12 rounded-[14px] bg-[#5ecfaa] px-6 font-bold text-[#1b2d4f]">
            Try again
          </button>
        </div>
      </div>,
    );
  }

  const tutorName = data.tutor_name || "your tutor";
  const pay = data.pay;
  const tabs = [
    ...(pay.mode !== "hidden" ? [{ key: "pay", label: "Pay" }] : []),
    { key: "book", label: "Book" },
  ];
  const requested = params.get("tab");
  const active = tabs.some((t) => t.key === requested) ? requested : tabs[0].key;
  const selectTab = (key) => {
    const next = new URLSearchParams(params);
    next.set("tab", key);
    setParams(next, { replace: true });
  };

  return shell(
    <>
      <header className="rounded-b-[24px] bg-[#1b2d4f] px-5 pb-5 pt-6 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#5ecfaa] text-lg font-bold text-[#1b2d4f]" aria-hidden="true">
            {initials(data.student.name)}
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{data.student.name}'s lessons</h1>
            <p className="text-sm text-white/80">
              {data.subject ? `${data.subject} with ${tutorName}` : `with ${tutorName}`}
            </p>
          </div>
        </div>
        {tabs.length > 1 && (
          <div className="mt-4 flex gap-2" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active === t.key}
                onClick={() => selectTab(t.key)}
                className={`min-h-11 flex-1 rounded-[14px] text-sm font-bold ${
                  active === t.key ? "bg-white text-[#1b2d4f]" : "bg-white/10 text-white"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {data.student.is_practice && (
        <p className="bg-[#fdf0dc] px-5 py-3 text-sm font-semibold text-[#8a4b08]">
          Practice link. This is test data, not a real bill. Please don't pay.
        </p>
      )}

      <main className="mt-4 px-4">
        {active === "pay" && (
          <PayTab
            pay={pay}
            guardianName={data.guardian_name}
            tutorName={tutorName}
            studentName={data.student.name}
            onToast={showToast}
          />
        )}
        {active === "book" && (
          <section className="rounded-[20px] bg-white p-5 text-base shadow-[0_2px_12px_rgba(27,45,79,0.07)]">
            Booking is coming to this page soon.
          </section>
        )}
      </main>

      <footer className="mt-8 text-center text-xs text-[#56627a]">Powered by ChopeAndPay</footer>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90%] rounded-full bg-[#1b2d4f] px-5 py-3 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </>,
  );
}
