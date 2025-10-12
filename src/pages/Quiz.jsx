// src/pages/Quiz.jsx
import { useEffect, useState, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { fetchQuestions } from "../api/questions.js";
import useGameEngine, { PHASES } from "../game/useGameEngine.js";
import useRealtimeConsensus from "../game/useRealtimeConsensus.js";
import supabase from "../lib/supabaseClient";

const PHASE_ORDER = {
  [PHASES.ANSWERING]: 0,
  [PHASES.REVEALED]: 1,
  [PHASES.FINISHED]: 2,
};

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

  // --- Refs (verhindern Reload-/Render-Loops) ---
  const qlenRef = useRef(0);
  useEffect(() => {
    qlenRef.current = questions.length;
  }, [questions.length]);

  const hasLoadedRef = useRef(false); // ⬅️ nur EINMAL pro Raum laden
  const pendingStateRef = useRef(null);
  const reconcilingRef = useRef(false);

  // ---- Reconcile: Remote-States robust anwenden (nie zurückspringen) ----
  const reconcileState = useCallback(
    ({ index: remoteIndex, phase: remotePhase }) => {
      const total = qlenRef.current;
      if (remoteIndex == null) return;
      if (total === 0) {
        pendingStateRef.current = { index: remoteIndex, phase: remotePhase };
        return;
      }
      if (reconcilingRef.current) return;
      reconcilingRef.current = true;

      try {
        const clampedIndex = Math.max(0, Math.min(remoteIndex, total - 1));
        const targetPhase =
          remotePhase === PHASES.FINISHED
            ? PHASES.FINISHED
            : remotePhase === PHASES.REVEALED
            ? PHASES.REVEALED
            : PHASES.ANSWERING;

        // nie zurück
        if (clampedIndex < index) return;

        if (clampedIndex > index) {
          if (phase === PHASES.ANSWERING) reveal(); // Score sichern
          syncIndexPhase(clampedIndex, targetPhase);
          return;
        }

        // gleiches Index → Phase nur vorwärts
        if (PHASE_ORDER[targetPhase] > PHASE_ORDER[phase]) {
          if (targetPhase === PHASES.REVEALED && phase === PHASES.ANSWERING) {
            reveal();
          } else if (targetPhase === PHASES.FINISHED) {
            if (phase === PHASES.ANSWERING) reveal();
            finish();
          }
        }
      } finally {
        setTimeout(() => (reconcilingRef.current = false), 0);
      }
    },
    [index, phase, reveal, finish, syncIndexPhase]
  );

  // --- Remote → Engine
  const onPick = useCallback(
    ({ questionIndex, optionIndex }) => {
      if (qlenRef.current === 0) return;
      if (questionIndex === index) select(optionIndex);
    },
    [index, select]
  );

  const onReveal = useCallback(
    ({ questionIndex, optionIndex }) => {
      if (qlenRef.current === 0) return;
      if (questionIndex === index && phase === PHASES.ANSWERING) {
        if (optionIndex != null && answers[index] == null) select(optionIndex);
        reveal();
      } else {
        reveal(); // idempotent
      }
    },
    [index, phase, answers, select, reveal]
  );

  // next liefert optionIndex mit → ggf. erst setzen, dann reveal (Score!)
  const onNext = useCallback(
    ({ toIndex, isLast, optionIndex }) => {
      if (qlenRef.current === 0) {
        pendingStateRef.current = {
          index: toIndex,
          phase: isLast ? PHASES.FINISHED : PHASES.ANSWERING,
        };
        return;
      }
      if (phase === PHASES.ANSWERING) {
        if (optionIndex != null && answers[index] == null) select(optionIndex);
        reveal();
      }
      const clamped = Math.max(0, Math.min(toIndex, qlenRef.current - 1));
      syncIndexPhase(clamped, isLast ? PHASES.FINISHED : PHASES.ANSWERING);
    },
    [phase, answers, index, select, reveal, syncIndexPhase]
  );

  const onFinish = useCallback(() => {
    if (qlenRef.current === 0) {
      pendingStateRef.current = { index: 0, phase: PHASES.FINISHED };
      return;
    }
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

  // ---- Fragen laden (EINMAL pro Raum) ----
  useEffect(() => {
    // Reset Marker wenn Raum wechselt
    hasLoadedRef.current = false;
  }, [roomId, code]);

  useEffect(() => {
    if (!roomId && !code) return;
    if (hasLoadedRef.current) {
      setLoading(false);
      return;
    } // bereits geladen

    let cancelled = false;
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
        if (cancelled) return;

        load(qs);
        hasLoadedRef.current = true; // ⬅️ markiere als geladen

        // Gepufferten Snapshot anwenden, falls vorhanden
        if (pendingStateRef.current) {
          const snap = pendingStateRef.current;
          pendingStateRef.current = null;
          setTimeout(() => reconcileState(snap), 0);
        }
        // kein initiales sendState(0, ANSWERING)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // ⬇️ WICHTIG: nur an roomId/code hängen, NICHT an reconcileState o.ä.
  }, [roomId, code, load]);

  // ---- jede lokale Änderung → State senden
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

  // --- Local → Remote
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
    }
  };

  const handleNext = () => {
    const toIndex = index + 1;
    const isLast = toIndex >= qlenRef.current;
    next(); // lokal snappy
    if (roomId) {
      const latestPick = answers[index] ?? null;
      sendNext(toIndex, isLast, latestPick); // Auswahl mitschicken (Score-Sync)
      if (isLast) sendFinish();
      // State (toIndex, phase) sendet der State-Effect automatisch
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
