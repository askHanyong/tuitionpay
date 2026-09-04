import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatSGD } from "../lib/paymentNotice";
import { formatDate } from "../utils/dateFormat";

function formatPeriod(periodStart, periodEnd) {
  const start = new Date(`${periodStart}T00:00:00`);
  const startLabel = start.toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
  });
  return `${startLabel} – ${formatDate(periodEnd)}`;
}

export default function PaymentSummary() {
  const { token } = useParams();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.rpc("get_payment_summary", {
        p_token: token,
      });
      if (error) {
        console.error("get_payment_summary RPC error:", error);
        setError("We're having trouble loading this payment summary right now. Please ask your tutor to resend the link, or try again in a moment.");
      } else if (!data) {
        setError("not_found");
      } else {
        setSummary(data);
      }
      setLoading(false);
    };
    load();
  }, [token]);

  const cycles = summary?.cycles ?? [];
  const pendingCycles = cycles.filter((c) => c.status !== "paid");
  const outstandingTotal = pendingCycles.reduce(
    (sum, c) => sum + Number(c.amount_due ?? 0),
    0,
  );

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-xl">
        <Link
          to="/"
          className="text-lg font-bold text-[#0f7a58] hover:text-[#0f1e35]"
        >
          🌿 ChopeAndPay
        </Link>

        <div className="mt-6 rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          {loading && (
            <p className="text-sm text-gray-500">Loading payment summary...</p>
          )}

          {!loading && error && (
            <p className="text-sm text-gray-600">
              We couldn't find this payment summary. Please check the link and
              try again.
            </p>
          )}

          {!loading && !error && summary && (
            <>
              <h1 className="text-xl font-semibold text-gray-900">
                Payment summary for {summary.student_name}
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                {summary.subject && `${summary.subject} · `}
                Taught by {summary.tutor_first_name}
              </p>

              {pendingCycles.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Outstanding: {formatSGD(outstandingTotal)}
                  {summary.paynow_number &&
                    ` — please PayNow to ${summary.paynow_number}`}
                </div>
              )}

              <div className="mt-5 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                      <th className="py-2 pr-2">Period</th>
                      <th className="py-2 pr-2">Amount</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2">Paid on</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cycles.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-4 text-sm text-gray-500">
                          No payment history yet.
                        </td>
                      </tr>
                    )}
                    {cycles.map((cycle, idx) => {
                      const isPaid = cycle.status === "paid";
                      return (
                        <tr
                          key={`${cycle.period_start}-${idx}`}
                          className="border-b border-gray-100"
                        >
                          <td className="py-2 pr-2 text-gray-700">
                            {formatPeriod(cycle.period_start, cycle.period_end)}
                          </td>
                          <td className="py-2 pr-2 text-gray-700">
                            {formatSGD(cycle.amount_due)}
                          </td>
                          <td className="py-2 pr-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                isPaid
                                  ? "bg-[#d6ede6] text-[#1b2d4f]"
                                  : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {isPaid ? "✅ Paid" : "⏳ Pending"}
                            </span>
                          </td>
                          <td className="py-2 text-gray-700">
                            {cycle.paid_at ? formatDate(cycle.paid_at) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Powered by ChopeAndPay · chopeandpay.com
        </p>
      </div>
    </div>
  );
}
