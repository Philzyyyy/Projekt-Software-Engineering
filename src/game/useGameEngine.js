// src/game/useGameEngine.js
import { useCallback, useMemo, useReducer } from "react";

export const PHASES = {
  IDLE: "idle",
  ANSWERING: "answering",
  REVEALED: "revealed",
  FINISHED: "finished",
};

function reducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return {
        questions: action.questions ?? [],
        index: 0,
        phase: PHASES.ANSWERING,
        answers: {},
        score: 0,
      };

    // SELECT auch in REVEALED erlauben, wenn noch keine Auswahl existiert
    case "SELECT": {
      const curIdx = state.index;
      const alreadyPicked = state.answers[curIdx] != null;
      const canApply =
        state.phase === PHASES.ANSWERING ||
        (state.phase === PHASES.REVEALED && !alreadyPicked);
      if (!canApply) return state;
      return {
        ...state,
        answers: { ...state.answers, [curIdx]: action.optionIndex },
      };
    }

    // Punkte genau einmal beim Übergang ANSWERING -> REVEALED
    case "REVEAL": {
      if (state.phase === PHASES.REVEALED || state.phase === PHASES.FINISHED) {
        return state;
      }
      const q = state.questions[state.index];
      const picked = state.answers[state.index];
      const gain = Number(picked === q?.correctIndex);
      return { ...state, phase: PHASES.REVEALED, score: state.score + gain };
    }

    case "NEXT": {
      const nextIndex = state.index + 1;
      if (nextIndex >= state.questions.length) {
        return { ...state, phase: PHASES.FINISHED };
      }
      return { ...state, index: nextIndex, phase: PHASES.ANSWERING };
    }

    case "FINISH":
      return { ...state, phase: PHASES.FINISHED };

    // 👇 Direkte Synchronisation auf (index, phase) — OHNE Score-Änderung
    case "SYNC_INDEX_PHASE": {
      const { index, phase } = action;
      const safeIndex = Math.max(
        0,
        Math.min(index ?? state.index, (state.questions?.length ?? 1) - 1)
      );
      let safePhase = phase ?? state.phase;
      if (
        safePhase !== PHASES.ANSWERING &&
        safePhase !== PHASES.REVEALED &&
        safePhase !== PHASES.FINISHED
      ) {
        safePhase = PHASES.ANSWERING;
      }
      return { ...state, index: safeIndex, phase: safePhase };
    }

    default:
      return state;
  }
}

export default function useGameEngine() {
  const [state, dispatch] = useReducer(reducer, {
    questions: [],
    index: 0,
    phase: PHASES.IDLE,
    answers: {},
    score: 0,
  });

  const load = useCallback(
    (questions) => dispatch({ type: "LOAD", questions }),
    []
  );
  const select = useCallback(
    (optionIndex) => dispatch({ type: "SELECT", optionIndex }),
    []
  );
  const reveal = useCallback(() => dispatch({ type: "REVEAL" }), []);
  const next = useCallback(() => dispatch({ type: "NEXT" }), []);
  const finish = useCallback(() => dispatch({ type: "FINISH" }), []);
  const syncIndexPhase = useCallback(
    (index, phase) => dispatch({ type: "SYNC_INDEX_PHASE", index, phase }),
    []
  );

  const current = useMemo(
    () => state.questions[state.index] ?? null,
    [state.questions, state.index]
  );

  return {
    ...state,
    PHASES,
    current,
    load,
    select,
    reveal,
    next,
    finish,
    syncIndexPhase, // 👈 neu
  };
}
