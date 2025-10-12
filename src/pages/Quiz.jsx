// src/pages/Quiz.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { fetchQuestions } from "../api/questions.js";
import useGameEngine, { PHASES } from "../game/useGameEngine.js";
import useRealtimeConsensus from "../game/useRealtimeConsensus.js";
import supabase from "../lib/supabaseClient";

export default function Quiz(props) {
  const { state } = useLocation();
  const [loading, setLoading] = useState(true);

  const roomId =
    props?.roomId ??
    state?.roomId ??
    localStorage.getItem("current_room_id") ??
    null;
  const code =
    props?.code ??
    state?.code ??
    localStorage.getItem("current_room_code") ??
    "NO-CODE";

  const {
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
    finish,
    syncIndexPhase,
  } = useGameEngine();

  // --- Reconcile: robustes Nachziehen bei State-Snapshots ---
  const reconcilingRef = useRef(false);
  const reconcileState = useCallback(
    ({ index: remoteIndex, phase: remotePhase }) => {
      if (remoteIndex == null || !questions.length) return;
      // Verhindere Re-Entrancy
      if (reconcilingRef.current) return;
      reconcilingRef.current = true;

      try {
        // Falls der andere weiter ist: für alle übersprungenen Fragen Punkte mitzählen
        if (remoteIndex > index) {
          if (phase === PHASES.ANSWERING) {
            reveal(); // Score für aktuelle Frage sichern
          }
          // Direkt auf Zielindex/Phase springen (Score für Zwischenfragen kommt via vorherige Reveals vom Sender)
          const targetPhase =
            remotePhase === PHASES.FINISHED
              ? PHASES.FINISHED
              : remotePhase === PHASES.REVEALED
              ? PHASES.REVEALED
              : PHASES.ANSWERING;
          syncIndexPhase(
            Math.min(remoteIndex, questions.length - 1),
            targetPhase
          );
          return;
        }

        // Gleiches Index, aber falsche Phase -> angleichen
        if (remoteIndex === index) {
          if (remotePhase === PHASES.REVEALED && phase === PHASES.ANSWERING) {
            reveal();
          } else if (
            remotePhase === PHASES.FINISHED &&
            phase !== PHASES.FINISHED
          ) {
            if (phase === PHASES.ANSWERING) reveal();
            finish();
          }
        }
      } finally {
        // minimal delay, um state updates durchzulassen
        setTimeout(() => (reconcilingRef.current = false), 0);
      }
    },
    [index, phase, questions.length, reveal, finish, syncIndexPhase]
  );

  // --- Remote → Engine ---
  const onPick = useCallback(
    ({ questionIndex, optionIndex }) => {
      if (questionIndex === index) select(optionIndex);
    },
    [index, select]
  );

  const onReveal = useCallback(
    ({ questionIndex, optionIndex }) => {
      if (questionIndex === index && phase === PHASES.ANSWERING) {
        if (optionIndex != null && answers[index] == null) select(optionIndex);
        reveal();
      } else {
        reveal(); // idempotent
      }
    },
    [index, phase, answers, select, reveal]
  );

  const onNext = useCallback(
    ({ toIndex, isLast }) => {
      // Sicherstellen, dass Score für lokale Frage gezählt wird
      if (phase === PHASES.ANSWERING) reveal();
      const targetPhase = isLast ? PHASES.FINISHED : PHASES.ANSWERING;
      syncIndexPhase(Math.min(toIndex, questions.length - 1), targetPhase);
    },
    [phase, reveal, syncIndexPhase, questions.length]
  );

  const onFinish = useCallback(() => {
    if (phase === PHASES.ANSWERING) reveal();
    finish();
  }, [phase, reveal, finish]);

  const { sendPick, sendReveal, sendNext, sendFinish, sendState, ready } =
    useRealtimeConsensus({
      roomId,
      onPick,
      onReveal,
      onNext,
      onFinish,
      onState: reconcileState,
    });

  // ---- Fragen laden mit deterministischem Seed (code + started_at) ----
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        let startedAt = null;
        if (roomId) {
          const { data } = await supabase
            .from("rooms")
            .select("started_at")
            .eq("id", roomId)
            .maybeSingle();
          if (data?.started_at) startedAt = data.started_at;
        }
        const seed = startedAt ? `${code}|${startedAt}` : `${code}|no-start`;
        const qs = await fetchQuestions({ limit: 10, seed });
        load(qs);
      } finally {
        setLoading(false);
      }
    })();
  }, [load, roomId, code]);

  // ---- Jede Lokaländerung: aktuellen State senden (debounced via setTimeout(0)) ----
  useEffect(() => {
    if (!roomId) return;
    const t = setTimeout(() => {
      sendState(index, phase);
    }, 0);
    return () => clearTimeout(t);
  }, [roomId, index, phase, sendState]);

  if (loading) return <div className="p-6">Lade Fragen…</div>;

  if (phase === PHASES.FINISHED) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Fertig 🎉</h1>
        <p className="mb-4">
          Punkte: {score} / {questions.length}
        </p>
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
  const qText = current.text ?? current.question ?? current.title ?? "";

  // --- Local → Remote ---
  const handleSelect = (i) => {
    if (phase !== PHASES.ANSWERING) return;
    select(i);
    if (roomId) sendPick(index, i);
  };

  const handleReveal = () => {
    if (phase !== PHASES.ANSWERING) return;
    reveal();
    if (roomId) {
      const latestPick = answers[index] ?? null;
      sendReveal(index, latestPick);
      sendState(index, PHASES.REVEALED);
    }
  };

  const handleNext = () => {
    const toIndex = index + 1;
    const isLast = toIndex >= questions.length;
    next(); // lokale UI snappy
    if (roomId) {
      sendNext(toIndex, isLast);
      sendState(toIndex, isLast ? PHASES.FINISHED : PHASES.ANSWERING);
      if (isLast) sendFinish();
    }
  };

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="text-xs text-slate-500 mb-1">
        Raum: {code ?? "—"} (ID: {roomId ?? "—"}){" "}
        {ready ? "· Live verbunden" : "· Verbindet…"}
      </div>

      <header className="mb-4">
        <div className="text-sm text-gray-500">
          Frage {index + 1} / {questions.length}
        </div>
        <h1 className="text-xl font-semibold">{qText}</h1>
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
                onClick={() => handleSelect(i)}
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
          onClick={handleReveal}
          disabled={picked == null}
        >
          Antwort zeigen
        </button>
      )}

      {phase === PHASES.REVEALED && (
        <div className="space-y-3">
          <div className="p-3 rounded bg-gray-50 border">
            <div className="font-medium">
              Lösung: {current.options[current.correctIndex] ?? "—"}
            </div>
            {current.explanation && (
              <p className="text-sm mt-1 text-gray-700">
                {current.explanation}
              </p>
            )}
          </div>
          <button
            className="px-4 py-2 rounded bg-blue-600 text-white"
            onClick={handleNext}
          >
            Nächste Frage
          </button>
        </div>
      )}
    </div>
  );
}
