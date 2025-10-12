// src/pages/Quiz.jsx
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
// Falls du bereits die Engine/Adapter drin hast – Imports beibehalten:
import { fetchQuestions } from "../api/questions"; // Pfad prüfen!
import useGameEngine from "../game/useGameEngine.js"; // Pfad prüfen!

export default function Quiz(props) {
  const { state } = useLocation();
  const [loading, setLoading] = useState(true);

  // Props aus Room.jsx (eingebettet) – oder Fallback auf Router/LocalStorage
  const roomId =
    props?.roomId ??
    state?.roomId ??
    localStorage.getItem("current_room_id") ??
    null;
  const code =
    props?.code ??
    state?.code ??
    localStorage.getItem("current_room_code") ??
    null;

  const {
    PHASES,
    current,
    index,
    questions,
    phase,
    answers,
    score,
    load,
    select,
    reveal,
    next,
  } = useGameEngine();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const qs = await fetchQuestions({ limit: 10 }); // aktuell Mock-Fragen
      load(qs);
      setLoading(false);
    })();
  }, [load]);

  if (loading) return <div className="p-6">Lade Fragen…</div>;
  if (phase === PHASES.FINISHED) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Fertig 🎉</h1>
        <p className="mb-4">
          Punkte: {score} / {questions.length}
        </p>

        {/* Wenn eingebettet, optionaler Exit-Button */}
        {props?.onExit ? (
          <button
            onClick={props.onExit}
            className="rounded bg-slate-900 text-white px-4 py-2"
          >
            Zur Lobby
          </button>
        ) : (
          <a className="underline text-blue-600" href="/">
            Zurück
          </a>
        )}
      </div>
    );
  }

  if (!current) return <div className="p-6">Keine Frage gefunden.</div>;

  const picked = answers[index];

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Optional: kleinen Kontext anzeigen */}
      <div className="text-xs text-slate-500 mb-1">
        Raum: {code ?? "—"} (ID: {roomId ?? "—"})
      </div>

      <header className="mb-4">
        <div className="text-sm text-gray-500">
          Frage {index + 1} / {questions.length}
        </div>
        <h1 className="text-xl font-semibold">{current.text}</h1>
      </header>

      <ul className="space-y-2 mb-4">
        {current.options.map((opt, i) => {
          const isPicked = picked === i;
          const isCorrect =
            phase === PHASES.REVEALED && i === current.correctIndex;
          const isWrongPick =
            phase === PHASES.REVEALED && isPicked && i !== current.correctIndex;

          return (
            <li key={i}>
              <button
                className={
                  "w-full text-left p-3 rounded border " +
                  (isPicked ? "border-blue-500 " : "border-gray-300 ") +
                  (isCorrect ? "bg-green-100 " : "") +
                  (isWrongPick ? "bg-red-100 " : "")
                }
                onClick={() => select(i)}
                disabled={phase !== PHASES.ANSWERING}
              >
                {opt}
              </button>
            </li>
          );
        })}
      </ul>

      {phase === PHASES.ANSWERING && (
        <button
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-40"
          onClick={reveal}
          disabled={picked == null}
        >
          Antwort zeigen
        </button>
      )}

      {phase === PHASES.REVEALED && (
        <div className="space-y-3">
          <div className="p-3 rounded bg-gray-50 border">
            <div className="font-medium">
              Lösung: {current.options[current.correctIndex]}
            </div>
            {current.explanation && (
              <p className="text-sm mt-1 text-gray-700">
                {current.explanation}
              </p>
            )}
          </div>
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white"
            onClick={next}
          >
            Nächste Frage
          </button>
        </div>
      )}
    </div>
  );
}
