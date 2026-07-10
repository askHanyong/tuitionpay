import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { useTerms } from "../contexts/TerminologyContext";
import AppShell from "../components/AppShell";
import {
  buildGoogleAuthUrl,
  disconnectGoogleCalendar,
  isGoogleConnected,
} from "../lib/googleCalendar";
import { formatDate } from "../utils/dateFormat";
import { formatLessonTime } from "../lib/date";

const CSV_COLUMN_SEPARATOR = ",";

function csvEscape(value) {
  const str = value == null ? "" : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers, rows) {
  const lines = [headers.map(csvEscape).join(CSV_COLUMN_SEPARATOR)];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(CSV_COLUMN_SEPARATOR));
  }
  return lines.join("\n");
}

function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function todayFilenameSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatAmount(value) {
  if (value == null) return "";
  return Number(value).toFixed(2);
}

const RATE_CARD_KEYS = [
  { client_type: "paediatric", consultation_type: "initial" },
  { client_type: "paediatric", consultation_type: "subsequent" },
  { client_type: "adult", consultation_type: "initial" },
  { client_type: "adult", consultation_type: "subsequent" },
  { client_type: "other", consultation_type: "initial" },
  { client_type: "other", consultation_type: "subsequent" },
];

const CLIENT_TYPE_ROWS = [
  { client_type: "paediatric", label: "Paediatric" },
  { client_type: "adult",      label: "Adult" },
  { client_type: "other",      label: "Other" },
];

const emptyRateCard = () =>
  Object.fromEntries(
    RATE_CARD_KEYS.map(({ client_type, consultation_type }) => [
      `${client_type}_${consultation_type}`,
      { rate_weekday: "", rate_saturday: "" },
    ]),
  );

