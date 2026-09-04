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
import { lessonAmount } from "../lib/paymentMode";

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

const TOTAL_RATES_PER_COMPANY = RATE_CARD_KEYS.length * 2; // 6 rows × 2 (weekday + saturday) = 12

function buildCompletenessMap(allRates) {
  const map = {};
  for (const r of allRates) {
    if (!map[r.company_id]) map[r.company_id] = 0;
    if (r.rate_weekday != null) map[r.company_id]++;
    if (r.rate_saturday != null) map[r.company_id]++;
  }
  return map;
}

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
  const [billingMismatches, setBillingMismatches] = useState([]);
  const [showBillingMismatchDetails, setShowBillingMismatchDetails] = useState(false);
  const [syncingBilling, setSyncingBilling] = useState(false);
  const [rateCard, setRateCard] = useState(emptyRateCard);
  const [rateCardSaving, setRateCardSaving] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [ratesCompleteness, setRatesCompleteness] = useState({});
  const [companyInput, setCompanyInput] = useState("");
  const [companySaving, setCompanySaving] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [editingCompanyName, setEditingCompanyName] = useState("");
  const [deletingCompanyId, setDeletingCompanyId] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [subscriptionPlan, setSubscriptionPlan] = useState(null);
  const [subscriptionId, setSubscriptionId] = useState(null);
  const [periodEnd, setPeriodEnd] = useState(null);
  const [billingAction, setBillingAction] = useState(null); // "cancel" | "switch" | null
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingMessage, setBillingMessage] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [partnerCodeId, setPartnerCodeId] = useState(null);
  const [partnerCodeLabel, setPartnerCodeLabel] = useState(null);
  const [partnerStudentLimit, setPartnerStudentLimit] = useState(null);
  const [partnerCodeInput, setPartnerCodeInput] = useState("");
  const [partnerCodeSaving, setPartnerCodeSaving] = useState(false);
  const [partnerCodeError, setPartnerCodeError] = useState(null);

  const loadGoogleStatus = async () => {
    const { data } = await supabase
      .from("tutors")
      .select("google_calendar_tokens")
      .eq("id", user.id)
      .single();
    setGoogleTutor(data ?? null);
  };

  const handleSavePartnerCode = async () => {
    const upper = partnerCodeInput.trim().toUpperCase();
    if (!upper) return;
    setPartnerCodeSaving(true);
    setPartnerCodeError(null);
    try {
      const { data: codeRow, error: codeErr } = await supabase
        .from("partner_codes")
        .select("id, code, name, student_limit, active")
        .eq("code", upper)
        .maybeSingle();
      // TEMP DEBUG — remove after diagnosis
      console.log("[partner_codes] upper:", upper, "| codeRow:", codeRow, "| codeErr:", codeErr);
      if (codeErr || !codeRow?.active) {
        setPartnerCodeError("Invalid or inactive partner code.");
        return;
      }
      const { error: updateErr } = await supabase
        .from("tutors")
        .update({ partner_code_id: codeRow.id, partner_student_limit: codeRow.student_limit })
        .eq("id", user.id);
      if (updateErr) {
        console.error("Partner code update failed:", updateErr.message, updateErr);
        setPartnerCodeError("Something went wrong. Please try again.");
        return;
      }
      setPartnerCodeId(codeRow.id);
      setPartnerCodeLabel(`${codeRow.code} (${codeRow.name})`);
      setPartnerStudentLimit(codeRow.student_limit);
      setPartnerCodeInput("");
      showToast("Partner code updated.");
    } finally {
      setPartnerCodeSaving(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase
        .from("tutors")
        .select(
          "paynow_number, google_calendar_tokens, notify_lesson_reminders, notify_payment_due, notify_weekly_summary, subscription_status, subscription_plan, stripe_subscription_id, current_period_end, cancel_at_period_end, partner_code_id, partner_student_limit",
        )
        .eq("id", user.id)
        .single();
      if (error) { console.error("Settings load error:", error.message); setError("We couldn't load your settings right now. Try refreshing, or contact support if this continues."); }
      setPaynowNumber(data?.paynow_number ?? "");
      setGoogleTutor(data ?? null);
      setSubscriptionStatus(data?.subscription_status ?? null);
      setSubscriptionPlan(data?.subscription_plan ?? null);
      setSubscriptionId(data?.stripe_subscription_id ?? null);
      setPeriodEnd(data?.current_period_end ?? null);
      setCancelAtPeriodEnd(data?.cancel_at_period_end ?? false);
      setPartnerStudentLimit(data?.partner_student_limit ?? null);
      if (data?.partner_code_id) {
        setPartnerCodeId(data.partner_code_id);
        const { data: codeRow } = await supabase
          .from("partner_codes")
          .select("code, name")
          .eq("id", data.partner_code_id)
          .single();
        if (codeRow) {
          setPartnerCodeLabel(`${codeRow.code} (${codeRow.name})`);
        }
      }
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

      if (!isPractitioner) {
        const { data: invData } = await supabase
          .from("stripe_invoices")
          .select("id, amount_paid, currency, hosted_invoice_url, invoice_pdf, period_start, period_end, created_at")
          .eq("tutor_id", user.id)
          .order("created_at", { ascending: false })
          .limit(24);
        setInvoices(invData ?? []);
      }

      // One-time self-service check: a lesson's own rate_type can drift out
      // of sync with its subject's current billing type (e.g. a bug in an
      // older version of this app, or the tutor changing a subject's
      // billing type after lessons under it were already scheduled). Flag
      // any mismatch so the tutor can review and correct it themselves --
      // skipping anything already part of a paid cycle, since that's
      // settled history and shouldn't change retroactively.
      if (!isPractitioner) {
        const { data: subjectLessons } = await supabase
          .from("lessons")
          .select(
            "id, student_id, lesson_date, rate, rate_type, duration_minutes, students(name), student_subjects(subject, rate_type), payment_cycles(status)",
          )
          .eq("tutor_id", user.id)
          .not("student_subject_id", "is", null);
        const mismatches = (subjectLessons ?? []).filter(
          (l) =>
            l.student_subjects &&
            l.rate_type !== l.student_subjects.rate_type &&
            l.payment_cycles?.status !== "paid",
        );
        setBillingMismatches(mismatches);
      }

      if (isPractitioner) {
        const [{ data: companiesData }, { data: allRatesData }] = await Promise.all([
          supabase
            .from("practitioner_companies")
            .select("id, name")
            .eq("tutor_id", user.id)
            .order("created_at", { ascending: true }),
          supabase
            .from("practitioner_rates")
            .select("company_id, client_type, consultation_type, rate_weekday, rate_saturday")
            .eq("tutor_id", user.id),
        ]);
        const loadedCompanies = companiesData ?? [];
        setCompanies(loadedCompanies);
        setRatesCompleteness(buildCompletenessMap(allRatesData ?? []));
        if (loadedCompanies.length > 0) {
          const firstId = loadedCompanies[0].id;
          setSelectedCompanyId(firstId);
          const firstCompanyRates = (allRatesData ?? []).filter((r) => r.company_id === firstId);
          if (firstCompanyRates.length) {
            const next = emptyRateCard();
            for (const r of firstCompanyRates) {
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

  const handleSyncBillingTypes = async () => {
    setSyncingBilling(true);
    try {
      const toPerSession = billingMismatches
        .filter((l) => l.student_subjects.rate_type === "per_session")
        .map((l) => l.id);
      const toHourly = billingMismatches
        .filter((l) => l.student_subjects.rate_type === "hourly")
        .map((l) => l.id);

      if (toPerSession.length) {
        const { error } = await supabase
          .from("lessons")
          .update({ rate_type: "per_session" })
          .in("id", toPerSession)
          .eq("tutor_id", user.id);
        if (error) throw error;
      }
      if (toHourly.length) {
        const { error } = await supabase
          .from("lessons")
          .update({ rate_type: "hourly" })
          .in("id", toHourly)
          .eq("tutor_id", user.id);
        if (error) throw error;
      }

      // Re-run the billing calculation for every affected student so any
      // pending amount reflects the corrected billing type immediately,
      // rather than waiting for the next lesson change to trigger it.
      const affectedStudentIds = [
        ...new Set(billingMismatches.map((l) => l.student_id)),
      ];
      for (const studentId of affectedStudentIds) {
        const { error } = await supabase.rpc("recompute_payment_cycles", {
          p_student_id: studentId,
          p_tutor_id: user.id,
        });
        if (error) throw error;
      }

      showToast(
        `Synced billing type for ${billingMismatches.length} ${
          billingMismatches.length === 1
            ? terms.lesson.toLowerCase()
            : terms.lessons.toLowerCase()
        }.`,
      );
      setBillingMismatches([]);
      setShowBillingMismatchDetails(false);
    } catch (err) {
      console.error("handleSyncBillingTypes:", err.message);
      showToast("Couldn't sync billing types. Please try again.", "error");
    } finally {
      setSyncingBilling(false);
    }
  };

  const handleRestoreStudent = async (student) => {
    setRestoringId(student.id);
    const { error } = await supabase
      .from("students")
      .update({ deleted_at: null })
      .eq("id", student.id)
      .eq("tutor_id", user.id);
    setRestoringId(null);
    if (error) {
      console.error("handleRestoreStudent:", error.message);
      showToast("Couldn't restore student. Please try again.", "error");
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
      console.error("handleToggleNotification:", error.message);
      setNotifyPrefs((prev) => ({ ...prev, [key]: !nextValue }));
      showToast("Couldn't save notification preferences. Please try again.", "error");
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
      console.error("handleDisconnectGoogle:", err.message);
      showToast("Couldn't disconnect Google Calendar. Please try again.", "error");
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
      console.error("handleFeedbackSubmit:", error.message);
      showToast("Couldn't send feedback. Please try again.", "error");
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
      console.error("handleSubmit (paynow):", error.message);
      setError("Couldn't save settings. Please try again.");
      showToast("Couldn't save settings. Please try again.", "error");
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
        const isPerSession = lesson.rate_type === "per_session";
        const amount = isPerSession
          ? (lesson.rate ?? null)
          : durationHours != null && lesson.rate != null
            ? durationHours * lesson.rate
            : null;
        return [
          lesson.students?.name ?? "",
          lesson.students?.subject ?? "",
          formatDate(lesson.lesson_date),
          lesson.lesson_time ? formatLessonTime(lesson.lesson_time) : "",
          durationHours != null ? durationHours.toFixed(2) : "",
          isPerSession ? "per session" : "hourly",
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
          "Billing type",
          "Rate (SGD)",
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
      // Recompute completeness from the upserted rows
      setRatesCompleteness((prev) => {
        const filled = rows.reduce((n, r) => n + (r.rate_weekday != null ? 1 : 0) + (r.rate_saturday != null ? 1 : 0), 0);
        return { ...prev, [selectedCompanyId]: filled };
      });
      showToast("Rate card saved.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setRateCardSaving(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!subscriptionId) return;
    setBillingLoading(true);
    setBillingMessage(null);
    try {
      const res = await fetch("/.netlify/functions/cancel-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBillingMessage({ type: "error", text: json.error ?? "Could not cancel subscription." });
        return;
      }
      const endTs = json.currentPeriodEnd;
      const endDate = endTs ? new Date(endTs * 1000).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }) : "the end of your billing period";
      setBillingMessage({ type: "success", text: `Subscription cancelled. You'll keep access until ${endDate}.` });
      setConfirmCancel(false);
    } catch {
      setBillingMessage({ type: "error", text: "Could not cancel subscription. Please try again." });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleSwitchPlan = async () => {
    if (!subscriptionId || !subscriptionPlan) return;
    const newPlan = subscriptionPlan === "monthly" ? "annual" : "monthly";
    setBillingLoading(true);
    setBillingMessage(null);
    setConfirmSwitch(false);
    try {
      const res = await fetch("/.netlify/functions/switch-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, newPlan }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBillingMessage({ type: "error", text: json.error ?? "Could not switch plan." });
        return;
      }
      setBillingMessage({ type: "success", text: `Switched to ${newPlan} plan. Your billing has been updated.` });
      setSubscriptionPlan(newPlan);
    } catch {
      setBillingMessage({ type: "error", text: "Could not switch plan. Please try again." });
    } finally {
      setBillingLoading(false);
    }
  };

  const handleResumeSubscription = async () => {
    if (!subscriptionId) return;
    setBillingLoading(true);
    setBillingMessage(null);
    try {
      const res = await fetch("/.netlify/functions/resume-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setBillingMessage({ type: "error", text: json.error ?? "Could not resume subscription." });
        return;
      }
      setCancelAtPeriodEnd(false);
      setBillingMessage({ type: "success", text: "Subscription resumed. You'll continue to be billed normally." });
    } catch {
      setBillingMessage({ type: "error", text: "Could not resume subscription. Please try again." });
    } finally {
      setBillingLoading(false);
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
                      {(() => {
                        const filled = ratesCompleteness[c.id] ?? 0;
                        const isComplete = filled >= TOTAL_RATES_PER_COMPANY;
                        const isEmpty = filled === 0;
                        const badgeClass = isComplete
                          ? "bg-green-100 text-green-700"
                          : isEmpty
                            ? "bg-red-100 text-red-700"
                            : "bg-amber-100 text-amber-700";
                        return (
                          <span className={`flex-none rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>
                            {filled}/{TOTAL_RATES_PER_COMPANY} rates
                          </span>
                        );
                      })()}
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

      {!isPractitioner && billingMismatches.length > 0 && (
        <section className="space-y-3 rounded-md border border-amber-200 bg-amber-50 p-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              ⚠️ Billing type check
            </h2>
            <p className="mt-1 text-sm text-gray-700">
              We found {billingMismatches.length}{" "}
              {billingMismatches.length === 1
                ? terms.lesson.toLowerCase()
                : terms.lessons.toLowerCase()}{" "}
              where the stored billing type doesn&apos;t match the subject&apos;s
              current setting. This can happen if a subject&apos;s billing type
              was changed (hourly ↔ per-session) after {billingMismatches.length === 1 ? "it was" : "they were"} already
              scheduled. Syncing corrects the amount owed for these{" "}
              {terms.lessons.toLowerCase()} only — anything already marked paid
              is never changed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowBillingMismatchDetails((v) => !v)}
            className="text-sm font-medium text-[#1b2d4f] underline"
          >
            {showBillingMismatchDetails ? "Hide details" : "Show details"}
          </button>
          {showBillingMismatchDetails && (
            <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto rounded-md border border-gray-200 bg-white">
              {billingMismatches.map((l) => {
                const correctType = l.student_subjects.rate_type;
                const oldAmount = lessonAmount(l, null);
                const newAmount = lessonAmount(
                  { ...l, rate_type: correctType },
                  null,
                );
                return (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium text-gray-900">
                        {l.students?.name ?? "—"}
                      </span>
                      <span className="ml-2 text-xs text-gray-500">
                        {formatDate(l.lesson_date)} · {l.student_subjects.subject}
                      </span>
                    </div>
                    <span className="flex-none text-xs text-gray-600">
                      ${Number(oldAmount).toFixed(2)} → ${Number(newAmount).toFixed(2)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={handleSyncBillingTypes}
            disabled={syncingBilling}
            className="min-h-11 rounded-md bg-[#1b2d4f] px-4 text-sm font-semibold text-white transition hover:bg-[#14213d] disabled:opacity-50"
          >
            {syncingBilling
              ? "Syncing..."
              : `Sync ${billingMismatches.length} ${
                  billingMismatches.length === 1
                    ? terms.lesson.toLowerCase()
                    : terms.lessons.toLowerCase()
                }`}
          </button>
        </section>
      )}

      {!isPractitioner && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Subscription</h2>

          {(subscriptionStatus === "active" || subscriptionStatus === "trialing") && cancelAtPeriodEnd ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Cancels {periodEnd ? new Date(periodEnd).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }) : "at period end"}
                </span>
                <span className="text-sm text-gray-700 capitalize">
                  {subscriptionPlan ?? "—"} plan
                </span>
              </div>

              <p className="text-sm text-gray-600">
                Your plan will cancel on{" "}
                <strong>
                  {periodEnd
                    ? new Date(periodEnd).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })
                    : "the end of your billing period"}
                </strong>
                . You'll keep full access until then.
              </p>

              {billingMessage && (
                <p className={`text-sm ${billingMessage.type === "error" ? "text-red-600" : "text-[#0f7a58]"}`}>
                  {billingMessage.text}
                </p>
              )}

              <button
                type="button"
                onClick={handleResumeSubscription}
                disabled={billingLoading}
                className="min-h-10 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#243d6b] disabled:opacity-60"
              >
                {billingLoading ? "Resuming..." : "Resume subscription"}
              </button>
            </>
          ) : subscriptionStatus === "active" || subscriptionStatus === "trialing" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d6ede6] px-2.5 py-0.5 text-xs font-medium text-[#1b2d4f]">
                  ✓ {subscriptionStatus === "trialing" ? "Trial" : "Active"}
                </span>
                <span className="text-sm text-gray-700 capitalize">
                  {subscriptionPlan ?? "—"} plan
                </span>
                {periodEnd && (
                  <span className="text-sm text-gray-500">
                    · Renews {new Date(periodEnd).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}
                    {subscriptionPlan === "monthly" ? " — SGD 9.99 will be charged" : subscriptionPlan === "annual" ? " — SGD 59.99 will be charged" : ""}
                  </span>
                )}
              </div>

              {billingMessage && (
                <p className={`text-sm ${billingMessage.type === "error" ? "text-red-600" : "text-[#0f7a58]"}`}>
                  {billingMessage.text}
                </p>
              )}

              {confirmSwitch ? (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-sm text-gray-800 font-medium">
                    Switch to {subscriptionPlan === "monthly" ? "annual" : "monthly"} plan?{" "}
                    {subscriptionPlan === "monthly"
                      ? "You'll be charged a prorated amount today and save with annual billing."
                      : "Your billing will switch to monthly at the next cycle."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSwitchPlan}
                      disabled={billingLoading}
                      className="min-h-10 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#243d6b] disabled:opacity-60"
                    >
                      {billingLoading ? "Switching..." : `Confirm switch to ${subscriptionPlan === "monthly" ? "annual" : "monthly"}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmSwitch(false)}
                      disabled={billingLoading}
                      className="min-h-10 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      Keep current plan
                    </button>
                  </div>
                </div>
              ) : confirmCancel ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 space-y-3">
                  <p className="text-sm text-red-800 font-medium">
                    Are you sure you want to cancel?{" "}
                    {periodEnd
                      ? `You'll keep access until ${new Date(periodEnd).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" })}.`
                      : "You'll keep access until the end of your billing period."}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleCancelSubscription}
                      disabled={billingLoading}
                      className="min-h-10 rounded-md bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
                    >
                      {billingLoading ? "Cancelling..." : "Yes, cancel"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmCancel(false)}
                      disabled={billingLoading}
                      className="min-h-10 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-60"
                    >
                      Keep subscription
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => { setBillingMessage(null); setConfirmSwitch(true); }}
                    disabled={billingLoading || !subscriptionPlan}
                    className="min-h-10 rounded-md border border-gray-300 px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-60"
                  >
                    {`Switch to ${subscriptionPlan === "monthly" ? "annual" : "monthly"} plan`}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setBillingMessage(null); setConfirmCancel(true); }}
                    disabled={billingLoading}
                    className="min-h-10 rounded-md border border-red-200 px-4 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
                  >
                    Cancel subscription
                  </button>
                </div>
              )}
            </>
          ) : subscriptionStatus === "grandfathered" ? (
            <p className="text-sm text-gray-600">
              You have free access as an early user. No subscription required.
            </p>
          ) : subscriptionStatus === "past_due" ? (
            <p className="text-sm text-red-700">
              Your payment is past due — please update your payment method in Stripe to keep access.
            </p>
          ) : subscriptionStatus === "canceled" ? (
            <p className="text-sm text-gray-600">
              Your subscription has been cancelled. Subscribe again to continue using ChopeAndPay.
            </p>
          ) : (
            <p className="text-sm text-gray-600">
              No active subscription. Go to the{" "}
              <Link to="/" className="font-medium text-[#0f7a58] underline">
                dashboard
              </Link>{" "}
              to subscribe.
            </p>
          )}

          <div className="border-t border-gray-100 pt-4 space-y-2">
            <p className="text-sm font-medium text-gray-700">Partner code</p>
            {partnerCodeLabel && (
              <p className="text-sm text-gray-600">
                Current: <span className="font-medium">{partnerCodeLabel}</span>
                {partnerStudentLimit != null && (
                  <span className="text-gray-400"> · {partnerStudentLimit} free student slots</span>
                )}
              </p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={partnerCodeInput}
                onChange={(e) => { setPartnerCodeInput(e.target.value); setPartnerCodeError(null); }}
                placeholder={partnerCodeLabel ? "Enter new code to change" : "e.g. CHOPE"}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#5ecfaa] focus:outline-none focus:ring-1 focus:ring-[#5ecfaa]"
              />
              <button
                type="button"
                onClick={handleSavePartnerCode}
                disabled={partnerCodeSaving || !partnerCodeInput.trim()}
                className="min-h-10 rounded-md bg-[#1b2d4f] px-4 text-sm font-medium text-white transition hover:bg-[#243d6b] disabled:opacity-60"
              >
                {partnerCodeSaving ? "Saving…" : "Apply"}
              </button>
            </div>
            {partnerCodeError && (
              <p className="text-xs text-red-600">{partnerCodeError}</p>
            )}
          </div>
        </section>
      )}

      {!isPractitioner && invoices.length > 0 && (
        <section className="space-y-4 rounded-md border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">Billing history</h2>
          <ul className="divide-y divide-gray-100">
            {invoices.map((inv) => {
              const amount = `SGD ${(inv.amount_paid / 100).toFixed(2)}`;
              const date = inv.period_start
                ? new Date(inv.period_start).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" })
                : new Date(inv.created_at).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" });
              const link = inv.hosted_invoice_url ?? inv.invoice_pdf ?? null;
              return (
                <li key={inv.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{amount}</p>
                    <p className="text-xs text-gray-500">{date}</p>
                  </div>
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-[#0f7a58] hover:underline"
                    >
                      View invoice
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

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
          see your students/clients and earnings. The developer does not access
          individual tutor/practitioner data. Read our Privacy Policy for full details.
        </p>
      </section>
    </AppShell>
  );
}
