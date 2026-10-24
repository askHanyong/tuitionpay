import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import {
  RATING_OPTIONS,
  defaultShowAhl,
  groupByTopic,
  loadSyllabusTopics,
  resolveLessonSubject,
} from "../lib/lessonTopics";

// "Topics covered" for one lesson: pick syllabus subtopics, rate each
// Shaky / Okay / Solid. Every tap saves straight away.
// Renders nothing when the lesson's subject has topic tracking switched off.
export default function LessonTopicsPanel({ lessonId, studentId }) {
  const { user } = useAuth();
  const [status, setStatus] = useState("loading"); // loading | off | ready | error
  const [errorMsg, setErrorMsg] = useState(null);
  const [topics, setTopics] = useState([]);
  const [subjectText, setSubjectText] = useState("");
  // topic_code -> rating (1/2/3) or null (covered, not rated yet)
  const [selected, setSelected] = useState({});
  const [showAhl, setShowAhl] = useState(true);
  const [picking, setPicking] = useState(false);
  const [openTopic, setOpenTopic] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [lessonRes, subjectsRes, savedRes, allTopics] = await Promise.all([
          supabase
            .from("lessons")
            .select("student_subject_id, subject")
            .eq("id", lessonId)
            .eq("tutor_id", user.id)
            .maybeSingle(),
          supabase
            .from("student_subjects")
            .select("id, subject, syllabus")
            .eq("student_id", studentId)
            .eq("tutor_id", user.id),
          supabase
            .from("lesson_topics")
            .select("topic_code, rating")
            .eq("lesson_id", lessonId)
            .eq("tutor_id", user.id),
          loadSyllabusTopics(),
        ]);
        if (lessonRes.error) throw lessonRes.error;
        if (subjectsRes.error) throw subjectsRes.error;
        if (savedRes.error) throw savedRes.error;
        if (cancelled) return;

        const subject = resolveLessonSubject(subjectsRes.data, lessonRes.data ?? {});
        if (!subject || subject.syllabus !== "ib_maa") {
          setStatus("off");
          return;
        }
        setTopics(allTopics);
        setSubjectText(subject.subject ?? "");
        setShowAhl(defaultShowAhl(subject.subject));
        setSelected(
          Object.fromEntries((savedRes.data ?? []).map((r) => [r.topic_code, r.rating])),
        );
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err.message);
        setStatus("error");
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [lessonId, studentId, user.id]);

  const byCode = useMemo(() => new Map(topics.map((t) => [t.code, t])), [topics]);
  const visibleTopics = useMemo(
    () => topics.filter((t) => showAhl || t.level_scope === "SL"),
    [topics, showAhl],
  );
  const groups = useMemo(() => groupByTopic(visibleTopics), [visibleTopics]);
  const selectedCodes = useMemo(
    () =>
      Object.keys(selected).sort((a, b) => {
        const ta = byCode.get(a);
        const tb = byCode.get(b);
        return (
          (ta?.topic_number ?? 0) - (tb?.topic_number ?? 0) ||
          (ta?.subtopic_number ?? 0) - (tb?.subtopic_number ?? 0)
        );
      }),
    [selected, byCode],
  );

  // Optimistic update; put things back if the save fails.
  const saveChange = async (code, nextRating, remove) => {
    const previous = code in selected ? { has: true, rating: selected[code] } : { has: false };
    setErrorMsg(null);
    setSelected((prev) => {
      const next = { ...prev };
      if (remove) delete next[code];
      else next[code] = nextRating;
      return next;
    });
    const query = remove
      ? supabase
          .from("lesson_topics")
          .delete()
          .eq("lesson_id", lessonId)
          .eq("topic_code", code)
          .eq("tutor_id", user.id)
      : supabase.from("lesson_topics").upsert(
          {
            tutor_id: user.id,
            lesson_id: lessonId,
            topic_code: code,
            rating: nextRating,
          },
          { onConflict: "lesson_id,topic_code" },
        );
    const { error } = await query;
    if (error) {
      setErrorMsg(error.message);
      setSelected((prev) => {
        const next = { ...prev };
        if (previous.has) next[code] = previous.rating;
        else delete next[code];
        return next;
      });
    }
  };

  const toggleTopic = (code) => {
    if (code in selected) saveChange(code, null, true);
    else saveChange(code, null, false);
  };

  // Tapping the rating that is already set clears it back to "not rated".
  const setRating = (code, value) => {
    saveChange(code, selected[code] === value ? null : value, false);
  };

  if (status === "off") return null;
  if (status === "loading") {
    return <p className="mt-4 text-xs text-gray-400">Loading topics…</p>;
  }
  if (status === "error") {
    return <p className="mt-4 text-xs text-red-600">Couldn&apos;t load topics: {errorMsg}</p>;
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Topics covered
          {selectedCodes.length > 0 && (
            <span className="ml-1 font-normal text-gray-400">({selectedCodes.length})</span>
          )}
        </h3>
        <button
          type="button"
          onClick={() => setPicking((v) => !v)}
          className="min-h-9 rounded-md px-2 text-xs font-medium text-[#0f7a58] hover:bg-[#edf6f3]"
        >
          {picking ? "Done" : "+ Add topics"}
        </button>
      </div>

      {selectedCodes.length === 0 && !picking && (
        <p className="mt-1 text-xs text-gray-400">
          Nothing logged yet. Add what you covered and how it went.
        </p>
      )}

      {selectedCodes.length > 0 && (
        <ul className="mt-2 space-y-2">
          {selectedCodes.map((code) => {
            const t = byCode.get(code);
            return (
              <li key={code} className="rounded-md bg-gray-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-gray-700">
                    <span className="font-semibold text-gray-900">{code}</span>{" "}
                    {t?.subtopic_name ?? ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => toggleTopic(code)}
                    aria-label={`Remove ${code}`}
                    className="flex-none text-xs text-gray-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {RATING_OPTIONS.map((opt) => {
                    const on = selected[code] === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRating(code, opt.value)}
                        aria-pressed={on}
                        className={`min-h-9 flex-1 rounded-md border px-2 text-xs font-medium transition ${
                          on
                            ? opt.active
                            : "border-gray-200 bg-white text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {picking && (
        <div className="mt-3 border-t border-gray-100 pt-3">
          {!defaultShowAhl(subjectText) && (
            <label className="mb-2 flex items-center gap-2 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={showAhl}
                onChange={(e) => setShowAhl(e.target.checked)}
              />
              Also show HL-only topics
            </label>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {groups.map((g) => {
              const open = openTopic === g.topic_number;
              const count = g.items.filter((i) => i.code in selected).length;
              return (
                <div key={g.topic_number} className="rounded-md border border-gray-100">
                  <button
                    type="button"
                    onClick={() => setOpenTopic(open ? null : g.topic_number)}
                    className="flex min-h-10 w-full items-center justify-between px-3 text-left text-sm font-medium text-gray-800"
                  >
                    <span>
                      {g.topic_number}. {g.topic_name}
                      {count > 0 && (
                        <span className="ml-1 text-xs font-normal text-[#0f7a58]">
                          · {count} added
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-gray-400">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <ul className="border-t border-gray-100 py-1">
                      {g.items.map((item) => {
                        const on = item.code in selected;
                        return (
                          <li key={item.code}>
                            <button
                              type="button"
                              onClick={() => toggleTopic(item.code)}
                              aria-pressed={on}
                              className={`flex min-h-10 w-full items-start gap-2 px-3 py-1.5 text-left text-xs transition ${
                                on ? "bg-[#edf6f3] text-gray-900" : "text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              <span className="mt-0.5 flex-none">{on ? "☑" : "☐"}</span>
                              <span>
                                <span className="font-semibold">{item.code}</span>{" "}
                                {item.subtopic_name}
                                {item.level_scope === "AHL" && (
                                  <span className="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                                    HL
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-2 text-xs text-red-600">Couldn&apos;t save: {errorMsg}</p>}
    </div>
  );
}
