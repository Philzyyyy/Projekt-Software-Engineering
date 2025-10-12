// src/api/questions.js
import supabase from "../lib/supabaseClient";
import { mockQuestions } from "../api/mockQuestions.js";

const USE_SUPABASE = true;

// ---- Seeded RNG helpers (deterministisch pro Raum/Runde) ----
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function sfc32(a, b, c, d) {
  return function () {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    d = (d + 1) | 0;
    t = (t + d) | 0;
    return (t >>> 0) / 4294967296;
  };
}
function rngFromSeed(seedStr) {
  const seed = xmur3(seedStr);
  return sfc32(seed(), seed(), seed(), seed());
}
function shuffleSeeded(arr, seedStr) {
  const a = arr.slice();
  const rnd = rngFromSeed(seedStr);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Normalizer auf Engine-Format ----
function normalize(list) {
  return (list || []).map((q, idx) => {
    const text = q.text ?? q.question ?? q.title ?? q.question_text ?? "";
    const options = Array.isArray(q.options)
      ? q.options
      : q.answers ?? q.choices ?? [];
    let correctIndex =
      typeof q.correct_index === "number"
        ? q.correct_index
        : typeof q.correctIndex === "number"
        ? q.correctIndex
        : typeof q.correct === "number"
        ? q.correct
        : -1;

    if (
      correctIndex === -1 &&
      typeof q.answer === "string" &&
      Array.isArray(options)
    ) {
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

/**
 * Holt bis zu {limit} Fragen deterministisch „zufällig“:
 * - DB-Ergebnis stabil sortieren (created_at ASC)
 * - mit Seed (z. B. "ROOMCODE|STARTED_AT_ISO") mischen
 * - auf limit begrenzen (wenn weniger da sind, so viele wie möglich)
 */
export async function fetchQuestions({ limit = 10, seed = "default" } = {}) {
  const take = (arr) => arr.slice(0, Math.min(limit, arr.length));

  if (!USE_SUPABASE) {
    const normalized = normalize(mockQuestions);
    return take(shuffleSeeded(normalized, seed));
  }

  try {
    const { data, error } = await supabase
      .from("questions")
      .select(
        "id, question, options, answer, correct_index, explanation, created_at"
      )
      .order("created_at", { ascending: true }); // stabile Basis-Reihenfolge

    if (error) {
      console.warn(
        "[fetchQuestions] Supabase-Fehler, fallback auf Mock:",
        error.message
      );
      const normalized = normalize(mockQuestions);
      return take(shuffleSeeded(normalized, seed));
    }

    const mapped = (data || []).map((r) => ({
      id: r.id,
      text: r.question,
      options: r.options,
      answer: r.answer,
      correct_index: r.correct_index,
      explanation: r.explanation,
      created_at: r.created_at,
    }));

    const normalized = normalize(mapped);
    if (normalized.length === 0) {
      const mockNorm = normalize(mockQuestions);
      return take(shuffleSeeded(mockNorm, seed));
    }

    return take(shuffleSeeded(normalized, seed));
  } catch (e) {
    console.warn("[fetchQuestions] Ausnahme, fallback auf Mock:", e);
    const normalized = normalize(mockQuestions);
    return take(shuffleSeeded(normalized, seed));
  }
}

// optional
export async function fetchQuestionsMock({
  limit = 10,
  seed = "default",
} = {}) {
  const normalized = normalize(mockQuestions);
  return normalized.slice(0, Math.min(limit, normalized.length));
}
