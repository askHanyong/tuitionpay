import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import SettlementBoard from "../components/SettlementBoard";
import { formatSGD } from "../lib/paymentNotice";
import {
  buildStatement,
  currentMonthStr,
  directPayerLabel,
  downloadStatementXlsx,
  monthLabelFromStr,
  monthRange,
} from "../lib/statement";

const inputClass =
  "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]";

function fmtDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export default function Statements() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [payees, setPayees] = useState([]);
  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The dashboard recap links here with ?payee=<id>&month=YYYY-MM.
  const [searchParams] = useSearchParams();
  const [payeeId, setPayeeId] = useState(() => searchParams.get("payee") || "");
  const [monthStr, setMonthStr] = useState(() => {
    const m = searchParams.get("month");
    return m && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthStr();
  });
  const [form, setForm] = useState({ id: null, name: "", share_percent: "80" });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [items, setItems] = useState([]);
  const [record, setRecord] = useState(null);
  const [unpaid, setUnpaid] = useState([]);
  const [itemForm, setItemForm] = useState({ description: "", amount: "", direction: "owed_to_me", note: "" });
  const [savingItem, setSavingItem] = useState(false);
  const [paidIds, setPaidIds] = useState(() => new Set());
  const [boardVersion, setBoardVersion] = useState(0);

  const activePayees = payees.filter((p) => !p.archived);
  const payee = payees.find((p) => p.id === payeeId) ?? null;

  const loadPayees = async () => {
    const { data, error: err } = await supabase
      .from("payees")
      .select("*")
      .eq("tutor_id", user.id)
      .order("name");
    if (err) {
      setError(err.message);
      return [];
    }
    setPayees(data ?? []);
    return data ?? [];
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const list = await loadPayees();
      const first = list.find((p) => !p.archived);
      if (first) setPayeeId((cur) => cur || first.id);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Load this payee's students and their completed lessons for the month.
  useEffect(() => {
    if (!user || !payeeId) return;
    let cancelled = false;
    (async () => {
      const { data: studs, error: sErr } = await supabase
        .from("students")
        .select(
          "id, name, subject, level, hourly_rate, fee_collected_by, payee_id, placement_fee_agency, placement_fee_amount, placement_fee_start, direct_payer",
        )
        .eq("tutor_id", user.id)
        .eq("payee_id", payeeId)
        .is("deleted_at", null);
      if (cancelled) return;
      if (sErr) {
        setError(sErr.message);
        return;
      }
      setStudents(studs ?? []);
      if (!studs?.length) {
        setLessons([]);
        return;
      }
      const { end } = monthRange(monthStr);
      const { data: les, error: lErr } = await supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, duration_minutes, rate, rate_type, subject, payment_cycle_id",
        )
        .eq("tutor_id", user.id)
        .eq("is_completed", true)
        .in(
          "student_id",
          studs.map((s) => s.id),
        )
        .lt("lesson_date", end);
      // (all earlier lessons are needed so a one-off placement fee is spread correctly)
      if (cancelled) return;
      if (lErr) setError(lErr.message);
      // Which of these lessons has the student already paid for?
      const cycleIds = [...new Set((les ?? []).map((l) => l.payment_cycle_id).filter(Boolean))];
      let paid = new Set();
      if (cycleIds.length) {
        const { data: cyc } = await supabase
          .from("payment_cycles")
          .select("id, status")
          .eq("tutor_id", user.id)
          .in("id", cycleIds);
        const paidCycles = new Set((cyc ?? []).filter((c) => c.status === "paid").map((c) => c.id));
        paid = new Set((les ?? []).filter((l) => paidCycles.has(l.payment_cycle_id)).map((l) => l.id));
      }
      if (cancelled) return;
      setPaidIds(paid);
      setLessons(les ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, payeeId, monthStr]);

  const monthDate = `${monthStr}-01`;

  const loadItemsAndRecord = async () => {
    if (!user || !payeeId) return;
    const [{ data: its, error: iErr }, { data: rec, error: rErr }] = await Promise.all([
      supabase
        .from("payee_claim_items")
        .select("*")
        .eq("tutor_id", user.id)
        .eq("payee_id", payeeId)
        .eq("month", monthDate)
        .order("created_at"),
      supabase
        .from("payee_statements")
        .select("*")
        .eq("tutor_id", user.id)
        .eq("payee_id", payeeId)
        .eq("month", monthDate)
        .maybeSingle(),
    ]);
    if (iErr || rErr) setError((iErr || rErr).message);
    setItems(its ?? []);
    setRecord(rec ?? null);
  };

  const loadUnpaid = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("payee_statements")
      .select("*")
      .eq("tutor_id", user.id)
      .eq("status", "sent")
      .order("month");
    setUnpaid(data ?? []);
    setBoardVersion((v) => v + 1);
  };

  useEffect(() => {
    (async () => {
      await loadItemsAndRecord();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, payeeId, monthStr]);

  useEffect(() => {
    (async () => {
      await loadUnpaid();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Once a statement has been sent, its share % is frozen at what was sent.
  const effectivePayee = useMemo(
    () => (payee && record ? { ...payee, share_percent: record.share_percent } : payee),
    [payee, record],
  );

  const linkedStudents = useMemo(
    () => (payee ? students.filter((x) => x.payee_id === payee.id) : []),
    [payee, students],
  );

  const statement = useMemo(
    () =>
      effectivePayee
        ? buildStatement({
            payee: effectivePayee,
            students: linkedStudents,
            lessons,
            items,
            range: monthRange(monthStr),
            paidLessonIds: paidIds,
          })
        : null,
    [effectivePayee, linkedStudents, lessons, items, monthStr, paidIds],
  );

  const syncClaimedTotal = async (nextItems) => {
    // Keep a sent statement's recorded total in step with the lines on screen.
    if (!record || record.status === "reimbursed") return;
    const next = buildStatement({
      payee: effectivePayee,
      students: linkedStudents,
      lessons,
      items: nextItems,
      range: monthRange(monthStr),
    });
    await supabase
      .from("payee_statements")
      .update({ claimed_total: next.net })
      .eq("id", record.id)
      .eq("tutor_id", user.id);
  };

  const addItem = async (e) => {
    e.preventDefault();
    const description = itemForm.description.trim();
    const raw = Math.abs(Number(itemForm.amount));
    if (!description) return setError("Please describe the expense.");
    if (!raw) return setError("Please enter an amount.");
    setSavingItem(true);
    setError(null);
    const amount = itemForm.direction === "i_owe" ? -raw : raw;
    const { data, error: err } = await supabase
      .from("payee_claim_items")
      .insert({
        tutor_id: user.id,
        payee_id: payeeId,
        month: monthDate,
        description,
        amount,
        note: itemForm.note.trim() || null,
      })
      .select()
      .single();
    setSavingItem(false);
    if (err) return setError(err.message);
    const next = [...items, data];
    setItems(next);
    setItemForm({ description: "", amount: "", direction: itemForm.direction, note: "" });
    await syncClaimedTotal(next);
    loadUnpaid();
  };

  const deleteItem = async (id) => {
    const { error: err } = await supabase
      .from("payee_claim_items")
      .delete()
      .eq("id", id)
      .eq("tutor_id", user.id);
    if (err) return setError(err.message);
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    await syncClaimedTotal(next);
    loadUnpaid();
  };

  const markSent = async () => {
    const { error: err } = await supabase.from("payee_statements").insert({
      tutor_id: user.id,
      payee_id: payeeId,
      month: monthDate,
      share_percent: payee.share_percent,
      claimed_total: statement.net,
    });
    if (err) return setError(err.message);
    showToast("Marked as sent");
    await loadItemsAndRecord();
    loadUnpaid();
  };

  const setReimbursed = async (rec, reimbursed) => {
    const { error: err } = await supabase
      .from("payee_statements")
      .update({
        status: reimbursed ? "reimbursed" : "sent",
        reimbursed_at: reimbursed ? new Date().toISOString() : null,
      })
      .eq("id", rec.id)
      .eq("tutor_id", user.id);
    if (err) return setError(err.message);
    if (reimbursed) showToast("Marked as reimbursed");
    await loadItemsAndRecord();
    loadUnpaid();
  };

  const undoSent = async () => {
    const { error: err } = await supabase
      .from("payee_statements")
      .delete()
      .eq("id", record.id)
      .eq("tutor_id", user.id);
    if (err) return setError(err.message);
    await loadItemsAndRecord();
    loadUnpaid();
  };

  const openNew = () => {
    setForm({ id: null, name: "", share_percent: "80" });
    setShowForm(true);
  };
  const openEdit = (p) => {
    setForm({ id: p.id, name: p.name, share_percent: String(p.share_percent) });
    setShowForm(true);
  };

  const savePayee = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    const pct = Number(form.share_percent);
    if (!name) return setError("Please enter a name.");
    if (!(pct >= 0 && pct <= 100)) return setError("Share must be between 0 and 100.");
    setSaving(true);
    setError(null);
    const payload = { name, share_percent: pct };
    const res = form.id
      ? await supabase.from("payees").update(payload).eq("id", form.id).eq("tutor_id", user.id)
      : await supabase
          .from("payees")
          .insert({ ...payload, tutor_id: user.id })
          .select()
          .single();
    setSaving(false);
    if (res.error) return setError(res.error.message);
    showToast(form.id ? "Payee updated" : "Payee added");
    setShowForm(false);
    const list = await loadPayees();
    if (!form.id && res.data) setPayeeId(res.data.id);
    else if (!payeeId) setPayeeId(list.find((p) => !p.archived)?.id ?? "");
  };

  const archivePayee = async (p) => {
    const { error: err } = await supabase
      .from("payees")
      .update({ archived: !p.archived })
      .eq("id", p.id)
      .eq("tutor_id", user.id);
    if (err) return setError(err.message);
    const list = await loadPayees();
    if (payeeId === p.id && !p.archived) {
      setPayeeId(list.find((x) => !x.archived && x.id !== p.id)?.id ?? "");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: tutor } = await supabase
        .from("tutors")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      await downloadStatementXlsx({
        payee: effectivePayee,
        monthStr,
        tutorName: tutor?.full_name || user.user_metadata?.full_name || "",
        statement,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-gray-900">Agency statements</h1>
        <Link to="/payments" className="text-sm text-gray-500 hover:text-gray-700">
          ← Payments
        </Link>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <SettlementBoard
        payees={payees}
        monthStr={monthStr}
        onMonthChange={setMonthStr}
        refreshKey={boardVersion}
        onOpenPayee={(id) => {
          setPayeeId(id);
          setTimeout(() => document.getElementById("statement-detail")?.scrollIntoView({ behavior: "smooth" }), 50);
        }}
      />

      <section className="mb-5 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Payees</h2>
          <button
            onClick={openNew}
            className="min-h-9 rounded-md bg-[#1b2d4f] px-3 text-sm font-medium text-white hover:bg-[#15243f]"
          >
            + Add payee
          </button>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          A payee is an agency you claim from (e.g. Lumina). The share is the
          percentage of the fee that is yours. Link students to a payee from
          each student&apos;s edit form.
        </p>

        {showForm && (
          <form onSubmit={savePayee} className="mb-3 grid gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-[1fr_8rem_auto]">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Lumina"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Your share %</label>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={form.share_percent}
                onChange={(e) => setForm({ ...form, share_percent: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className="min-h-10 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="min-h-10 rounded-md border border-gray-300 px-3 text-sm text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : payees.length === 0 ? (
          <p className="text-sm text-gray-500">No payees yet. Add one to get started.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {payees.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className={`text-sm ${p.archived ? "text-gray-400" : "text-gray-900"}`}>
                  {p.name} · {Number(p.share_percent)}%{p.archived ? " (archived)" : ""}
                </span>
                <span className="flex gap-3 text-xs">
                  <button onClick={() => openEdit(p)} className="text-gray-600 hover:text-gray-900">
                    Edit
                  </button>
                  <button onClick={() => archivePayee(p)} className="text-gray-400 hover:text-gray-700">
                    {p.archived ? "Restore" : "Archive"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {unpaid.length > 0 && (
        <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Unpaid claims ({unpaid.length})
          </h2>
          <ul className="divide-y divide-amber-100">
            {unpaid.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  {payees.find((p) => p.id === u.payee_id)?.name ?? "Payee"} ·{" "}
                  {monthLabelFromStr(u.month.slice(0, 7))} · sent{" "}
                  {new Date(u.sent_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{formatSGD(u.claimed_total)}</span>
                  <button
                    onClick={() => setReimbursed(u, true)}
                    className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-800 hover:bg-amber-100"
                  >
                    Reimbursed
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activePayees.length > 0 && (
        <section id="statement-detail" className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Payee</label>
              <select className={inputClass} value={payeeId} onChange={(e) => setPayeeId(e.target.value)}>
                {activePayees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Month (lessons taught)</label>
              <input
                className={inputClass}
                type="month"
                value={monthStr}
                onChange={(e) => e.target.value && setMonthStr(e.target.value)}
              />
            </div>
          </div>

          {statement && (
            <>
              <h2 className="mb-3 text-base font-semibold text-gray-900">
                {payee.name} — {monthLabelFromStr(monthStr)}
              </h2>

              {linkedStudents.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No students are linked to {payee.name} yet. Open a student on the{" "}
                  <Link to="/students" className="underline">Students</Link> page, edit, and choose this payee.
                </p>
              ) : statement.blocks.length === 0 ? (
                <p className="text-sm text-gray-500">No completed lessons in this month.</p>
              ) : (
                <div className="space-y-4">
                  {statement.blocks.map((b) => (
                    <div key={b.student.id} className="rounded-md border border-gray-200">
                      <div className="flex flex-wrap items-center justify-between gap-1 bg-[#e8f5ef] px-3 py-2">
                        <span className="text-sm font-medium text-gray-900">
                          {b.student.name}
                          <span className="ml-2 text-xs font-normal text-gray-600">
                            {[b.student.subject, b.student.level].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="text-xs text-gray-600">
                          {b.paidCount}/{b.rows.length} paid ·{" "}
                          {b.collectedBy === "me"
                            ? b.directPayer
                              ? directPayerLabel(b.directPayer)
                              : "Paid to you"
                            : `Paid to ${payee.name}`}
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {b.rows.map((r) => (
                            <tr key={r.id} className="border-t border-gray-100">
                              <td className="px-3 py-1.5">
                                {fmtDay(r.date)}
                                {r.paid === true && <span className="ml-2 text-xs text-green-700" title="Student has paid">✅ paid</span>}
                                {r.paid === false && <span className="ml-2 text-xs text-amber-700" title="Student has not paid yet">⏳ unpaid</span>}
                              </td>
                              <td className="px-3 py-1.5 text-gray-600">
                                {r.perSession ? "per session" : `${Number(r.hours.toFixed(2))} h`}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                {formatSGD(r.amount)}
                                {r.placementFee > 0 && (
                                  <span className="block text-xs text-amber-700">
                                    − {formatSGD(r.placementFee)} paid to {b.placementAgency} → {formatSGD(r.counted)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-200 font-medium">
                            <td className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-gray-600">{Number(b.hours.toFixed(2))} h</td>
                            <td className="px-3 py-1.5 text-right">{formatSGD(b.total)}</td>
                          </tr>
                          {b.placementTotal > 0 && (
                            <tr className="text-xs text-gray-600">
                              <td className="px-3 py-1" colSpan={2}>
                                Placement fee paid to {b.placementAgency} (not claimed)
                              </td>
                              <td className="px-3 py-1 text-right">
                                − {formatSGD(b.placementTotal)}
                              </td>
                            </tr>
                          )}
                          {b.placementTotal > 0 && (
                            <tr className="text-sm font-medium">
                              <td className="px-3 py-1" colSpan={2}>Counted</td>
                              <td className="px-3 py-1 text-right">{formatSGD(b.countedTotal)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  ))}

                  <div className="rounded-md bg-gray-50 p-3 text-sm">
                    <div className="flex justify-between py-0.5">
                      <span>Fees paid to {payee.name}</span>
                      <span>{formatSGD(statement.feesCollectedByAgency)}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span>{payee.name} owes you ({statement.sharePct}%)</span>
                      <span>{formatSGD(statement.agencyOwesMe)}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span>Fees paid directly to you</span>
                      <span>{statement.directGroups.length > 1 ? "" : formatSGD(statement.feesCollectedByMe)}</span>
                    </div>
                    {statement.directGroups.map((g) => (
                      <div key={g.payer} className="flex justify-between py-0.5 pl-4 text-gray-600">
                        <span>
                          {g.payer} – {g.students.join(", ")}
                        </span>
                        <span>{statement.directGroups.length > 1 ? formatSGD(g.total) : ""}</span>
                      </div>
                    ))}
                    {statement.directGroups.length > 1 && (
                      <div className="flex justify-between py-0.5 pl-4 font-medium">
                        <span>Total paid directly to you</span>
                        <span>{formatSGD(statement.feesCollectedByMe)}</span>
                      </div>
                    )}
                    <div className="flex justify-between py-0.5">
                      <span>You owe {payee.name} ({Number((100 - statement.sharePct).toFixed(2))}% of direct fees)</span>
                      <span>− {formatSGD(statement.iOweAgency)}</span>
                    </div>
                    {items.map((i) => (
                      <div key={i.id} className="flex justify-between py-0.5">
                        <span>
                          {i.description}
                          {i.note ? <span className="text-gray-500"> ({i.note})</span> : null}
                          <button
                            onClick={() => deleteItem(i.id)}
                            aria-label={`Remove ${i.description}`}
                            className="ml-2 text-xs text-gray-400 hover:text-red-600"
                          >
                            ✕
                          </button>
                        </span>
                        <span>{Number(i.amount) < 0 ? "− " : ""}{formatSGD(Math.abs(Number(i.amount)))}</span>
                      </div>
                    ))}
                    {statement.unpaidByStudents > 0 && (
                      <div className="flex justify-between py-0.5 text-xs text-amber-700">
                        <span>Included above but not yet paid by students</span>
                        <span>{formatSGD(statement.unpaidByStudents)}</span>
                      </div>
                    )}
                    <div className="mt-1 flex justify-between border-t border-gray-300 pt-1.5 font-semibold">
                      <span>{statement.net < 0 ? `Net: you owe ${payee.name}` : `Total ${payee.name} to reimburse you`}</span>
                      <span>{formatSGD(Math.abs(statement.net))}</span>
                    </div>
                  </div>

                  <form onSubmit={addItem} className="rounded-md border border-dashed border-gray-300 p-3">
                    <p className="mb-2 text-xs font-medium text-gray-600">Add an expense or adjustment</p>
                    <div className="grid gap-2 sm:grid-cols-[1fr_7rem_10rem]">
                      <input
                        className={inputClass}
                        placeholder="e.g. Transport to centre"
                        value={itemForm.description}
                        onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                      />
                      <input
                        className={inputClass}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        placeholder="$"
                        value={itemForm.amount}
                        onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value })}
                      />
                      <select
                        className={inputClass}
                        value={itemForm.direction}
                        onChange={(e) => setItemForm({ ...itemForm, direction: e.target.value })}
                      >
                        <option value="owed_to_me">{payee.name} owes me</option>
                        <option value="i_owe">I owe {payee.name}</option>
                      </select>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        className={inputClass}
                        placeholder="Note (optional)"
                        value={itemForm.note}
                        onChange={(e) => setItemForm({ ...itemForm, note: e.target.value })}
                      />
                      <button
                        type="submit"
                        disabled={savingItem}
                        className="min-h-10 shrink-0 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </form>

                  <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
                  >
                    {exporting ? "Preparing…" : "⬇ Download Excel"}
                  </button>
                  {!record && (
                    <button
                      onClick={markSent}
                      className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    >
                      ✓ Mark as sent
                    </button>
                  )}
                  {record?.status === "sent" && (
                    <>
                      <button
                        onClick={() => setReimbursed(record, true)}
                        className="min-h-11 rounded-md bg-[#5ecfaa] px-4 text-sm font-medium text-[#1b2d4f] hover:brightness-95"
                      >
                        💰 Mark as reimbursed
                      </button>
                      <button onClick={undoSent} className="text-xs text-gray-500 underline">
                        Undo sent
                      </button>
                    </>
                  )}
                  {record?.status === "reimbursed" && (
                    <>
                      <span className="text-sm text-green-700">
                        ✅ Reimbursed{" "}
                        {record.reimbursed_at &&
                          new Date(record.reimbursed_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                      </span>
                      <button onClick={() => setReimbursed(record, false)} className="text-xs text-gray-500 underline">
                        Undo
                      </button>
                    </>
                  )}
                  </div>
                  {record && (
                    <p className="text-xs text-gray-500">
                      Sent {new Date(record.sent_at).toLocaleDateString("en-SG", { day: "numeric", month: "short" })} at {Number(record.share_percent)}% share.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </AppShell>
  );
}
