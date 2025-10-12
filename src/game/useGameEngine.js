// src/game/useGameEngine.js
import { useCallback, useMemo, useReducer } from "react";

const PHASES = {
  IDLE: "idle",
  ANSWERING: "answering",
  REVEALED: "revealed",
  FINISHED: "finished",
};

function reducer(state, action) {
  switch (action.type) {
    case "LOAD":
      return {
        ...state,
        questions: action.questions,
        index: 0,
        phase: PHASES.ANSWERING,
        answers: {},
        score: 0,
      };
    case "SELECT":
      if (state.phase !== PHASES.ANSWERING) return state;
      return {
        ...state,
        answers: { ...state.answers, [state.index]: action.optionIndex },
      };
    case "REVEAL": {
      if (state.phase !== PHASES.ANSWERING) return state;
      const q = state.questions[state.index];
      const picked = state.answers[state.index];
      const correct = q?.correctIndex;
      const gain = Number(picked === correct);
      return { ...state, phase: PHASES.REVEALED, score: state.score + gain };
    }
    case "NEXT": {
      const next = state.index + 1;
      if (next >= state.questions.length)
        return { ...state, phase: PHASES.FINISHED };
      return { ...state, index: next, phase: PHASES.ANSWERING };
    }
    // ⬇️ NEU: Hartes Finish, falls ein Client 'finish' broadcastet
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
  const finish = useCallback(() => dispatch({ type: "FINISH" }), []); // ⬅️ neu

  const current = useMemo(
    () => state.questions[state.index] ?? null,
    [state.questions, state.index]
  );

  return { ...state, PHASES, current, load, select, reveal, next, finish };
}
