import { useMemo, useState } from "react";
import { formatSGD } from "../../lib/paymentNotice";
import { buildPayNowPayload, displayPayNowNumber, drawPayNowQrDataUrl } from "../../lib/paynowQr";
import { copyText, fmtDay, fmtMonth, fmtTime12, moneyShort, splitUnpaid } from "../../lib/parentPortal";

const card = "rounded-[20px] bg-white p-5 shadow-[0_2px_12px_rgba(27,45,79,0.07)]";
const muted = "text-[#56627a]";

function Tick() {
  return (
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5ecfaa] text-2xl font-bold text-[#1b2d4f]" aria-hidden="true">
      ✓
    </span>
  );
}

function CopyRow({ label, value, onToast }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onToast(`${label} copied`);
    } else {
      onToast("Press and hold the text to copy it");
    }
  };
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-t border-gray-100 py-2">
      <div className="min-w-0">
        <p className={`text-xs ${muted}`}>{label}</p>
        <p className="break-all text-base font-semibold text-[#1b2d4f] [user-select:all]">{value}</p>
      </div>
      <button type="button" onClick={copy} className="min-h-11 flex-none rounded-xl border border-[#5ecfaa] px-4 text-sm font-semibold text-[#0b6e4f]">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// Notices whose lesson amounts don't add up to the notice amount show only a total.
const lessonsAddUp = (n) =>
  n.lessons.length > 0 && Math.abs(n.lessons.reduce((s, l) => s + Number(l.amount ?? 0), 0) - Number(n.amount ?? 0)) < 0.011;

function Hero({ guardianName, unpaid, total, paymentMode }) {
  const prefix = guardianName ? `Hello ${guardianName}. ` : "";
  let line;
  let chip = null;
  if (unpaid.length > 1) {
    line = `${unpaid.length} payment notices are outstanding. Together they come to`;
  } else {
    const n = unpaid[0];
    if (paymentMode === "monthly" || paymentMode === "custom_date") {
      line = `${fmtMonth(n.period_start)}'s lessons come to`;
      chip = `Due ${fmtDay(n.period_end)}`;
    } else if (n.period_start === n.period_end) {
      line = `The lesson on ${fmtDay(n.period_end)} comes to`;
    } else {
      line = `Lessons from ${fmtDay(n.period_start)} to ${fmtDay(n.period_end)} come to`;
    }
  }
  return (
    <section className={card}>
      <p className={`text-base ${muted}`}>{prefix}{line}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <p className="text-[52px] font-bold leading-tight text-[#1b2d4f]">{moneyShort(total)}</p>
        {chip && <span className="rounded-full bg-[#fdf0dc] px-3 py-1 text-sm font-semibold text-[#8a4b08]">{chip}</span>}
      </div>
    </section>
  );
}

