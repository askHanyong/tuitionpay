import { useState } from "react";
import { Link } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { formatSGD } from "../lib/paymentNotice";
import { formatDate } from "../utils/dateFormat";
import { buildPaymentSummaryUrl, buildWhatsAppLink, normalizeWhatsAppNumber } from "../lib/whatsapp";
import {
  DEFAULT_TEMPLATES,
  STAGES,
  STAGE_LABELS,
  buildCombinedPeriod,
  computeReminderStage,
  distinctDayKeys,
  dayDiff,
  mostAdvancedStage,
  remindersForNotice,
  renderTemplate,
} from "../lib/reminders";

// Editable WhatsApp reminder draft (tutors only). Nothing is sent automatically:
// the tutor presses Send, which opens WhatsApp with the text filled in.
//  - openNotices: every unpaid notice of this student ([{...cycle, mode, dates}])
//  - cycle: the notice that was tapped
//  - logReminders({ notices, stage, channel }) -> { data, error } (writes payment_reminders)
export default function ReminderSheet({ student, cycle, openNotices, tutor, reminders, todayKey, logReminders, onLogged, onClose }) {
  const { showToast } = useToast();
  const several = openNotices.length > 1;
  const [scope, setScope] = useState(several ? "all" : "one");
  const noticesFor = (sc) => (sc === "all" ? openNotices : openNotices.filter((n) => n.id === cycle.id));
  const stageFor = (list) =>
    mostAdvancedStage(
      list.map((n) =>
        computeReminderStage({
          reminderDayKeys: distinctDayKeys(remindersForNotice(reminders, n)),
          periodEnd: n.period_end,
          todayKey,
        }),
      ),
    );

  const family = student.guardian_name?.trim() ? student.guardian_name.trim() : `${student.name}'s family`;
  const draftFor = (stage, list) => {
    const earliestEnd = list.map((n) => n.period_end).sort()[0];
    return renderTemplate(DEFAULT_TEMPLATES[stage], {
      greeting: student.guardian_name?.trim() ? `Hi ${student.guardian_name.trim()}` : "Hi",
      student: student.name,
      period: buildCombinedPeriod(
        list.map((n) => ({
          mode: n.mode, isManualCloseout: n.is_manual_closeout, dates: n.dates ?? [], periodStart: n.period_start, periodEnd: n.period_end,
        })),
      ),
      amount: formatSGD(list.reduce((s, n) => s + Number(n.amount_due), 0)),
      due_date: earliestEnd ? formatDate(earliestEnd) : "",
      paynow: tutor?.paynow_number ?? "",
      link: buildPaymentSummaryUrl(student.payment_token) ?? "",
      tutor: tutor?.full_name || "Your tutor",
    });
  };

  const [stage, setStage] = useState(() => stageFor(noticesFor(scope)));
  const [text, setText] = useState(() => draftFor(stage, noticesFor(scope)));
  const [generated, setGenerated] = useState(text);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [showMark, setShowMark] = useState(false);

  const included = noticesFor(scope);
  const total = included.reduce((s, n) => s + Number(n.amount_due), 0);

  // Re-draft for a new stage / scope; ask first if the tutor typed edits.
  const redraft = (nextStage, nextScope) => {
    if (text !== generated && !window.confirm(`Replace your edits with the ${STAGE_LABELS[nextStage]} draft?`)) return;
    const next = draftFor(nextStage, noticesFor(nextScope));
    setStage(nextStage);
    setScope(nextScope);
    setText(next);
    setGenerated(next);
  };

  // ── Notes ──
  const contact = (student.guardian_contact ?? "").trim();
  const hasNumber = Boolean(normalizeWhatsAppNumber(contact));
  const mine = included.flatMap((n) => remindersForNotice(reminders, n));
  const newestDays = mine.length ? dayDiff(todayKey, distinctDayKeys(mine).slice(-1)[0]) : null;
  const placement =
    Number(student.placement_fee_amount) > 0 &&
    (!student.placement_fee_start || included.some((n) => n.period_end >= student.placement_fee_start));
  const notes = [];
  if (!contact) notes.push({ key: "nonum", text: "No WhatsApp number saved for this parent. WhatsApp will ask you to pick the chat.", link: [`/students/${student.id}`, "Add number"] });
  else if (!hasNumber) notes.push({ key: "badnum", text: `The saved contact "${contact}" doesn't look like a phone number. WhatsApp will ask you to pick the chat.`, link: [`/students/${student.id}`, "Fix number"] });
  if (newestDays !== null && newestDays <= 2) {
    const when = newestDays === 0 ? "today" : newestDays === 1 ? "yesterday" : "2 days ago";
    notes.push({ key: "recent", text: `You reminded ${family} ${when}. Maybe give it another day or two?` });
  }
  if (!tutor?.paynow_number) notes.push({ key: "paynow", text: "Your PayNow number isn't set, so it's left out.", link: ["/settings", "Add it in Settings"] });
  if (placement) notes.push({ key: "placement", text: `Part of ${student.name}'s early lessons was a placement fee paid to ${student.placement_fee_agency || "the agency"}. Please check the amount before sending.` });
  if (student.deleted_at || student.archived) notes.push({ key: "arch", text: `${student.name} is ${student.deleted_at ? "deleted" : "archived"}. The payment link still works.` });

  const log = async (channel) => {
    const { data, error } = await logReminders({ notices: included, stage, channel });
    if (!error) onLogged?.(data ?? []);
    return error;
  };

  // window.open runs synchronously in the click, before any await.
  const handleSend = () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    window.open(buildWhatsAppLink(text, student.guardian_contact), "_blank");
    log("whatsapp").then((error) => {
      if (error) showToast(`WhatsApp opened, but the reminder date could not be saved: ${error.message}`, "error");
      else showToast(`WhatsApp opened for ${family}. Marked as reminded today.`);
      onClose();
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError(false);
      setCopied(true);
      setShowMark(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError(true);
    }
  };

  const handleMarkReminded = async () => {
    if (busy) return;
    setBusy(true);
    const error = await log("copy");
    if (error) {
      setBusy(false);
      showToast(`Could not mark as reminded: ${error.message}`, "error");
      return;
    }
    showToast("Marked as reminded today.");
    onClose();
  };

  const periodLabel = included.length === 1 ? buildCombinedPeriod([{ mode: included[0].mode, isManualCloseout: included[0].is_manual_closeout, dates: included[0].dates ?? [], periodStart: included[0].period_start, periodEnd: included[0].period_end }]) : `${included.length} notices`;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">Reminder for {family}</h2>
            <p className="mt-0.5 text-sm text-gray-600">{student.name} · {formatSGD(total)} · {periodLabel}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Reminder stage">
            {STAGES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={stage === s}
                onClick={() => s !== stage && redraft(s, scope)}
                className={`min-h-11 rounded-full px-3 text-xs font-medium ${stage === s ? "bg-[#1b2d4f] text-white" : "border border-gray-300 text-gray-700"}`}
              >
                {STAGE_LABELS[s]}
              </button>
            ))}
          </div>

          {several && (
            <div className="space-y-1 text-sm text-gray-700">
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="reminder-scope" checked={scope === "all"} onChange={() => scope !== "all" && redraft(stageFor(openNotices), "all")} />
                All {openNotices.length} unpaid notices · {formatSGD(openNotices.reduce((s, n) => s + Number(n.amount_due), 0))}
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input type="radio" name="reminder-scope" checked={scope === "one"} onChange={() => scope !== "one" && redraft(stageFor(noticesFor("one")), "one")} />
                Only this notice · {formatSGD(Number(cycle.amount_due))}
              </label>
            </div>
          )}

          <p className="text-xs text-gray-500">Drafted for you. Edit anything before sending.</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            aria-label="Reminder message"
            className="w-full rounded-[4px_16px_16px_16px] bg-[#e6f7f0] p-3 text-sm leading-relaxed text-[#1b2d4f] focus:outline-none focus:ring-2 focus:ring-[#5ecfaa]"
          />

          {notes.map((n) => (
            <p key={n.key} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {n.text}{" "}
              {n.link && <Link to={n.link[0]} className="font-medium underline">{n.link[1]}</Link>}
            </p>
          ))}

          {copyError && <p className="text-xs text-red-600">Couldn't copy. Please select the text and copy it manually.</p>}
          {!text.trim() && <p className="text-xs text-red-600">Message is empty.</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !text.trim()}
              className="min-h-11 flex-[2] rounded-lg bg-[#5ecfaa] px-3 text-sm font-bold text-[#1b2d4f] disabled:opacity-50"
            >
              Send on WhatsApp
            </button>
            <button type="button" onClick={handleCopy} className="min-h-11 flex-1 rounded-lg bg-gray-100 px-3 text-sm font-medium text-[#1b2d4f]">
              {copied ? "Copied!" : "Copy"}
            </button>
            <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-lg bg-gray-100 px-3 text-sm font-medium text-[#1b2d4f]">
              Not now
            </button>
          </div>
          {showMark && (
            <button type="button" onClick={handleMarkReminded} disabled={busy} className="text-xs font-medium text-[#0f7a58] underline disabled:opacity-50">
              Sent it yourself? Mark as reminded
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
