// src/api/questions.js
// ACHTUNG: Pfad/Case muss zu deiner Datei passen:
import { mockQuestions } from "../api/mockQuestions.js";

// Feature-Flag: Mock oder Supabase
const USE_SUPABASE = false;

/**
 * Normalisiert beliebige Frage-Formate auf:
 * { id, text, options[], correctIndex, explanation }
 */
function normalizeQuestions(list) {
  return (list || []).map((q, idx) => {
    const id = q.id ?? q.uuid ?? q._id ?? `q_${idx}`;

    const text = q.text ?? q.question ?? q.title ?? "";

    const options = q.options ?? q.answers ?? q.choices ?? [];

    const correctIndex =
      typeof q.correctIndex === "number"
        ? q.correctIndex
        : typeof q.correct === "number"
        ? q.correct
        : typeof q.correct_answer_index === "number"
        ? q.correct_answer_index
        : -1;

    const explanation = q.explanation ?? q.explain ?? q.reason ?? "";

    return { id, text, options, correctIndex, explanation };
  });
}

// Hauptfunktion zum Abrufen von Fragen (mit Normalisierung)
export async function fetchQuestions({ limit = 10 } = {}) {
  if (USE_SUPABASE) {
    // --- Supabase (später aktivieren, hier nur Vorlage) ---
    /*
    import { createClient } from "@supabase/supabase-js";
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data, error } = await supabase
      .from("questions")
      .select("id,text,options,correctIndex,explanation")
      .limit(limit);

    if (error) throw new Error(error.message);
    return normalizeQuestions(data).slice(0, limit);
    */
    return normalizeQuestions([]).slice(0, limit);
  } else {
    // --- Mock-Daten ---
    return normalizeQuestions(mockQuestions).slice(0, limit);
  }
}

// Optional: reine Mock-Funktion
export async function fetchQuestionsMock({ limit = 10 } = {}) {
  return normalizeQuestions(mockQuestions).slice(0, limit);
}
