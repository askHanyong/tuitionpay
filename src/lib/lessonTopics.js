import { supabase } from "./supabase";

// Syllabus keys a student subject can be tagged with (student_subjects.syllabus).
// Only IB Math AA has topic data for now.
export const SYLLABUS_OPTIONS = [
  { value: "", label: "Off (no topic tracking)" },
  { value: "ib_maa", label: "IB Math AA (SL/HL)" },
];

// 1 / 2 / 3 rating the tutor gives for a topic in a lesson.
export const RATING_OPTIONS = [
  { value: 1, label: "Shaky", active: "bg-red-100 text-red-800 border-red-300" },
  { value: 2, label: "Okay", active: "bg-amber-100 text-amber-800 border-amber-300" },
  { value: 3, label: "Solid", active: "bg-[#d1fae5] text-[#065f46] border-[#5ecfaa]" },
];

// The syllabus list is the same for every tutor and rarely changes,
// so fetch it once per page load.
let syllabusPromise = null;
export function loadSyllabusTopics() {
  if (!syllabusPromise) {
    syllabusPromise = supabase
      .from("syllabus_topics")
      .select("code, topic_number, topic_name, subtopic_number, subtopic_name, level_scope")
      .eq("syllabus", "ib_maa")
      .order("topic_number", { ascending: true })
      .order("subtopic_number", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          syllabusPromise = null; // allow a retry next time
          throw error;
        }
        return data ?? [];
      });
  }
  return syllabusPromise;
}

// Which of a student's subjects does this lesson belong to?
// 1) the lesson's own student_subject_id, 2) matching subject text,
// 3) the student's only subject. Anything else: unknown (null), so we never
// guess and attach topics to the wrong subject.
export function resolveLessonSubject(subjects, lesson) {
  if (!subjects?.length) return null;
  if (lesson.student_subject_id) {
    const byId = subjects.find((s) => s.id === lesson.student_subject_id);
    if (byId) return byId;
  }
  const text = (lesson.subject ?? "").trim().toLowerCase();
  if (text) {
    const byText = subjects.find(
      (s) => (s.subject ?? "").trim().toLowerCase() === text,
    );
    if (byText) return byText;
  }
  return subjects.length === 1 ? subjects[0] : null;
}

// "MAA SL" -> only SL topics by default. Anything else (HL, plain "MAA") -> all.
export function defaultShowAhl(subjectText) {
  const text = subjectText ?? "";
  return !(/\bSL\b/i.test(text) && !/\bHL\b/i.test(text));
}

// [{ topic_number, topic_name, items: [...] }] in syllabus order.
export function groupByTopic(topics) {
  const groups = [];
  for (const t of topics) {
    let g = groups[groups.length - 1];
    if (!g || g.topic_number !== t.topic_number) {
      g = { topic_number: t.topic_number, topic_name: t.topic_name, items: [] };
      groups.push(g);
    }
    g.items.push(t);
  }
  return groups;
}
