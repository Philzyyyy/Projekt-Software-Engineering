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

    case "SELECT": {
      if (state.phase !== PHASES.ANSWERING) return state;
      return {
        ...state,
        answers: { ...state.answers, [state.index]: action.optionIndex },
      };
    }

    case "REVEAL": {
      // Idempotent: erneutes REVEAL ändert nichts
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

    // Harte Umschaltung auf FINISHED (für Remote-Failsafe)
    case "FINISH":
      return { ...state, phase: PHASES.FINISHED };

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
  };
}
