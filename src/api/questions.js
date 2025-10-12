// src/api/questions.js
import { mockQuestions } from "../api/mockQuestions.js";
import supabase from "../lib/supabaseClient";

const USE_SUPABASE = true; // ← jetzt Supabase nutzen

function normalize(list) {
  return (list || []).map((q, idx) => {
    const text = q.text ?? q.question ?? q.title ?? q.question_text ?? "";
    const options = q.options ?? q.answers ?? q.choices ?? [];
    let correctIndex =
      typeof q.correct_index === "number"
        ? q.correct_index
        : typeof q.correctIndex === "number"
        ? q.correctIndex
        : typeof q.correct === "number"
        ? q.correct
        : -1;
    // Falls nur 'answer' existiert (Text), auf Index mappen
    if (correctIndex === -1 && typeof q.answer === "string") {
      const i = options.findIndex((o) => o === q.answer);
      if (i >= 0) correctIndex = i;
    }
    const explanation = q.explanation ?? q.explain ?? q.reason ?? "";
    return {
      id: q.id ?? q.uuid ?? q._id ?? `q_${idx}`,
      text,
      options,
      correctIndex,
      explanation,
    };
  });
}

export async function fetchQuestions({ limit = 10, random = true } = {}) {
  if (USE_SUPABASE) {
    // Hinweis: order('created_at') oder random()
    const query = supabase
      .from("questions")
      .select("id,question,options,answer,correct_index,explanation", {
        count: "exact",
      })
      .limit(limit);

    if (random) {
      // Random: einfache Variante – erst groß ziehen, dann clientseitig mischen (oder per SQL random())
      // Hier: nutzen wir SQL random() direkt:
      query.order("random()");
    } else {
      query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) {
      console.warn(
        "[fetchQuestions] Supabase-Fehler, fallback auf Mock:",
        error.message
      );
      return normalize(mockQuestions).slice(0, limit);
    }
    // Map DB-Spalten -> Normalform
    const mapped = (data || []).map((r) => ({
      id: r.id,
      text: r.question,
      options: r.options,
      answer: r.answer,
      correct_index: r.correct_index,
      explanation: r.explanation,
    }));
    return normalize(mapped);
  } else {
    return normalize(mockQuestions).slice(0, limit);
  }
}