export default function Settings() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const terms = useTerms();
  const isPractitioner = user?.user_metadata?.user_type === "practitioner";

  const NOTIFICATION_TYPES = [
    {
      key: "notify_lesson_reminders",
      label: `Pre-${terms.lesson.toLowerCase()} reminders`,
      description: `Notify me 30 minutes before each scheduled ${terms.lesson.toLowerCase()}.`,
    },
    {
      key: "notify_payment_due",
      label: "Payment due",
      description: `Notify me as soon as a ${terms.student.toLowerCase()} completes their 4th ${terms.lesson.toLowerCase()}.`,
    },
    {
      key: "notify_weekly_summary",
      label: "Weekly summary",
      description: "Notify me every Sunday at 8pm with a summary of the week.",
    },
  ];
  const [paynowNumber, setPaynowNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [googleTutor, setGoogleTutor] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [exportingLessons, setExportingLessons] = useState(false);
  const [exportingPayments, setExportingPayments] = useState(false);
  const [notifyPrefs, setNotifyPrefs] = useState({
    notify_lesson_reminders: true,
    notify_payment_due: true,
    notify_weekly_summary: true,
  });
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackDone, setFeedbackDone] = useState(false);
  const [deletedStudents, setDeletedStudents] = useState([]);
  const [restoringId, setRestoringId] = useState(null);
  const [rateCard, setRateCard] = useState(emptyRateCard);
  const [rateCardSaving, setRateCardSaving] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [companyInput, setCompanyInput] = useState("");
  const [companySaving, setCompanySaving] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [deletingCompanyId, setDeletingCompanyId] = useState(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);

  const loadGoogleStatus = async () => {
    const { data } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", user.id)
      .single();
    setGoogleTutor(data ?? null);
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("tutors")
        .select(
          "paynow_number, google_calendar_tokens, notify_lesson_reminders, notify_payment_due, notify_weekly_summary",
        )
        .eq("id", user.id)
        .single();
      if (error) setError(error.message);
      setPaynowNumber(data?.paynow_number ?? "");
      setGoogleTutor(data ?? null);
      if (data) {
        setNotifyPrefs({
          notify_lesson_reminders: data.notify_lesson_reminders,
          notify_payment_due: data.notify_payment_due,
          notify_weekly_summary: data.notify_weekly_summary,
        });
      }
      setLoading(false);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: deleted } = await supabase
        .from("students")
        .select("id, name, archived, deleted_at")
        .eq("tutor_id", user.id)
        .not("deleted_at", "is", null)
        .gte("deleted_at", thirtyDaysAgo)
        .order("deleted_at", { ascending: false });
      setDeletedStudents(deleted ?? []);

      if (isPractitioner) {
        const { data: companiesData } = await supabase
          .from("practitioner_companies")
          .select("id, name")
          .eq("tutor_id", user.id)
          .order("created_at", { ascending: true });
        const loadedCompanies = companiesData ?? [];
        setCompanies(loadedCompanies);
        if (loadedCompanies.length > 0) {
          const firstId = loadedCompanies[0].id;
          setSelectedCompanyId(firstId);
          const { data: rates } = await supabase
            .from("practitioner_rates")
            .select("client_type, consultation_type, rate_weekday, rate_saturday")
            .eq("tutor_id", user.id)
            .eq("company_id", firstId);
          if (rates?.length) {
            const next = emptyRateCard();
            for (const r of rates) {
              const key = `${r.client_type}_${r.consultation_type}`;
              if (next[key]) next[key] = { rate_weekday: r.rate_weekday ?? "", rate_saturday: r.rate_saturday ?? "" };
            }
            setRateCard(next);
          }
        }
      }
    };
    load();
  }, [user.id, isPractitioner]);

  const handleRestoreStudent = async (student) => {
    setRestoringId(student.id);
    const { error } = await supabase
      .from("students")
      .update({ deleted_at: null })
      .eq("id", student.id)
      .eq("tutor_id", user.id);
    setRestoringId(null);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setDeletedStudents((prev) => prev.filter((s) => s.id !== student.id));
    showToast(`${student.name} restored.`);
  };

  const handleToggleNotification = async (key) => {
    const nextValue = !notifyPrefs[key];
    setNotifyPrefs((prev) => ({ ...prev, [key]: nextValue }));
    const { error } = await supabase
      .from("tutors")
      .update({ [key]: nextValue })
      .eq("id", user.id);
    if (error) {
      setNotifyPrefs((prev) => ({ ...prev, [key]: !nextValue }));
      showToast(error.message, "error");
      return;
    }
    showToast("Notification preferences saved.");
  };

  const handleConnectGoogle = () => {
    window.location.href = buildGoogleAuthUrl();
  };

  const handleDisconnectGoogle = async () => {
    setDisconnecting(true);
    try {
      await disconnectGoogleCalendar(user.id);
      await loadGoogleStatus();
      showToast("Google Calendar disconnected.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setDisconnecting(false);
    }
  };

  const googleConnected = isGoogleConnected(googleTutor);
  const googleEmail = googleTutor?.google_calendar_tokens?.email;

  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    setFeedbackSubmitting(true);
    const { error } = await supabase
      .from("feedback")
      .insert({ tutor_id: user.id, message: feedbackText.trim() });
    setFeedbackSubmitting(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setFeedbackDone(true);
    setFeedbackText("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const { error } = await supabase
      .from("tutors")
      .update({ paynow_number: paynowNumber.trim() || null })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      setError(error.message);
      showToast(error.message, "error");
      return;
    }
    showToast("Settings saved.");
  };

  const handleExportLessons = async () => {
    setExportingLessons(true);
    try {
      const { data, error } = await supabase
        .from("lessons")
        .select("*, students(name, subject)")
        .eq("tutor_id", user.id)
        .order("lesson_date", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []).map((lesson) => {
        const durationHours = lesson.duration_minutes
          ? lesson.duration_minutes / 60
          : null;
        const amount =
          durationHours != null && lesson.rate != null
            ? durationHours * lesson.rate
            : null;
        return [
          lesson.students?.name ?? "",
          lesson.students?.subject ?? "",
          formatDate(lesson.lesson_date),
          lesson.lesson_time ? formatLessonTime(lesson.lesson_time) : "",
          durationHours != null ? durationHours.toFixed(2) : "",
          formatAmount(lesson.rate),
          formatAmount(amount),
          lesson.status ?? "",
          lesson.notes ?? "",
          lesson.payment_cycle_id ?? "",
        ];
      });

      const csv = toCSV(
        [
          `${terms.student} name`,
          "Subject",
          `${terms.lesson} date`,
          `${terms.lesson} time`,
          "Duration (hrs)",
          "Rate (SGD/hr)",
          "Amount (SGD)",
          "Status",
          "Notes",
          "Payment cycle ID",
        ],
        rows,
      );
      downloadCSV(`chopeandpay_${terms.lessons.toLowerCase()}_${todayFilenameSuffix()}.csv`, csv);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setExportingLessons(false);
    }
  };

  const handleExportPayments = async () => {
    setExportingPayments(true);
    try {
      const { data, error } = await supabase
        .from("payment_cycles")
        .select("*, students(name)")
        .eq("tutor_id", user.id)
        .order("period_start", { ascending: true });
      if (error) throw error;

      const rows = (data ?? []).map((cycle) => [
        cycle.students?.name ?? "",
        formatDate(cycle.period_start),
        formatDate(cycle.period_end),
        formatAmount(cycle.amount_due),
        cycle.status ?? "",
        cycle.paid_at ? formatDate(cycle.paid_at) : "",
      ]);

      const csv = toCSV(
        [
          `${terms.student} name`,
          "Period start",
          "Period end",
          "Amount due (SGD)",
          "Status",
          "Paid at",
        ],
        rows,
      );
      downloadCSV(`chopeandpay_payments_${todayFilenameSuffix()}.csv`, csv);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setExportingPayments(false);
    }
  };

  const handleAddCompany = async (e) => {
    e.preventDefault();
    const name = companyInput.trim();
    if (!name) return;
    setCompanySaving(true);
    const { data, error } = await supabase
      .from("practitioner_companies")
      .insert({ tutor_id: user.id, name })
      .select("id, name")
      .single();
    setCompanySaving(false);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setCompanies((prev) => [...prev, data]);
    setCompanyInput("");
    showToast("Company added.");
  };

  const handleStartEditCompany = (company) => {
    setEditingCompany(company.id);
    setEditingCompanyName(company.name);
  };

  const handleSaveEditCompany = async (id) => {
    const name = editingCompanyName.trim();
    if (!name) return;
    const { error } = await supabase
      .from("practitioner_companies")
      .update({ name })
      .eq("id", id)
      .eq("tutor_id", user.id);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setCompanies((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    setEditingCompany(null);
    showToast("Company updated.");
  };

  const handleDeleteCompany = async (id) => {
    setDeletingCompanyId(id);
    const { error } = await supabase
      .from("practitioner_companies")
      .delete()
      .eq("id", id)
      .eq("tutor_id", user.id);
    setDeletingCompanyId(null);
    if (error) {
      showToast(error.message, "error");
      return;
    }
    setCompanies((prev) => prev.filter((c) => c.id !== id));
    showToast("Company deleted.");
  };

  const handleSelectCompany = async (companyId) => {
    setSelectedCompanyId(companyId);
    setRateCard(emptyRateCard());
    if (!companyId) return;
    const { data: rates } = await supabase
      .from("practitioner_rates")
      .select("client_type, consultation_type, rate_weekday, rate_saturday")
      .eq("tutor_id", user.id)
      .eq("company_id", companyId);
    if (rates?.length) {
      const next = emptyRateCard();
      for (const r of rates) {
        const key = `${r.client_type}_${r.consultation_type}`;
        if (next[key]) next[key] = { rate_weekday: r.rate_weekday ?? "", rate_saturday: r.rate_saturday ?? "" };
      }
      setRateCard(next);
    }
  };

  const handleSaveRateCard = async (e) => {
    e.preventDefault();
    if (!selectedCompanyId) {
      showToast("Please select a company first.", "error");
      return;
    }
    setRateCardSaving(true);
    try {
      const rows = RATE_CARD_KEYS.map(({ client_type, consultation_type }) => {
        const cell = rateCard[`${client_type}_${consultation_type}`];
        return {
          tutor_id: user.id,
          company_id: selectedCompanyId,
          client_type,
          consultation_type,
          rate_weekday: cell.rate_weekday === "" ? null : Number(cell.rate_weekday),
          rate_saturday: cell.rate_saturday === "" ? null : Number(cell.rate_saturday),
        };
      });
      const { error } = await supabase
        .from("practitioner_rates")
        .upsert(rows, { onConflict: "tutor_id,company_id,client_type,consultation_type" });
      if (error) throw error;
      showToast("Rate card saved.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setRateCardSaving(false);
    }
  };

  return (
    <AppShell>
      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-md border border-gray-200 bg-white p-5"
      >
        <h2 className="text-base font-semibold text-gray-900">
          Payment settings
        </h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            PayNow number or UEN
          </label>
          <input
            type="text"
            value={paynowNumber}
            onChange={(e) => setPaynowNumber(e.target.value)}
            placeholder="e.g. 9123 4567"
            disabled={loading}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
          />
          <p className="mt-1 text-xs text-gray-500">
            Shown automatically in WhatsApp payment request messages.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || saving}
          className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </form>

      {isPractitioner && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Companies</h2>
            <p className="mt-1 text-sm text-gray-500">
              Each company has its own rate card. Add a company before setting up rates or adding clients.
            </p>
          </div>

          {companies.length === 0 ? (
            <p className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-500">
              No companies yet. Add your first company below.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {companies.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  {editingCompany === c.id ? (
                    <>
                      <input
                        type="text"
                        value={editingCompanyName}
                        onChange={(e) => setEditingCompanyName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.preventDefault(); handleSaveEditCompany(c.id); }
                          if (e.key === "Escape") setEditingCompany(null);
                        }}
                        autoFocus
                        className="min-h-9 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEditCompany(c.id)}
                        className="flex-none rounded-md bg-[#1b2d4f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#15243f]"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCompany(null)}
                        className="flex-none rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm font-medium text-gray-900">{c.name}</span>
                      <button
                        type="button"
                        onClick={() => handleStartEditCompany(c)}
                        className="flex-none rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCompany(c.id)}
                        disabled={deletingCompanyId === c.id}
                        className="flex-none rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deletingCompanyId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleAddCompany} className="flex gap-2">
            <input
              type="text"
              value={companyInput}
              onChange={(e) => setCompanyInput(e.target.value)}
              placeholder="Company name"
              className="min-h-11 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
            />
            <button
              type="submit"
              disabled={companySaving || !companyInput.trim()}
              className="min-h-11 flex-none rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
            >
              {companySaving ? "Adding…" : "Add"}
            </button>
          </form>
        </section>
      )}

      {isPractitioner && (
        <form
          onSubmit={handleSaveRateCard}
          className="space-y-5 rounded-md border border-gray-200 bg-white p-5"
        >
          <div>
            <h2 className="text-base font-semibold text-gray-900">Rate card</h2>
            <p className="mt-1 text-sm text-gray-500">
              Set your consultation rates (SGD) by client type and day. These will be used to auto-fill session fees.
            </p>
          </div>

          {companies.length === 0 ? (
            <p className="rounded-md bg-gray-50 px-4 py-3 text-sm text-gray-500">
              Add a company in the <strong>Companies</strong> section above before setting up rates.
            </p>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Company</label>
              <select
                value={selectedCompanyId ?? ""}
                onChange={(e) => handleSelectCompany(e.target.value)}
                className="min-h-10 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa] sm:w-64"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          {companies.length > 0 && <>
          {/* Column headers */}
          <div className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <span />
            <span className="text-center">Initial</span>
            <span className="text-center">Follow-up</span>
          </div>

          {CLIENT_TYPE_ROWS.map(({ client_type, label }) => (
            <div key={client_type} className="grid grid-cols-[auto_1fr_1fr] items-start gap-x-4 gap-y-3">
              <span className="mt-2 w-20 text-sm font-medium text-gray-700">{label}</span>

              {["initial", "subsequent"].map((consultation_type) => {
                const key = `${client_type}_${consultation_type}`;
                const cell = rateCard[key];
                return (
                  <div key={consultation_type} className="space-y-2 rounded-md border border-gray-100 bg-gray-50 p-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-500">Weekday (SGD)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="—"
                          value={cell.rate_weekday}
                          onChange={(e) =>
                            setRateCard((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], rate_weekday: e.target.value },
                            }))
                          }
                          className="min-h-10 w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-500">Saturday (SGD)</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="—"
                          value={cell.rate_saturday}
                          onChange={(e) =>
                            setRateCard((prev) => ({
                              ...prev,
                              [key]: { ...prev[key], rate_saturday: e.target.value },
                            }))
                          }
                          className="min-h-10 w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          <button
            type="submit"
            disabled={rateCardSaving || !selectedCompanyId}
            className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
          >
            {rateCardSaving ? "Saving..." : "Save rate card"}
          </button>
          </>}
        </form>
      )}

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Google Calendar
        </h2>
        <p className="text-sm text-gray-600">
          {googleConnected
            ? `Connected. ${terms.lessons} you log will automatically be added to your Google Calendar.`
            : `Connect your Google Calendar so every ${terms.lesson.toLowerCase()} you log is added automatically.`}
        </p>
        {googleConnected ? (
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d6ede6] px-2.5 py-0.5 text-xs font-medium text-[#1b2d4f]">
              ✓ Connected{googleEmail ? ` as ${googleEmail}` : ""}
            </span>
            <button
              onClick={handleDisconnectGoogle}
              disabled={disconnecting}
              className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <button
            onClick={handleConnectGoogle}
            className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow"
          >
            Connect Google Calendar
          </button>
        )}
      </section>

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Notifications</h2>
        <ul className="divide-y divide-gray-100">
          {NOTIFICATION_TYPES.map((type) => (
            <li
              key={type.key}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {type.label}
                </p>
                <p className="text-xs text-gray-500">{type.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifyPrefs[type.key]}
                onClick={() => handleToggleNotification(type.key)}
                disabled={loading}
                className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full transition disabled:opacity-50 ${
                  notifyPrefs[type.key] ? "bg-[#1b2d4f]" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                    notifyPrefs[type.key] ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Send feedback</h2>
        {feedbackDone ? (
          <div className="flex items-center gap-2 rounded-md bg-[#edf6f3] px-4 py-3 text-sm font-medium text-[#0f7a58]">
            ✅ Thanks for your feedback! It helps us improve ChopeAndPay.
          </div>
        ) : (
          <form onSubmit={handleFeedbackSubmit} className="space-y-3">
            <textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Got a suggestion or found a bug? Tell us anything — we read every message."
              rows={4}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
            />
            <button
              type="submit"
              disabled={feedbackSubmitting || !feedbackText.trim()}
              className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#15243f] hover:shadow disabled:opacity-50"
            >
              {feedbackSubmitting ? "Sending..." : "Submit feedback"}
            </button>
          </form>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">
          Export my data
        </h2>
        <p className="text-sm text-gray-600">
          Download your {terms.lesson.toLowerCase()} and payment history as CSV files.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleExportLessons}
            disabled={exportingLessons}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {exportingLessons ? "Preparing..." : `📥 Download ${terms.lessons.toLowerCase()}`}
          </button>
          <button
            type="button"
            onClick={handleExportPayments}
            disabled={exportingPayments}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
          >
            {exportingPayments ? "Preparing..." : "📥 Download payments"}
          </button>
        </div>
        <p className="text-xs text-gray-500">
          Your data is exported as CSV, compatible with Excel and Google Sheets
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-5">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Recently deleted</h2>
          <p className="mt-1 text-xs text-gray-500">
            {terms.students} deleted in the last 30 days. Tap Restore to bring them back.
          </p>
        </div>
        {deletedStudents.length === 0 ? (
          <p className="text-sm text-gray-400">No recently deleted {terms.students.toLowerCase()}.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {deletedStudents.map((s) => {
              const deletedAgo = (() => {
                const ms = Date.now() - new Date(s.deleted_at).getTime();
                const mins = Math.floor(ms / 60000);
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                return `${Math.floor(hrs / 24)}d ago`;
              })();
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{s.name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      Deleted {deletedAgo}
                      {s.archived && " · was archived"}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={restoringId === s.id}
                    onClick={() => handleRestoreStudent(s)}
                    className="flex-none rounded-md border border-[#b8e8d9] bg-[#edf6f3] px-3 py-1.5 text-xs font-semibold text-[#1b2d4f] hover:bg-[#d6ede6] disabled:opacity-50"
                  >
                    {restoringId === s.id ? "Restoring…" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Legal</h2>
        <div className="flex flex-wrap gap-4">
          <Link
            to="/privacy"
            className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms"
            className="text-sm font-medium text-[#5ecfaa] hover:text-[#1b2d4f]"
          >
            Terms of Service
          </Link>
        </div>
        <p className="text-xs text-gray-500">
          <span aria-hidden="true">🔒</span> Your data is private — only you can
          see your students and earnings. The developer does not access
          individual tutor data. Read our Privacy Policy for full details.
        </p>
      </section>
    </AppShell>
  );
}
