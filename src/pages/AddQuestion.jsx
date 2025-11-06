// src/pages/AddQuestion.jsx
import { useState } from "react";
import supabase from "../lib/supabaseClient";
import { Link } from "react-router-dom";

export default function AddQuestion() {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", "", "", ""]);
  const [answer, setAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleOptionChange = (index, value) => {
    const updated = [...options];
    updated[index] = value;
    setOptions(updated);
    // Wenn die gewählte Antwort leer wurde, Antwort leeren
    if (answer === value && value.trim() === "") {
      setAnswer("");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = options.map((o) => o.trim());
    const valid = trimmed.every((o) => o.length > 0);
    if (!question.trim() || !valid || !answer) {
      setStatus({ type: "error", text: "Bitte alle Felder ausfüllen." });
      return;
    }

    const correctIndex = trimmed.findIndex((o) => o === answer);
    if (correctIndex === -1) {
      setStatus({
        type: "error",
        text: "Die richtige Antwort muss eine der Optionen sein.",
      });
      return;
    }

    setLoading(true);
    setStatus(null);

    const { error } = await supabase.from("questions").insert([
      {
        question: question.trim(),
        options: trimmed,
        answer, // optional-redundant (einfach zu lesen)
        correct_index: correctIndex, // für das Spiel ideal
        explanation: explanation.trim() || null,
      },
    ]);

    setLoading(false);

    if (error) {
      console.error(error);
      setStatus({
        type: "error",
        text: "Fehler beim Speichern in der Datenbank.",
      });
    } else {
      setStatus({ type: "success", text: "Frage erfolgreich gespeichert!" });
      setQuestion("");
      setOptions(["", "", "", ""]);
      setAnswer("");
      setExplanation("");
    }
  };

  return (
    <div className="min-h-dvh p-4">
      <div className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold text-slate-900">
            Neue Frage erstellen
          </h1>
          <Link to="/" className="text-indigo-600 hover:underline text-sm">
            ← zurück zur Lobby
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              Frage
            </label>
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Gib hier deine Frage ein"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Antwortmöglichkeiten
            </label>
            {options.map((opt, idx) => (
              <input
                key={idx}
                type="text"
                value={opt}
                onChange={(e) => handleOptionChange(idx, e.target.value)}
                className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder={`Antwort ${idx + 1}`}
              />
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Richtige Antwort
            </label>
            <select
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Bitte auswählen</option>
              {options.map(
                (opt, idx) =>
                  opt.trim() && (
                    <option key={idx} value={opt}>
                      {opt}
                    </option>
                  )
              )}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">
              Erklärung (optional)
            </label>
            <textarea
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Kurze Erklärung zur Lösung"
              rows={3}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className={`rounded-xl px-5 py-2 text-white font-semibold transition ${
                loading
                  ? "bg-slate-400 cursor-not-allowed"
                  : "bg-violet-600 hover:bg-violet-700"
              }`}
            >
              {loading ? "Speichern…" : "Frage speichern"}
            </button>

            <Link
              to="/add-question"
              className="text-slate-500 hover:underline text-sm"
            >
              Seite neu laden
            </Link>
          </div>
        </form>

        {status && (
          <div
            className={`mt-4 text-sm ${
              status.type === "success" ? "text-green-600" : "text-red-600"
            }`}
          >
            {status.text}
          </div>
        )}
      </div>
    </div>
  );
}
