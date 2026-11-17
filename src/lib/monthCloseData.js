// Loads everything the month-end close page needs (spec 6.3). Every list is
// paged with .range() in blocks of 900 (Supabase returns at most 1,000 rows per
// query) and any query error is thrown: the page never computes from partial data.
// Read-only apart from the recompute_payment_cycles backfill the spec asks for.

import { supabase } from "./supabase";
import { monthBounds, sgtTodayKey } from "./monthClose";

const PAGE_SIZE = 900;

export async function fetchPaged(makeQuery) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

const STUDENT_COLS =
  "id, name, hourly_rate, payment_mode, payment_cycle_count, payment_custom_day, payee_id, fee_collected_by, placement_fee_agency, placement_fee_amount, placement_fee_start, archived, deleted_at, is_practice";
const LESSON_COLS =
  "id, student_id, lesson_date, lesson_time, is_completed, duration_minutes, rate, rate_type, payment_cycle_id, student_name_snapshot, created_at";
const CYCLE_COLS =
  "id, student_id, period_start, period_end, amount_due, status, paid_at, waived_at, waived_from_status, is_manual_closeout";

const loadLessons = (tutorId, nextStart) =>
  fetchPaged(() =>
    supabase
      .from("lessons")
      .select(LESSON_COLS)
      .eq("tutor_id", tutorId)
      .lt("lesson_date", nextStart)
      .order("lesson_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );

const loadCycles = (tutorId) =>
  fetchPaged(() =>
    supabase
      .from("payment_cycles")
      .select(CYCLE_COLS)
      .eq("tutor_id", tutorId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );

export async function loadMonthCloseData(tutorId, monthStr) {
  const { nextStart } = monthBounds(monthStr);
  const todayKey = sgtTodayKey();

  // 1. Students: no archived / deleted filter.
  const students = await fetchPaged(() =>
    supabase
      .from("students")
      .select(STUDENT_COLS)
      .eq("tutor_id", tutorId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  // 2. Payees.
  const payees = await fetchPaged(() =>
    supabase
      .from("payees")
      .select("id, name, share_percent, archived")
      .eq("tutor_id", tutorId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  );

  // 3 + 5. Lessons (done and not done) before the end of the month, and all notices.
  let [lessons, cycles] = await Promise.all([
    loadLessons(tutorId, nextStart),
    loadCycles(tutorId),
  ]);

  // Backfill: monthly / custom-date students whose past lessons were never
  // grouped into a notice (nobody opened the Dashboard). Same job the Dashboard
  // and Payments pages already do. Recompute once, then reload lessons + notices.
  const thisMonth = todayKey.slice(0, 7);
  const needBackfill = students.filter(
    (s) =>
      !s.deleted_at &&
      !s.is_practice &&
      (s.payment_mode === "monthly" || s.payment_mode === "custom_date") &&
      lessons.some(
        (l) =>
          l.student_id === s.id &&
          l.is_completed &&
          !l.payment_cycle_id &&
          l.lesson_date.slice(0, 7) < thisMonth,
      ),
  );
  if (needBackfill.length > 0) {
    await Promise.all(
      needBackfill.map(async (s) => {
        const { error } = await supabase.rpc("recompute_payment_cycles", {
          p_student_id: s.id,
          p_tutor_id: tutorId,
        });
        if (error) throw error;
      }),
    );
    [lessons, cycles] = await Promise.all([
      loadLessons(tutorId, nextStart),
      loadCycles(tutorId),
    ]);
  }

  // 4. Students with a lesson dated today or later (for the "no upcoming lessons" tag).
  const upcomingRows = await fetchPaged(() =>
    supabase
      .from("lessons")
      .select("id, student_id")
      .eq("tutor_id", tutorId)
      .gte("lesson_date", todayKey)
      .order("id", { ascending: true }),
  );
  const upcomingStudentIds = new Set(upcomingRows.map((r) => r.student_id));

  // 6. Agency statements.
  const statements = await fetchPaged(() =>
    supabase
      .from("payee_statements")
      .select("payee_id, month, status, claimed_total, sent_at")
      .eq("tutor_id", tutorId)
      .order("month", { ascending: true })
      .order("payee_id", { ascending: true }),
  );

  // 7. Month closes (at most 12 a year).
  const closes = await fetchPaged(() =>
    supabase
      .from("month_closes")
      .select("id, month, status, revision, calc_version, snapshot, closed_at, reopened_at, reopen_reason")
      .eq("tutor_id", tutorId)
      .order("month", { ascending: true }),
  );

  // 8. Change log for this month, newest first, first 200 rows.
  const { data: changes, error: changesError } = await supabase
    .from("closed_month_changes")
    .select("id, month, entity_type, entity_id, action, student_id, student_name, old_values, new_values, amount_before, amount_after, note, changed_at")
    .eq("tutor_id", tutorId)
    .eq("month", `${monthStr}-01`)
    .order("changed_at", { ascending: false })
    .range(0, 199);
  if (changesError) throw changesError;

  return {
    monthStr,
    todayKey,
    students,
    payees,
    lessons,
    upcomingStudentIds,
    cycles,
    statements,
    closes,
    changes: changes ?? [],
  };
}
