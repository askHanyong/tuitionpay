// Month-end close: Singapore-time helpers, the month snapshot, its self-checks
// and the "Before you close" checklist (spec sections 5.7, 6.1, 6.2, 6.4).
//
// Pure: no Supabase calls. buildMonthSnapshot never reads the clock; everything
// it needs (including takenAt) comes in as arguments, so the same inputs always
// give the same snapshot. All money in a snapshot is whole cents.

import { lessonAmount } from "./paymentMode";
import { buildEarningsBreakdown, lessonOrder } from "./collectedBreakdown";
import { buildStatement } from "./statement";
import { formatSGD } from "./paymentNotice";

// Bump whenever buildEarningsBreakdown / lessonAmount / this file changes a figure.
export const CALC_VERSION = 1;
export const TZ = "Asia/Singapore";

// ── 6.1 Singapore time (fixed UTC+8, no daylight saving) ─────────────────────
// toISOString() is correct here: the time is shifted by +8h first and only the
// text is used.
const SGT_MS = 8 * 60 * 60 * 1000;
export const sgtDateKey = (ts) =>
  new Date(new Date(ts).getTime() + SGT_MS).toISOString().slice(0, 10);
export const sgtMonthKey = (ts) => sgtDateKey(ts).slice(0, 7);
export const sgtTodayKey = () => sgtDateKey(Date.now());
export const sgtStamp = () =>
  new Date(Date.now() + SGT_MS).toISOString().slice(0, 19) + "+08:00";

// ── Months ───────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, "0");
const cents = (x) => Math.round((Number(x) || 0) * 100);
const monthOf = (dateStr) => String(dateStr ?? "").slice(0, 7);

export const isMonthStr = (s) =>
  typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

// start / nextStart are "YYYY-MM-DD"; nextStart is exclusive; end is the last day.
export function monthBounds(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const nextMonth = shiftMonth(monthStr, 1);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    start: `${monthStr}-01`,
    nextMonth,
    nextStart: `${nextMonth}-01`,
    end: `${monthStr}-${pad(lastDay)}`,
  };
}

// A month can be closed once it is over in Singapore time.
export const canCloseMonth = (monthStr, todayKey) =>
  todayKey >= monthBounds(monthStr).nextStart;

export const monthLabel = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const monthName = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", {
    month: "long",
    timeZone: "UTC",
  });
};

export const monthShort = (monthStr) => {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-SG", {
    month: "short",
    timeZone: "UTC",
  });
};

// "14 Oct" (adds the year when it differs from `relativeTo`'s year).
export function dayLabel(dateStr, relativeTo) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const sameYear = !relativeTo || relativeTo.slice(0, 4) === String(y);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-SG", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

// ── 4.1 Default month ────────────────────────────────────────────────────────
// Months in which anything happened for a real (non-practice) student: a completed
// lesson, a notice with period_end in it, or a payment / write-off (Singapore date).
export function activityMonths({ students, lessons, cycles }) {
  const real = new Set(students.filter((s) => !s.is_practice).map((s) => s.id));
  const active = new Set();
  for (const l of lessons) {
    if (l.is_completed && real.has(l.student_id)) active.add(monthOf(l.lesson_date));
  }
  for (const c of cycles) {
    if (!real.has(c.student_id)) continue;
    active.add(monthOf(c.period_end));
    if (c.status === "paid" && c.paid_at) active.add(sgtMonthKey(c.paid_at));
    if (c.status === "waived" && c.waived_at) active.add(sgtMonthKey(c.waived_at));
  }
  return active;
}

const closedMonthSet = (closes) =>
  new Set(closes.filter((c) => c.status === "closed").map((c) => monthOf(c.month)));

// Oldest month in the previous 12 that had activity and is not closed; if none,
// the previous month. "Closed" means status 'closed' (a reopened month is open).
export function pickDefaultMonth({ todayKey, students, lessons, cycles, closes }) {
  const prev = shiftMonth(todayKey.slice(0, 7), -1);
  const active = activityMonths({ students, lessons, cycles });
  const closed = closedMonthSet(closes);
  for (let i = 11; i >= 0; i--) {
    const m = shiftMonth(prev, -i);
    if (active.has(m) && !closed.has(m)) return m;
  }
  return prev;
}

