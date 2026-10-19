import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import AppShell from "../components/AppShell";
import { formatSGD } from "../lib/paymentNotice";
import {
  buildStatement,
  currentMonthStr,
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
  const [payeeId, setPayeeId] = useState("");
  const [monthStr, setMonthStr] = useState(currentMonthStr());
  const [form, setForm] = useState({ id: null, name: "", share_percent: "80" });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

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
        .select("id, name, subject, level, hourly_rate, fee_collected_by, payee_id")
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
      const { start, end } = monthRange(monthStr);
      const { data: les, error: lErr } = await supabase
        .from("lessons")
        .select(
          "id, student_id, lesson_date, lesson_time, duration_minutes, rate, rate_type, subject",
        )
        .eq("tutor_id", user.id)
        .eq("is_completed", true)
        .in(
          "student_id",
          studs.map((s) => s.id),
        )
        .gte("lesson_date", start)
        .lt("lesson_date", end);
      if (cancelled) return;
      if (lErr) setError(lErr.message);
      setLessons(les ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, payeeId, monthStr]);

  const statement = useMemo(
    () =>
      payee
        ? buildStatement({
            payee,
            students: students.filter((x) => x.payee_id === payee.id),
            lessons,
          })
        : null,
    [payee, students, lessons],
  );

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
        payee,
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

      {activePayees.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
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

              {!students.some((x) => x.payee_id === payee.id) ? (
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
                          {b.collectedBy === "me" ? "Paid to you" : `Paid to ${payee.name}`}
                        </span>
                      </div>
                      <table className="w-full text-sm">
                        <tbody>
                          {b.rows.map((r) => (
                            <tr key={r.id} className="border-t border-gray-100">
                              <td className="px-3 py-1.5">{fmtDay(r.date)}</td>
                              <td className="px-3 py-1.5 text-gray-600">
                                {r.perSession ? "per session" : `${Number(r.hours.toFixed(2))} h`}
                              </td>
                              <td className="px-3 py-1.5 text-right">{formatSGD(r.amount)}</td>
                            </tr>
                          ))}
                          <tr className="border-t border-gray-200 font-medium">
                            <td className="px-3 py-1.5">Total</td>
                            <td className="px-3 py-1.5 text-gray-600">{Number(b.hours.toFixed(2))} h</td>
                            <td className="px-3 py-1.5 text-right">{formatSGD(b.total)}</td>
                          </tr>
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
                      <span>{formatSGD(statement.feesCollectedByMe)}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span>You owe {payee.name} ({Number((100 - statement.sharePct).toFixed(2))}% of direct fees)</span>
                      <span>− {formatSGD(statement.iOweAgency)}</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-gray-300 pt-1.5 font-semibold">
                      <span>Total {payee.name} to reimburse you</span>
                      <span>{formatSGD(statement.net)}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleExport}
                    disabled={exporting}
                    className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white hover:bg-[#15243f] disabled:opacity-50"
                  >
                    {exporting ? "Preparing…" : "⬇ Download Excel"}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </AppShell>
  );
}