function PayNowCard({ pay, tutorName, total, onToast }) {
  const proxy = pay.paynow_proxy;
  const amountText = Number(total).toFixed(2);
  const payload = useMemo(
    () => (proxy ? buildPayNowPayload({ proxy, amount: total, reference: pay.reference }) : null),
    [proxy, total, pay.reference],
  );
  const qr = useMemo(() => (payload ? drawPayNowQrDataUrl(payload) : null), [payload]);
  const saveQr = () => {
    const a = document.createElement("a");
    a.href = qr;
    a.download = `paynow-${pay.reference || "qr"}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const rows = (
    <>
      {proxy && <CopyRow label="PayNow to" value={displayPayNowNumber(proxy)} onToast={onToast} />}
      <CopyRow label="Amount" value={amountText} onToast={onToast} />
      {pay.reference && <CopyRow label="Reference" value={pay.reference} onToast={onToast} />}
    </>
  );

  if (!proxy) {
    return (
      <section className={card}>
        <p className="text-base text-[#1b2d4f]">Please pay {tutorName} the usual way (PayNow or bank transfer).</p>
        <div className="mt-2">{rows}</div>
      </section>
    );
  }
  return (
    <section className={card}>
      {qr ? (
        <>
          <h2 className="text-center text-base font-bold text-[#1b2d4f]">Scan with your banking app to pay by PayNow</h2>
          <img
            src={qr}
            alt={`PayNow QR code for ${formatSGD(Number(total))}`}
            width={232}
            height={232}
            className="mx-auto mt-3 block h-[232px] w-[232px] max-w-full rounded-lg border-2 border-[#1b2d4f]"
          />
          <p className={`mt-2 text-center text-sm ${muted}`}>The amount and reference are filled in for you.</p>
          <button type="button" onClick={saveQr} className="mt-3 min-h-12 w-full rounded-[14px] border-2 border-[#1b2d4f] font-semibold text-[#1b2d4f]">
            Save QR to photos
          </button>
          <p className={`mt-2 text-xs ${muted}`}>
            On this phone? Save the QR, then open your banking app → Scan &amp; Pay → choose it from your photos. Or copy the details below.
          </p>
        </>
      ) : (
        <p className="text-base text-[#1b2d4f]">Pay by PayNow to the number below.</p>
      )}
      <div className="mt-3">{rows}</div>
    </section>
  );
}

function Covers({ notices }) {
  const lessons = notices.flatMap((n) => n.lessons);
  const total = notices.reduce((s, n) => s + Number(n.amount ?? 0), 0);
  const several = notices.length > 1;
  return (
    <section className={card}>
      <h2 className="text-base font-bold text-[#1b2d4f]">What this covers</h2>
      <div className="mt-2">
        {notices.map((n, i) => {
          const showAmounts = lessonsAddUp(n);
          return (
            <div key={`${n.period_start}-${n.period_end}-${i}`}>
              {several && (
                <p className={`mt-3 text-xs font-semibold ${muted}`}>
                  {fmtDay(n.period_start)} – {fmtDay(n.period_end)} · {formatSGD(Number(n.amount))}
                </p>
              )}
              {showAmounts ? (
                n.lessons.map((l, j) => (
                  <div key={j} className="flex items-start justify-between gap-3 border-t border-gray-100 py-2">
                    <div>
                      <p className="text-sm text-[#1b2d4f]">{fmtDay(l.date)}{l.time ? `, ${fmtTime12(l.time)}` : ""}</p>
                      {l.subject && <p className={`text-xs ${muted}`}>{l.subject}</p>}
                    </div>
                    <p className="text-sm font-semibold text-[#1b2d4f]">{formatSGD(Number(l.amount))}</p>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 py-2 text-sm">
                  <span className="text-[#1b2d4f]">{n.lessons.length} {n.lessons.length === 1 ? "lesson" : "lessons"}</span>
                  <span className="font-semibold text-[#1b2d4f]">{formatSGD(Number(n.amount))}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t-2 border-[#1b2d4f] pt-2 text-sm font-bold text-[#1b2d4f]">
        <span>{lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}</span>
        <span>{formatSGD(total)}</span>
      </div>
    </section>
  );
}

function Receipts({ history }) {
  if (!history?.length) return null;
  return (
    <section className={card}>
      <h2 className="text-base font-bold text-[#1b2d4f]">Recent payments</h2>
      {history.map((h, i) => (
        <div key={i} className="flex items-start justify-between gap-3 border-t border-gray-100 py-2 first:mt-2">
          <div>
            <p className="text-sm text-[#1b2d4f]">{fmtDay(h.period_start)} – {fmtDay(h.period_end)}</p>
            {h.paid_on && <p className={`text-xs ${muted}`}>Paid {fmtDay(h.paid_on)}</p>}
          </div>
          <p className="text-sm font-semibold text-[#1b2d4f]">{formatSGD(Number(h.amount))}</p>
        </div>
      ))}
    </section>
  );
}

function NoteMode({ pay, studentName, tutorName }) {
  const text =
    pay.note ||
    (pay.collected_by
      ? `Fees for ${studentName}'s lessons are collected by ${pay.collected_by}. Please pay them the usual way.`
      : `Fees for ${studentName}'s lessons aren't paid through this page. Please check with ${tutorName}.`);
  const lessons = pay.unpaid.flatMap((n) => n.lessons);
  return (
    <>
      <section className={card}>
        <h2 className="text-base font-bold text-[#1b2d4f]">How to pay</h2>
        <p className="mt-2 whitespace-pre-line text-base text-[#1b2d4f]">{text}</p>
      </section>
      {lessons.length > 0 && (
        <section className={card}>
          <h2 className="text-base font-bold text-[#1b2d4f]">Lessons in this period</h2>
          {lessons.map((l, i) => (
            <div key={i} className="border-t border-gray-100 py-2 first:mt-2">
              <p className="text-sm text-[#1b2d4f]">{fmtDay(l.date)}{l.time ? `, ${fmtTime12(l.time)}` : ""}</p>
              {l.subject && <p className={`text-xs ${muted}`}>{l.subject}</p>}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

// Pay tab. Read-only in this phase: no "I've paid" button (phase 3).
export default function PayTab({ pay, guardianName, tutorName, studentName, onToast }) {
  if (pay.mode === "note") return <NoteMode pay={pay} studentName={studentName} tutorName={tutorName} />;

  const { fresh, freshTotal } = splitUnpaid(pay);
  const hasClaim = Boolean(pay.claim);
  // Until the "I've paid" state exists, an open claim only gets a short notice;
  // the notices it does not cover are shown as usual.
  const shown = hasClaim ? fresh : pay.unpaid;
  const shownTotal = hasClaim ? freshTotal : pay.unpaid.reduce((s, n) => s + Number(n.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      {hasClaim && (
        <section className={`${card} flex items-start gap-3`}>
          <Tick />
          <p className="text-base text-[#1b2d4f]">
            Thank you{guardianName ? `, ${guardianName}` : ""}. {tutorName} has been told and will confirm once the payment has arrived.
          </p>
        </section>
      )}
      {shown.length > 0 ? (
        <>
          <Hero guardianName={hasClaim ? null : guardianName} unpaid={shown} total={shownTotal} paymentMode={pay.payment_mode} />
          <PayNowCard pay={pay} tutorName={tutorName} total={shownTotal} onToast={onToast} />
          <Covers notices={shown} />
        </>
      ) : (
        !hasClaim && (
          <section className={`${card} flex items-center gap-3`}>
            <Tick />
            <div>
              <h2 className="text-lg font-bold text-[#1b2d4f]">All paid up. Thank you!</h2>
              <p className={`text-sm ${muted}`}>Nothing is due right now.</p>
            </div>
          </section>
        )
      )}
      <Receipts history={pay.history} />
    </div>
  );
}
