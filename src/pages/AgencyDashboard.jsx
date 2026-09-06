import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";

function formatSGD(amount) {
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(amount ?? 0);
}

const STATUS_CLASSES = {
  pending: "bg-yellow-100 text-yellow-800",
  collected: "bg-blue-100 text-blue-800",
  disbursed: "bg-purple-100 text-purple-800",
  settled: "bg-green-100 text-green-800",
};

function StatusChip({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {status}
    </span>
  );
}

function PlacementCard({ placement }) {
  const isHandoff = placement.commission_mode === "handoff_after_n";
  const lessonsDone = placement.lessons_completed ?? 0;
  const lessonTarget = placement.handoff_after_lessons ?? 0;
  const handedOff = isHandoff && lessonsDone >= lessonTarget;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#0f1e35]">
            {placement.student_name}
          </p>
          <p className="text-xs text-gray-500">
            Tutor: {placement.tutor_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center rounded-full bg-[#edf6f3] px-2.5 py-0.5 text-xs font-medium text-[#0f7a58]">
            {isHandoff ? "Handoff" : "Ongoing"}
          </span>
          {handedOff && (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
              Handed off
            </span>
          )}
        </div>
      </div>

      {isHandoff ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Lessons completed</span>
            <span className="font-medium text-[#0f1e35]">
              {lessonsDone} / {lessonTarget}
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-2 rounded-full ${handedOff ? "bg-gray-400" : "bg-[#22c55e]"}`}
              style={{
                width: `${Math.min(100, (lessonsDone / Math.max(lessonTarget, 1)) * 100)}%`,
              }}
            />
          </div>
          {handedOff ? (
            <p className="mt-2 text-xs text-gray-500">
              Threshold reached — tutor now collects directly.
            </p>
          ) : (
            <p className="mt-2 text-xs text-gray-500">
              {lessonTarget - lessonsDone} lesson
              {lessonTarget - lessonsDone !== 1 ? "s" : ""} until handoff.
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">
            Commission rate: {(placement.commission_rate * 100).toFixed(1)}%
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {placement.ledger_entries?.length > 0 ? (
            placement.ledger_entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs"
              >
                <div className="space-y-0.5">
                  <p className="font-medium text-[#0f1e35]">
                    {formatSGD(entry.gross_amount)} gross
                  </p>
                  <p className="text-gray-500">
                    Agency: {formatSGD(entry.commission_amount)} · Tutor:{" "}
                    {formatSGD(entry.tutor_amount)}
                  </p>
                </div>
                <StatusChip status={entry.status} />
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-400">No ledger entries yet.</p>
          )}
          <p className="text-xs text-gray-400">
            Commission rate: {(placement.commission_rate * 100).toFixed(1)}%
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, accent }) {
  return (
    <div
      className={`rounded-xl border p-4 ${accent ? "border-[#b8e8d9] bg-[#edf6f3]" : "border-gray-200 bg-white"}`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[#0f1e35]">{value}</p>
    </div>
  );
}

export default function AgencyDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [agency, setAgency] = useState(null);
  const [placements, setPlacements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const userType = user?.user_metadata?.user_type;

  useEffect(() => {
    if (!user || userType !== "agency") return;
    load();
  }, [user]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Load agency row
      const { data: agencyRow, error: agencyErr } = await supabase
        .from("agencies")
        .select("id, name, paynow_number")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (agencyErr) throw agencyErr;
      if (!agencyRow) {
        setError("No agency profile found for your account.");
        setLoading(false);
        return;
      }
      setAgency(agencyRow);

      // Load active placements with tutor + student names
      const { data: rawPlacements, error: placementsErr } = await supabase
        .from("agency_placements")
        .select(
          "id, commission_mode, commission_rate, handoff_after_lessons, started_at, ended_at, tutor_id, student_id"
        )
        .eq("agency_id", agencyRow.id)
        .is("ended_at", null)
        .order("started_at", { ascending: false });

      if (placementsErr) throw placementsErr;

      // For each placement, load tutor name, student name, ledger entries,
      // and (for handoff mode) lesson count.
      const enriched = await Promise.all(
        (rawPlacements ?? []).map(async (p) => {
          const [tutorRes, studentRes, ledgerRes, lessonsRes] =
            await Promise.all([
              supabase
                .from("tutors")
                .select("full_name")
                .eq("id", p.tutor_id)
                .maybeSingle(),
              supabase
                .from("students")
                .select("name")
                .eq("id", p.student_id)
                .maybeSingle(),
              p.commission_mode === "ongoing"
                ? supabase
                    .from("agency_ledger_entries")
                    .select(
                      "id, gross_amount, commission_amount, tutor_amount, status"
                    )
                    .eq("placement_id", p.id)
                    .order("created_at", { ascending: false })
                : Promise.resolve({ data: [] }),
              p.commission_mode === "handoff_after_n"
                ? supabase
                    .from("lessons")
                    .select("id", { count: "exact", head: true })
                    .eq("student_id", p.student_id)
                    .eq("tutor_id", p.tutor_id)
                    .eq("is_completed", true)
                    .gte("lesson_date", p.started_at.slice(0, 10))
                : Promise.resolve({ count: null }),
            ]);

          return {
            ...p,
            tutor_name: tutorRes.data?.full_name ?? "Unknown tutor",
            student_name: studentRes.data?.name ?? "Unknown student",
            ledger_entries: ledgerRes.data ?? [],
            lessons_completed: lessonsRes.count ?? 0,
          };
        })
      );

      setPlacements(enriched);
    } catch (err) {
      console.error("Agency dashboard load error:", err);
      setError("Something went wrong loading your dashboard. Please refresh.");
    } finally {
      setLoading(false);
    }
  }

  // Auth guards
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (userType !== "agency") return <Navigate to="/dashboard" replace />;

  // Summary totals across ongoing placements
  const allLedger = placements.flatMap((p) => p.ledger_entries ?? []);
  const pendingReceivable = allLedger
    .filter((e) => e.status === "pending" || e.status === "collected")
    .reduce((sum, e) => sum + Number(e.gross_amount), 0);
  const pendingPayable = allLedger
    .filter((e) => e.status === "pending" || e.status === "collected")
    .reduce((sum, e) => sum + Number(e.tutor_amount), 0);
  const margin = allLedger
    .filter((e) => e.status === "pending" || e.status === "collected")
    .reduce((sum, e) => sum + Number(e.commission_amount), 0);

  const activePlacements = placements.length;
  const handoffPlacements = placements.filter(
    (p) =>
      p.commission_mode === "handoff_after_n" &&
      (p.lessons_completed ?? 0) >= (p.handoff_after_lessons ?? 0)
  ).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[#0f7a58]">
                Agency Dashboard
              </p>
              <h1 className="mt-0.5 text-xl font-bold text-[#0f1e35]">
                {agency?.name ?? "Loading…"}
              </h1>
            </div>
            <button
              onClick={load}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Summary tiles */}
        {!loading && !error && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile
              label="Active placements"
              value={activePlacements}
              accent
            />
            <SummaryTile
              label="Handed off"
              value={handoffPlacements}
            />
            <SummaryTile
              label="Pending receivable"
              value={formatSGD(pendingReceivable)}
            />
            <SummaryTile
              label="Agency margin"
              value={formatSGD(margin)}
              accent
            />
          </div>
        )}

        {/* Placements */}
        <div>
          <h2 className="mb-3 text-sm font-semibold text-[#0f1e35]">
            Active Placements
          </h2>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-32 animate-pulse rounded-xl bg-gray-100"
                />
              ))}
            </div>
          ) : placements.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-8 text-center">
              <p className="text-sm text-gray-500">
                No active placements yet.
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Placements are added by your admin via the Supabase dashboard.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {placements.map((p) => (
                <PlacementCard key={p.id} placement={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
