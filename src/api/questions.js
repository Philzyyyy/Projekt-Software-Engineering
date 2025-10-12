// src/api/questions.js
// ⚠️ Pfad/Case genau passend zu deiner Datei:
import { mockQuestions } from "../api/mockQuestions.js";

const USE_SUPABASE = false;

// --- Helpers ---------------------------------------------------------------

function normalizeOptions(rawOptions) {
  // Gibt { labels: string[], correctIndexViaFlag: number|null } zurück
  if (!Array.isArray(rawOptions))
    return { labels: [], correctIndexViaFlag: null };

  let correctIndexViaFlag = null;

  const labels = rawOptions.map((opt, i) => {
    if (typeof opt === "string") return opt;

    // Option ist ein Objekt -> Text extrahieren
    const text =
      opt?.text ??
      opt?.label ??
      opt?.title ??
      opt?.answer ??
      (opt?.value != null ? String(opt.value) : "");

    // Korrekt-Flag erkennen
    const isCorrect =
      opt?.isCorrect === true ||
      opt?.correct === true ||
      opt?.right === true ||
      opt?.solution === true;

    if (isCorrect && correctIndexViaFlag == null) {
      correctIndexViaFlag = i;
    }

    return text ?? "";
  });

  return { labels, correctIndexViaFlag };
}

function deriveCorrectIndex(q, labels, correctIndexViaFlag) {
  // 1) Zahl direkt
  if (typeof q?.correctIndex === "number") return q.correctIndex;
  if (typeof q?.correct === "number") return q.correct;
  if (typeof q?.correct_answer_index === "number")
    return q.correct_answer_index;

  // 2) Aus Flag in den Optionen (z. B. option.isCorrect)
  if (Number.isInteger(correctIndexViaFlag)) return correctIndexViaFlag;

  // 3) Aus Textfeldern im Frageobjekt (string)
  const candidates = [
    q?.correctAnswer,
    q?.answer,
    q?.solution,
    q?.correctText,
  ].filter((v) => typeof v === "string" && v.length > 0);

  for (const val of candidates) {
    const idx = labels.findIndex((t) => t === val);
    if (idx >= 0) return idx;
  }

  // 4) Aus Textfeldern in der richtigen Antwort (Objekt)
  //    z. B. q.correctOption = { text: "Paris" }
  const correctObj = q?.correctOption ?? q?.solutionOption;
  if (correctObj && typeof correctObj === "object") {
    const t =
      correctObj.text ??
      correctObj.label ??
      correctObj.title ??
      correctObj.answer ??
      (correctObj.value != null ? String(correctObj.value) : null);
    if (typeof t === "string") {
      const idx = labels.findIndex((x) => x === t);
      if (idx >= 0) return idx;
    }
  }

  // Fallback: unbekannt
  return -1;
}

function normalizeQuestions(list) {
  return (list || []).map((q, idx) => {
    const id = q?.id ?? q?.uuid ?? q?._id ?? `q_${idx}`;
    const text = q?.text ?? q?.question ?? q?.title ?? "";

    const { labels, correctIndexViaFlag } = normalizeOptions(
      q?.options ?? q?.answers ?? q?.choices
    );
    let correctIndex = deriveCorrectIndex(q, labels, correctIndexViaFlag);

    // Bounds check
    if (
      !(
        Number.isInteger(correctIndex) &&
        correctIndex >= 0 &&
        correctIndex < labels.length
      )
    ) {
      correctIndex = -1;
    }

    const explanation = q?.explanation ?? q?.explain ?? q?.reason ?? "";

    return { id, text, options: labels, correctIndex, explanation };
  });
}

// --- Public API ------------------------------------------------------------

export async function fetchQuestions({ limit = 10 } = {}) {
  if (USE_SUPABASE) {
    // TODO: später aktivieren – aktuell nur Mock
    return normalizeQuestions([]).slice(0, limit);
  } else {
    return normalizeQuestions(mockQuestions).slice(0, limit);
  }
}

export async function fetchQuestionsMock({ limit = 10 } = {}) {
  return normalizeQuestions(mockQuestions).slice(0, limit);
}
