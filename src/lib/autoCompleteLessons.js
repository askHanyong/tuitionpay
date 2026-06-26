import { supabase } from "./supabase";

const todayStr = () => new Date().toISOString().slice(0, 10);
const nowTimeStr = () => new Date().toTimeString().slice(0, 8);

// Lessons logged for a future date are inserted as 'scheduled' and only
// become billable once their date arrives. Flip any that are now due into
// 'completed' so the on_lesson_update trigger recomputes billing for them.
// A lesson dated today with a lesson_time isn't due until that time has
// actually passed — otherwise a 7pm lesson would count toward billing the
// moment the clock struck midnight.
export async function autoCompletePastLessons() {
  await supabase
    .from("lessons")
    .update({ status: "completed" })
    .eq("status", "scheduled")
    .lt("lesson_date", todayStr());

  await supabase
    .from("lessons")
    .update({ status: "completed" })
    .eq("status", "scheduled")
    .eq("lesson_date", todayStr())
    .or(`lesson_time.is.null,lesson_time.lte.${nowTimeStr()}`);
}
