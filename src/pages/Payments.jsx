import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { buildPaymentNoticeMessage, formatSGD } from "../lib/paymentNotice";
import { formatDate } from "../lib/date";
import {
  buildPaidReceiptMessage,
  buildPaymentRequestMessage,
  buildWhatsAppLink,
} from "../lib/whatsapp";
import StatusBadge from "../components/StatusBadge";
import AppShell from "../components/AppShell";

export default function Payments() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [cycles, setCycles] = useState([]);
  const [lessonDatesByCycle, setLessonDatesByCycle] = useState({});
  const [tutorProfile, setTutorProfile] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const load = async () => {
    const [{ data, error }, { data: tutorData }] = await Promise.all([
      supabase
        .from("payment_cycles")
        .select("*, students(name, subject, guardian_name, guardian_contact)")
        .order("created_at", { ascending: false }),
      supabase
        .from("tutors")
        .select("full_name, paynow_number")
        .eq("id", user.id)
        .single(),
    ]);
    if (error) setError(error.message);
    setCycles(data ?? []);
    setTutorProfile(tutorData ?? {});

    const cycleIds = (data ?? []).map((c) => c.id);
    if (cycleIds.length > 0) {
      const { data: lessonsData } = await supabase
        .from("lessons")
        .select("payment_cycle_id, lesson_date")
        .in("payment_cycle_id", cycleIds)
        .order("lesson_date", { ascending: true });
      const map = {};
      for (const l of lessonsData ?? []) {
        if (!map[l.payment_cycle_id]) map[l.payment_cycle_id] = [];
        map[l.payment_cycle_id].push(l.lesson_date);
      }
      setLessonDatesByCycle(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async (cycle) => {
    const message = buildPaymentNoticeMessage({
      studentName: cycle.students?.name,
      amountDue: cycle.amount_due,
      periodStart: cycle.period_start,
      periodEnd: cycle.period_end,
      tutorName: user?.user_metadata?.full_name,
    });
    await navigator.clipboard.writeText(message);
    setCopiedId(cycle.id);
    showToast("Payment notice copied to clipboard.");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleMarkPaid = async (id) => {
    setError(null);
    const { error } = await supabase
      .from("payment_cycles")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    await load();
    showToast("Marked as paid.");
  };

  const handleRequestPayment = (cycle) => {
    const message = buildPaymentRequestMessage({
      studentName: cycle.students?.name,
      subject: cycle.students?.subject,
      lessonDates: lessonDatesByCycle[cycle.id] ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
      paynowNumber: tutorProfile.paynow_number,
    });
    window.open(buildWhatsAppLink(message), "_blank");
  };

  const handleSendReceipt = (cycle) => {
    const message = buildPaidReceiptMessage({
      studentName: cycle.students?.name,
      subject: cycle.students?.subject,
      lessonDates: lessonDatesByCycle[cycle.id] ?? [],
      amountDue: cycle.amount_due,
      tutorName: tutorProfile.full_name,
    });
    window.open(buildWhatsAppLink(message), "_blank");
  };

  const pending = cycles.filter((c) => c.status === "pending");
  const settled = cycles.filter((c) => c.status !== "pending");

  return (
    <AppShell>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">
          Payment notices due {pending.length > 0 && `(${pending.length})`}
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : pending.length === 0 && settled.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-100 bg-white px-6 py-12 text-center shadow-sm">
            <p className="mb-4 text-5xl">💰</p>
            <p className="max-w-sm text-sm text-gray-600">
              No payments yet. Payments appear automatically after every 4
              lessons.
            </p>
          </div>
        ) : pending.length === 0 ? (
          <p className="text-sm text-gray-500">
            No payments due. A notice appears here automatically once a student
            accumulates 4 lessons.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-amber-200 bg-amber-50 p-4 transition hover:shadow-md"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 font-medium text-gray-900">
                    {c.students?.name}
                    <StatusBadge status={c.status} />
                  </span>
                  <span className="font-semibold text-gray-900">
                    {formatSGD(c.amount_due)}
                  </span>
                </div>
                <p className="mb-3 text-sm text-gray-600">
                  {formatDate(c.period_start)} to {formatDate(c.period_end)}
                  {c.students?.guardian_contact &&
                    ` · Contact: ${c.students.guardian_contact}`}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(c)}
                    className="min-h-11 rounded-md bg-green-600 px-3 text-sm font-medium text-white transition hover:bg-green-700 hover:shadow"
                  >
                    {copiedId === c.id ? "Copied!" : "Copy payment notice"}
                  </button>
                  <button
                    onClick={() => handleMarkPaid(c.id)}
                    className="min-h-11 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100"
                  >
                    Mark as paid
                  </button>
                  <button
                    onClick={() => handleRequestPayment(c)}
                    className="min-h-11 rounded-md bg-orange-500 px-3 text-sm font-medium text-white transition hover:bg-orange-600 hover:shadow"
                  >
                    💬 Request Payment
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold text-gray-900">History</h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : settled.length === 0 ? (
          <p className="text-sm text-gray-500">
            No settled payment cycles yet.
          </p>
        ) : (
          <>
            <ul className="space-y-3 sm:hidden">
              {settled.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border border-gray-200 bg-white p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-gray-900">
                      {c.students?.name}
                    </span>
                    <StatusBadge status={c.status} />
                  </div>
                  <p className="text-sm text-gray-600">
                    {formatDate(c.period_start)} – {formatDate(c.period_end)} ·{" "}
                    {formatSGD(c.amount_due)}
                  </p>
                  {c.status === "paid" && (
                    <button
                      onClick={() => handleSendReceipt(c)}
                      className="mt-2 min-h-11 rounded-md bg-green-600 px-3 text-xs font-medium text-white transition hover:bg-green-700 hover:shadow"
                    >
                      💬 Send WhatsApp Receipt
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="hidden overflow-hidden rounded-md border border-gray-200 bg-white sm:block">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Student</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium">Amount</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {settled.map((c) => (
                    <tr key={c.id} className="transition hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900">
                        {c.students?.name}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDate(c.period_start)} –{" "}
                        {formatDate(c.period_end)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatSGD(c.amount_due)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {c.status === "paid" && (
                          <button
                            onClick={() => handleSendReceipt(c)}
                            className="font-medium text-green-600 hover:text-green-700"
                          >
                            💬 Send WhatsApp Receipt
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