// 6.9: the oldest earlier month (within the previous 12) that had activity and is
// not closed, or null. Only a gentle hint, never blocking.
export function findEarlierUnclosedMonth({ todayKey, monthStr, students, lessons, cycles, closes }) {
  const prev = shiftMonth(todayKey.slice(0, 7), -1);
  const active = activityMonths({ students, lessons, cycles });
  const closed = closedMonthSet(closes);
  for (let i = 11; i >= 0; i--) {
    const m = shiftMonth(prev, -i);
    if (m >= monthStr) break;
    if (active.has(m) && !closed.has(m)) return m;
  }
  return null;
}

// ── 6.2 Snapshot ─────────────────────────────────────────────────────────────
export function buildMonthSnapshot({
  monthStr,
  students,
  payees,
  lessons,
  cycles,
  statements = [],
  carried = [],
  takenAt,
}) {
  const { nextStart } = monthBounds(monthStr);
  const [y, m] = monthStr.split("-").map(Number);

  // 1. Practice students out; archived and deleted stay in.
  const real = students.filter((s) => !s.is_practice);
  const realById = new Map(real.map((s) => [s.id, s]));
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));
  const myLessons = lessons.filter((l) => realById.has(l.student_id));
  const myCycles = cycles.filter((c) => realById.has(c.student_id));

  // 2. Completed lessons up to the end of the month (history drains placement fees).
  const completed = myLessons.filter((l) => l.is_completed && l.lesson_date < nextStart);

  // 3. The existing breakdown, unchanged.
  const monthDate = new Date(y, m - 1, 1);
  const bd = buildEarningsBreakdown({ monthDate, students: real, payees, lessons: completed });

  // 4. Set-up B commission (tutor collected, then paid the agency).
  let commissionBCents = 0;
  for (const a of bd.agencies) {
    for (const line of a.lines) {
      if (line.collectedBy === "me") commissionBCents += line.cents;
    }
  }
  const grossCents = cents(bd.total);
  const mineCents = cents(bd.mine);
  const agencyCents = cents(bd.agencyTotal);

  // 5. Per-student lines: the same function, once per student.
  const completedByStudent = new Map();
  for (const l of completed) {
    if (!completedByStudent.has(l.student_id)) completedByStudent.set(l.student_id, []);
    completedByStudent.get(l.student_id).push(l);
  }
  const monthLessons = completed.filter((l) => monthOf(l.lesson_date) === monthStr);
  const monthLessonCount = new Map();
  for (const l of monthLessons) {
    monthLessonCount.set(l.student_id, (monthLessonCount.get(l.student_id) ?? 0) + 1);
  }
  const studentLines = [];
  for (const s of real) {
    const count = monthLessonCount.get(s.id) ?? 0;
    if (count === 0) continue;
    const sbd = buildEarningsBreakdown({
      monthDate,
      students: [s],
      payees,
      lessons: completedByStudent.get(s.id) ?? [],
    });
    let placement = 0;
    let share = 0;
    let commB = 0;
    for (const a of sbd.agencies) {
      for (const line of a.lines) {
        if (line.kind === "placement") placement += line.cents;
        else {
          share += line.cents;
          if (line.collectedBy === "me") commB += line.cents;
        }
      }
    }
    const payee = s.payee_id ? payeesById.get(s.payee_id) : null;
    studentLines.push({
      student_id: s.id,
      name: s.name,
      archived: Boolean(s.archived),
      deleted: Boolean(s.deleted_at),
      lessons: count,
      gross_cents: cents(sbd.total),
      placement_cents: placement,
      agency_share_cents: share,
      commission_b_cents: commB,
      mine_cents: cents(sbd.mine),
      payee_id: s.payee_id ?? null,
      share_percent: payee ? Number(payee.share_percent ?? 80) : null,
      fee_collected_by: s.fee_collected_by ?? null,
      hourly_rate: s.hourly_rate ?? null,
      placement_fee_amount: s.placement_fee_amount ?? null,
      placement_fee_start: s.placement_fee_start ?? null,
    });
  }
  studentLines.sort(
    (a, b) => a.name.localeCompare(b.name) || a.student_id.localeCompare(b.student_id),
  );

  // 6. Lesson lines.
  const lessonLines = [...monthLessons].sort(lessonOrder).map((l) => ({
    id: l.id,
    student_id: l.student_id,
    date: l.lesson_date,
    minutes: l.duration_minutes ?? null,
    rate: l.rate ?? null,
    rate_type: l.rate_type ?? null,
    amount_cents: cents(lessonAmount(l, realById.get(l.student_id))),
  }));

  // 7. Notices with period_end in the month.
  const inMonthCycles = myCycles.filter((c) => monthOf(c.period_end) === monthStr);
  const sumCycles = (list) => list.reduce((t, c) => t + cents(c.amount_due), 0);
  const noticesPaid = sumCycles(inMonthCycles.filter((c) => c.status === "paid"));
  const noticesPending = sumCycles(
    inMonthCycles.filter((c) => c.status === "pending" || c.status === "overdue"),
  );
  const noticesWaived = sumCycles(inMonthCycles.filter((c) => c.status === "waived"));

  // 8. Cash, by Singapore date of the payment / write-off (any period_end).
  const cashCollected = sumCycles(
    myCycles.filter(
      (c) => c.status === "paid" && c.paid_at && sgtMonthKey(c.paid_at) === monthStr,
    ),
  );
  const cashWrittenOff = sumCycles(
    myCycles.filter(
      (c) => c.status === "waived" && c.waived_at && sgtMonthKey(c.waived_at) === monthStr,
    ),
  );

  // 10. Statement status per agency that has a payee.
  const statementLines = bd.agencies
    .filter((a) => a.payeeId)
    .map((a) => {
      const row = statements.find(
        (s) => s.payee_id === a.payeeId && monthOf(s.month) === monthStr,
      );
      return {
        payee_id: a.payeeId,
        name: a.name,
        status: row ? row.status : "none",
        claimed_total_cents: row && row.claimed_total != null ? cents(row.claimed_total) : null,
        sent_at: row?.sent_at ?? null,
      };
    });

  return {
    month: monthStr,
    calc_version: CALC_VERSION,
    taken_at: takenAt ?? null,
    tz: TZ,
    totals: {
      lessons: monthLessons.length,
      gross_cents: grossCents,
      agency_cents: agencyCents,
      mine_cents: mineCents,
      commission_b_cents: commissionBCents,
      revenue_cents: mineCents + commissionBCents,
      notices_paid_cents: noticesPaid,
      notices_pending_cents: noticesPending,
      notices_waived_cents: noticesWaived,
      cash_collected_cents: cashCollected,
      cash_written_off_cents: cashWrittenOff,
    },
    agencies: bd.agencies.map((a) => ({
      name: a.name,
      payee_id: a.payeeId ?? null,
      share_percent: a.sharePct ?? null,
      cents: a.cents,
      lines: a.lines.map((l) => ({
        kind: l.kind,
        student: l.student,
        collected_by: l.collectedBy ?? null,
        billed_cents: cents(l.billed),
        cents: l.cents,
      })),
    })),
    students: studentLines,
    lessons: lessonLines,
    statements: statementLines,
    carried,
    counts: {
      students_loaded: students.length,
      lessons_loaded: lessons.length,
      cycles_loaded: cycles.length,
    },
  };
}

