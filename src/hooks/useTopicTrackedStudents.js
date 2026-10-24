import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

// Ids of the tutor's students who have at least one subject with topic
// tracking switched on (student_subjects.syllabus is set). Used to decide
// whether to show a "Topics" button.
export function useTopicTrackedStudents(userId) {
  const [studentIds, setStudentIds] = useState(() => new Set());

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase
      .from("student_subjects")
      .select("student_id")
      .eq("tutor_id", userId)
      .not("syllabus", "is", null)
      .then(({ data }) => {
        if (cancelled) return;
        setStudentIds(new Set((data ?? []).map((r) => r.student_id)));
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return studentIds;
}
