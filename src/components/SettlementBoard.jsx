import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { formatSGD } from "../lib/paymentNotice";
import { buildStatement, monthLabelFromStr, monthRange } from "../lib/statement";

const PILL = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  gray: "bg-gray-100 text-gray-600",
  red: "bg-red-100 text-red-700",
};

function Pill({ tone, children }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[tone]}`}>
      {children}
    </span>
  );
}

// Month-end board: one card per agency/payer, with its status for the month.
export default function SettlementBoard({ payees, monthStr, onMonthChange, onOpenPayee, refreshKey = 0 }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const activePayees = useMemo(() => payees.filter((p) => !p.archived), [payees]);

  const load = useCallback(async () => {
    if (!user || activePayees.length === 0) {
      setData({ students: [], lessons: [], cycles: [], items: [], records: [] });
      return;
    }
    const { end } = monthRange(monthStr);
    const monthDate = `${monthStr}-01`;
    const { data: studs, error: sErr } = await supabase
      .from("students")
      .select(
        "id, name, subject, level, hourly_rate, fee_collected_by, payee_id, payment_mode, placement_fee_agency, placement_fee_amount, placement_fee_start, direct_payer",
      )
      .eq("tutor_id", user.id)
      .in(
        "payee_id",
        activePayees.map((p) => p.id),
      )
      .is("deleted_at", null);
    if (sErr) return setError(sErr.message);
    let lessons = [];
    let cycles = [];
    if (studs?.length) {
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
      if (lErr) return setError(lErr.message);
      lessons = les ?? [];
      const cycleIds = [...new Set(lessons.map((l) => l.payment_cycle_id).filter(Boolean))];
      if (cycleIds.length) {
        const { data: cyc, error: cErr } = await supabase
          .from("payment_cycles")
          .select("id, status, student_id")
          .eq("tutor_id", user.id)
          .in("id", cycleIds);
        if (cErr) return setError(cErr.message);
        cycles = cyc ?? [];
      }
    }
    const [{ data: items }, { data: records }] = await Promise.all([
      supabase.from("payee_claim_items").select("*").eq("tutor_id", user.id).eq("month", monthDate),
      supabase.from("payee_statements").select("*").eq("tutor_id", user.id).eq("month", monthDate),
    ]);
    setError(null);
    setData({
      students: studs ?? [],
      lessons,
      cycles,
      items: items ?? [],
      records: records ?? [],
    });
  }, [user, activePayees, monthStr]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load, refreshKey]);

  const model = useMemo(() => {
    if (!data) return null;
    const { start, end } = monthRange(monthStr);
    const cycleStatus = new Map(data.cycles.map((c) => [c.id, c.status]));
    const paidLessonIds = new Set(
      data.lessons.filter((l) => cycleStatus.get(l.payment_cycle_id) === "paid").map((l) => l.id),
    );
    const monthLessons = data.lessons.filter((l) => l.lesson_date >= start && l.lesson_date < end);

    const claimCards = [];
    const payerMap = new Map();
    for (const payee of activePayees) {
      const studs = data.students.filter((s) => s.payee_id === payee.id);
      const record = data.records.find((r) => r.payee_id === payee.id) ?? null;
      const st = buildStatement({
        payee: record ? { ...payee, share_percent: record.share_percent } : payee,
        students: studs,
        lessons: data.lessons.filter((l) => studs.some((s) => s.id === l.student_id)),
        items: data.items.filter((i) => i.payee_id === payee.id),
        range: { start, end },
        paidLessonIds,
      });
      if (st.blocks.length > 0 || record || st.items.length > 0) {
        claimCards.push({ payee, st, record });
      }
      for (const g of st.directGroups) {
        const key = g.payer;
        const acc = payerMap.get(key) ?? { payer: key, total: 0, studentIds: [], students: [] };
        acc.total += g.total;
        acc.studentIds.push(...g.studentIds);
        acc.students.push(...g.students);
        payerMap.set(key, acc);
      }
    }

    const payerCards = [...payerMap.values()].map((g) => {
      const ids = new Set(g.studentIds);
      const cycleIds = [
        ...new Set(
          monthLessons
            .filter((l) => ids.has(l.student_id))
            .map((l) => l.payment_cycle_id)
            .filter(Boolean),
        ),
      ];
      const statuses = cycleIds.map((id) => cycleStatus.get(id));
      const paidN = statuses.filter((x) => x === "paid").length;
      const status =
        cycleIds.length === 0
          ? "not_due"
          : paidN === cycleIds.length
            ? "paid"
            : paidN === 0
              ? "unpaid"
              : "partly";
      const pendingIds = cycleIds.filter((id) => cycleStatus.get(id) !== "paid");
      const notMonthly = data.students.filter(
        (s) => ids.has(s.id) && s.payment_mode !== "monthly",
      );
      return { ...g, total: Math.round(g.total * 100) / 100, status, pendingIds, notMonthly };
    });
    payerCards.sort((a, b) => a.payer.localeCompare(b.payer));

    const claimSettled = (c) => c.record?.status === "reimbursed";
    const total = claimCards.length + payerCards.length;
    const settled = claimCards.filter(claimSettled).length + payerCards.filter((c) => c.status === "paid").length;
    return { claimCards, payerCards, total, settled };
  }, [data, activePayees, monthStr]);

  const markPayerPaid = async (card) => {
    setBusy(true);
    const { error: err } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .in("id", card.pendingIds)
      .eq("tutor_id", user.id);
    setBusy(false);
    if (err) return showToast(err.message, "error");
    showToast(`${card.payer} marked as paid`);
    await load();
  };

  const switchToMonthly = async (students) => {
    const ok = window.confirm(
      `Switch ${students.length} student${students.length === 1 ? "" : "s"} to monthly billing?\n\n` +
        "Their unpaid lessons are regrouped into one payment per month, due at month end. " +
        "Payments already marked as paid are not changed.",
    );
    if (!ok) return;
    setBusy(true);
    try {
      for (const s of students) {
        const { error: uErr } = await supabase
          .from("students")
          .update({ payment_mode: "monthly", payment_cycle_count: 4, payment_custom_day: null })
          .eq("id", s.id)
          .eq("tutor_id", user.id);
        if (uErr) throw uErr;
        const { error: rErr } = await supabase.rpc("recompute_payment_cycles", {
          p_student_id: s.id,
          p_tutor_id: user.id,
        });
        if (rErr) throw rErr;
      }
      showToast("Switched to monthly billing");
      await load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (activePayees.length === 0) return null;

  const needSwitch = model
    ? model.payerCards.flatMap((c) => c.notMonthly).filter((s, i, a) => a.findIndex((x) => x.id === s.id) === i)
    : [];

  return (
    <section className="mb-5 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Month-end settlement</h2>
          {model && model.total > 0 && (
            <p className="text-xs text-gray-500">
              {model.settled} of {model.total} settled for {monthLabelFromStr(monthStr)}
            </p>
          )}
        </div>
        <input
          type="month"
          value={monthStr}
          onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          aria-label="Settlement month"
        />
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      {!model ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : model.total === 0 ? (
        <p className="text-sm text-gray-500">Nothing to settle for this month yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {model.claimCards.map(({ payee, st, record }) => (
            <li key={payee.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {payee.name}{" "}
                  <span className="text-xs font-normal text-gray-500">
                    · {st.net < 0 ? "you owe" : "pays you"} (net of {st.sharePct}% share)
                  </span>
                </p>
                {st.unpaidByStudents > 0 && (
                  <p className="text-xs text-amber-700">
                    {formatSGD(st.unpaidByStudents)} of these lessons not yet paid by students
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{formatSGD(Math.abs(st.net))}</span>
                {record?.status === "reimbursed" ? (
                  <Pill tone="green">✅ Reimbursed</Pill>
                ) : record?.status === "sent" ? (
                  <Pill tone="amber">⏳ Sent, awaiting payment</Pill>
                ) : (
                  <Pill tone="gray">Not sent</Pill>
                )}
                <button
                  onClick={() => onOpenPayee(payee.id)}
                  className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Open statement →
                </button>
              </div>
            </li>
          ))}
          {model.payerCards.map((c) => (
            <li key={c.payer} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {c.payer}{" "}
                  <span className="text-xs font-normal text-gray-500">· pays you directly</span>
                </p>
                <p className="text-xs text-gray-500">{c.students.join(", ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold">{formatSGD(c.total)}</span>
                {c.status === "paid" ? (
                  <Pill tone="green">✅ Paid</Pill>
                ) : c.status === "partly" ? (
                  <Pill tone="amber">Partly paid</Pill>
                ) : c.status === "unpaid" ? (
                  <Pill tone="red">⏳ Not paid</Pill>
                ) : (
                  <Pill tone="gray">Not due yet</Pill>
                )}
                {c.pendingIds.length > 0 && (
                  <button
                    onClick={() => markPayerPaid(c)}
                    disabled={busy}
                    className="rounded-md bg-[#5ecfaa] px-2.5 py-1 text-xs font-medium text-[#1b2d4f] hover:brightness-95 disabled:opacity-50"
                  >
                    Mark paid
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {needSwitch.length > 0 && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-gray-600">
          {needSwitch.length} student{needSwitch.length === 1 ? "" : "s"} paid directly by a payer
          {needSwitch.length === 1 ? " isn't" : " aren't"} on monthly billing yet:{" "}
          {needSwitch.map((s) => s.name).join(", ")}.{" "}
          <button
            onClick={() => switchToMonthly(needSwitch)}
            disabled={busy}
            className="font-medium text-[#1b2d4f] underline disabled:opacity-50"
          >
            Switch them to monthly
          </button>
        </div>
      )}
    </section>
  );
}