// Self-checks that must hold before a snapshot is saved. Returns the failed ones
// (empty array = all good).
export function checkSnapshot(snapshot) {
  const failed = [];
  const t = snapshot?.totals;
  if (!t) return [{ id: "shape", message: "Snapshot has no totals." }];
  const sum = (arr, key) => (arr ?? []).reduce((s, x) => s + x[key], 0);
  const need = (id, message, a, b) => {
    if (a !== b) failed.push({ id, message, expected: b, actual: a });
  };

  need("mine_plus_agency", "take-home + agencies = billed", t.mine_cents + t.agency_cents, t.gross_cents);
  need("students_gross", "per-student billed adds up", sum(snapshot.students, "gross_cents"), t.gross_cents);
  need("students_mine", "per-student take-home adds up", sum(snapshot.students, "mine_cents"), t.mine_cents);
  need("lessons_amount", "lesson amounts add up to billed", sum(snapshot.lessons, "amount_cents"), t.gross_cents);
  need("lessons_count", "lesson lines = lessons taught", (snapshot.lessons ?? []).length, t.lessons);
  need("revenue", "revenue = take-home + set-up B commission", t.revenue_cents, t.mine_cents + t.commission_b_cents);

  // Every figure is a finite number, and every cents / count figure is an integer.
  const bad = [];
  const walk = (value, path) => {
    if (typeof value === "number") {
      const isCentsOrCount =
        /(^|\.)(totals|counts)\./.test(path) ||
        /(_cents|\.cents|\.lessons)$/.test(path);
      if (!Number.isFinite(value) || (isCentsOrCount && !Number.isInteger(value))) bad.push(path);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(snapshot, "");
  if (bad.length) {
    failed.push({ id: "integers", message: "Some figures are not whole cents.", actual: bad.slice(0, 10) });
  }
  return failed;
}

// ── 6.4 Checklist ────────────────────────────────────────────────────────────
export const CHECKLIST_TYPES = [
  "undone_lesson",
  "zero_rate_lesson",
  "unpaid_notice",
  "unbilled_student",
  "statement",
];

// Open items for the month on screen. `snapshot` is the live snapshot of that
// month (for the agencies); `closes` are month_closes rows (with snapshot) used
// for the "Carried from" chip and for statements carried out of earlier months.
export function buildChecklist({
  monthStr,
  students,
  payees,
  lessons,
  cycles,
  statements,
  closes,
  upcomingStudentIds,
  snapshot,
}) {
  const { start, end, nextStart } = monthBounds(monthStr);
  const real = students.filter((s) => !s.is_practice);
  const byId = new Map(real.map((s) => [s.id, s]));
  const payeesById = new Map((payees ?? []).map((p) => [p.id, p]));
  const upcoming = upcomingStudentIds ?? new Set();
  const closedBefore = (closes ?? [])
    .filter((c) => c.status === "closed" && monthOf(c.month) < monthStr)
    .sort((a, b) => monthOf(b.month).localeCompare(monthOf(a.month)));

  const base = (student) => ({
    student_id: student?.id ?? null,
    student: student?.name ?? "",
    archived: Boolean(student?.archived),
    deleted: Boolean(student?.deleted_at),
  });
  const items = [];

  const myLessons = lessons.filter((l) => byId.has(l.student_id));
  for (const l of myLessons) {
    const s = byId.get(l.student_id);
    if (!l.is_completed && l.lesson_date <= end) {
      items.push({
        type: "undone_lesson",
        ref_id: l.id,
        ...base(s),
        label: `${s.name} · ${dayLabel(l.lesson_date, start)} · not marked done`,
        amount_cents: cents(lessonAmount(l, s)),
        origin_month: monthOf(l.lesson_date),
        date: l.lesson_date,
        tag: null,
      });
    }
    if (
      l.is_completed &&
      monthOf(l.lesson_date) === monthStr &&
      cents(lessonAmount(l, s)) === 0
    ) {
      items.push({
        type: "zero_rate_lesson",
        ref_id: l.id,
        ...base(s),
        label: `${s.name} · ${dayLabel(l.lesson_date, start)} · no rate set ($0)`,
        amount_cents: 0,
        origin_month: monthStr,
        date: l.lesson_date,
        tag: null,
      });
    }
  }

  for (const c of cycles) {
    const s = byId.get(c.student_id);
    if (!s) continue;
    if ((c.status === "pending" || c.status === "overdue") && c.period_end <= end) {
      items.push({
        type: "unpaid_notice",
        ref_id: c.id,
        ...base(s),
        label: `${s.name} still owes ${formatSGD(Number(c.amount_due))}`,
        amount_cents: cents(c.amount_due),
        origin_month: monthOf(c.period_end),
        tag: c.status === "overdue" ? "Overdue" : "Pending",
      });
    }
  }

  const unbilled = new Map();
  for (const l of myLessons) {
    if (l.is_completed && !l.payment_cycle_id && l.lesson_date <= end) {
      if (!unbilled.has(l.student_id)) unbilled.set(l.student_id, []);
      unbilled.get(l.student_id).push(l);
    }
  }
  for (const [sid, list] of unbilled) {
    const s = byId.get(sid);
    const total = list.reduce((t, l) => t + cents(lessonAmount(l, s)), 0);
    const earliest = list.reduce((min, l) => (l.lesson_date < min ? l.lesson_date : min), list[0].lesson_date);
    items.push({
      type: "unbilled_student",
      ref_id: sid,
      ...base(s),
      label: `${s.name} · ${list.length} lesson${list.length === 1 ? "" : "s"} not billed yet (${formatSGD(total / 100)})`,
      amount_cents: total,
      origin_month: monthOf(earliest),
      lesson_count: list.length,
      tag: upcoming.has(sid) ? null : "no upcoming lessons",
    });
  }

  // Statements: this month's agencies with no statement row, plus statements
  // carried out of earlier closed months that are still not sent.
  const hasStatement = (payeeId, month) =>
    (statements ?? []).some((s) => s.payee_id === payeeId && monthOf(s.month) === month);
  const completedAll = myLessons.filter((l) => l.is_completed && l.lesson_date < nextStart);
  for (const st of snapshot?.statements ?? []) {
    if (st.status !== "none") continue;
    const payee = payeesById.get(st.payee_id);
    let net = null;
    if (payee) {
      const payeeStudents = real.filter((s) => s.payee_id === payee.id);
      const ids = new Set(payeeStudents.map((s) => s.id));
      const stmt = buildStatement({
        payee,
        students: payeeStudents,
        lessons: completedAll.filter((l) => ids.has(l.student_id)),
        range: { start, end: nextStart },
      });
      net = cents(stmt.net);
    }
    items.push({
      type: "statement",
      ref_id: st.payee_id,
      payee_id: st.payee_id,
      ...base(null),
      student: "",
      label:
        net == null
          ? `${st.name} statement not sent yet`
          : `${st.name} statement not sent yet (${net < 0 ? "you owe " : ""}${formatSGD(Math.abs(net) / 100)})`,
      amount_cents: net ?? 0,
      origin_month: monthStr,
      tag: null,
    });
  }
  const seenCarriedStatement = new Set();
  for (const close of closedBefore) {
    for (const c of close.snapshot?.carried ?? []) {
      if (c.type !== "statement") continue;
      const origin = c.origin_month;
      const key = `${c.ref_id}:${origin}`;
      if (!origin || origin >= monthStr || seenCarriedStatement.has(key)) continue;
      seenCarriedStatement.add(key);
      if (hasStatement(c.ref_id, origin)) continue;
      const name = payeesById.get(c.ref_id)?.name ?? "Agency";
      items.push({
        type: "statement",
        ref_id: c.ref_id,
        payee_id: c.ref_id,
        ...base(null),
        student: "",
        label: `${name} statement for ${monthName(origin)} not sent yet (${formatSGD(Math.abs(c.amount_cents ?? 0) / 100)})`,
        amount_cents: c.amount_cents ?? 0,
        origin_month: origin,
        tag: null,
      });
    }
  }

  // Chips: "Carried from <month>" when an earlier closed month carried the same
  // item, otherwise "From <month>" for anything older than this month.
  for (const it of items) {
    it.key = `${it.type}:${it.ref_id}:${it.origin_month}`;
    it.chip = null;
    if (it.origin_month >= monthStr) continue;
    const carrier = closedBefore.find((c) =>
      (c.snapshot?.carried ?? []).some((x) => x.type === it.type && x.ref_id === it.ref_id),
    );
    const sameYear = (m) => m.slice(0, 4) === monthStr.slice(0, 4);
    const named = (m) => (sameYear(m) ? monthName(m) : monthLabel(m));
    it.chip = carrier
      ? `Carried from ${named(monthOf(carrier.month))}`
      : `From ${named(it.origin_month)}`;
  }

  const order = (t) => CHECKLIST_TYPES.indexOf(t);
  items.sort(
    (a, b) =>
      order(a.type) - order(b.type) ||
      a.origin_month.localeCompare(b.origin_month) ||
      a.label.localeCompare(b.label),
  );
  return items;
}

// ── 6.5 Carry forward ────────────────────────────────────────────────────────
// A carry is identified by type + ref_id. Statements also need the month, since
// the same agency can have a statement open for more than one month.
export const carryKey = (x) =>
  x.type === "statement" ? `${x.type}:${x.ref_id}:${x.origin_month}` : `${x.type}:${x.ref_id}`;

// Drop draft entries whose item no longer exists (resolved, or re-created with a
// new id). Never invents entries and removes duplicates.
export function pruneDraft(draft, items) {
  const live = new Set(items.map(carryKey));
  const seen = new Set();
  const out = [];
  for (const d of draft ?? []) {
    if (!d || typeof d.type !== "string" || !d.ref_id) continue;
    const k = carryKey(d);
    if (!live.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push({ type: d.type, ref_id: d.ref_id, origin_month: d.origin_month ?? null });
  }
  return out;
}

export const carriedKeySet = (draft) => new Set((draft ?? []).map(carryKey));
export const unresolvedItems = (items, draft) => {
  const carried = carriedKeySet(draft);
  return items.filter((it) => !carried.has(carryKey(it)));
};

// The entries stored in snapshot.carried at close (5.7).
export const buildCarriedEntries = (items, draft) => {
  const carried = carriedKeySet(draft);
  return items
    .filter((it) => carried.has(carryKey(it)))
    .map((it) => ({
      type: it.type,
      ref_id: it.ref_id,
      student_id: it.student_id ?? null,
      label: it.label,
      amount_cents: it.amount_cents,
      origin_month: it.origin_month,
    }));
};

// ── 4.3 "Pending, carried" ───────────────────────────────────────────────────
// True when there is pending money in the month and every such notice is carried
// (or the month is closed, which required every one to be settled or carried).
export function pendingIsCarried({ monthStr, items, draft, closed, pendingCents }) {
  if (pendingCents <= 0) return false;
  if (closed) return true;
  const carried = carriedKeySet(draft);
  const mine = items.filter((it) => it.type === "unpaid_notice" && it.origin_month === monthStr);
  return mine.length > 0 && mine.every((it) => carried.has(carryKey(it)));
}

// ── 4.9 Error messages ───────────────────────────────────────────────────────
export const BAD_SNAPSHOT_MESSAGE =
  "Something didn't add up, so the month was not closed. Please reload and try again.";
export const STALE_PAGE_MESSAGE =
  "Something changed since you opened this page. Please check the list again.";
export const AFTER_SAVE_MISMATCH_MESSAGE =
  "The month is closed, but the saved figures didn't match what was sent. Please reopen it and close it again.";

// kind: 'already' (treat as success) | 'message'
export function mapCloseError(message, monthStr) {
  const m = String(message ?? "");
  const name = monthName(monthStr);
  if (m.includes("MONTH_ALREADY_CLOSED")) return { kind: "already", text: "" };
  if (m.includes("MONTH_NOT_OVER")) {
    return {
      kind: "message",
      text: `${name} isn't over yet (Singapore time). Try again from 1 ${monthShort(shiftMonth(monthStr, 1))}.`,
    };
  }
  if (m.includes("BAD_SNAPSHOT")) return { kind: "message", text: BAD_SNAPSHOT_MESSAGE };
  return { kind: "message", text: `Couldn't close ${name}: ${m || "unknown error"}. Nothing was changed.` };
}

// kind: 'reason' (stay in the modal) | 'not_closed' (reload) | 'message'
export function mapReopenError(message, monthStr) {
  const m = String(message ?? "");
  if (m.includes("REASON_REQUIRED")) return { kind: "reason", text: "Please add a short reason." };
  if (m.includes("MONTH_NOT_CLOSED")) return { kind: "not_closed", text: "" };
  return {
    kind: "message",
    text: `Couldn't reopen ${monthName(monthStr)}: ${m || "unknown error"}. Nothing was changed.`,
  };
}

// Compare the totals sent with the totals read back (jsonb does not keep key order).
export function sameTotals(a, b) {
  if (!a || !b) return false;
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => Number(a[k]) === Number(b[k]));
}

// ── 3.2 Closed card sentence ─────────────────────────────────────────────────
// The comparison with the previous month is only given when that month is closed.
export function closedCardSentence({ monthStr, snapshot, previousSnapshot }) {
  const mine = snapshot.totals.mine_cents;
  const money = (c) => formatSGD(Math.abs(c) / 100);
  let text = `${money(mine)} take-home, locked.`;
  if (previousSnapshot?.totals) {
    const diff = mine - previousSnapshot.totals.mine_cents;
    const prevName = monthName(shiftMonth(monthStr, -1));
    text +=
      diff === 0
        ? ` That is the same as ${prevName}.`
        : ` That is ${money(diff)} ${diff > 0 ? "more" : "less"} than ${prevName}.`;
  }
  return text;
}
