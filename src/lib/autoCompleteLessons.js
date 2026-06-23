import { supabase } from "./supabase";

const todayStr = () => new Date().toISOString().slice(0, 10);

// Lessons logged for a future date are inserted as 'scheduled' and only
// become billable once their date arrives. Flip any that are now due into
// 'completed' so the on_lesson_update trigger recomputes billing for them.
export async function autoCompletePastLessons() {
  await supabase
    .from("lessons")
    .update({ status: "completed" })
    .eq("status", "scheduled")
    .lte("lesson_date", todayStr());
}
