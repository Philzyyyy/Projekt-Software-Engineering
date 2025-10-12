// src/game/usePersistentGameState.js
import { useCallback, useEffect, useRef } from "react";
import supabase from "../lib/supabaseClient";

/**
 * @param {object} params
 * @param {string} params.roomId
 * @param {Function} params.hydrate   // from useGameEngine
 * @param {Function} params.getEngine // () => { index, phase, answers, score, current }
 */
export default function usePersistentGameState({ roomId, hydrate, getEngine }) {
  const subRef = useRef(null);

  // Initial laden/Upsert
  const ensureRow = useCallback(async () => {
    if (!roomId) return null;

    // Versuchen zu lesen
    const { data } = await supabase
      .from("room_game_state")
      .select("*")
      .eq("room_id", roomId)
      .maybeSingle();

    if (data) {
      // Engine hydrieren
      hydrate({
        index: data.current_index,
        phase:
          data.phase === "finished"
            ? "finished"
            : data.phase === "revealed"
            ? "revealed"
            : "answering",
        picked: data.picked ?? null,
        score: data.score ?? 0,
      });
      return data;
    }

    // Upsert initial
    const { data: up } = await supabase
      .from("room_game_state")
      .upsert(
        [
          {
            room_id: roomId,
            current_index: 0,
            phase: "answering",
            picked: null,
            score: 0,
          },
        ],
        { onConflict: "room_id" }
      )
      .select("*")
      .maybeSingle();

    if (up) {
      hydrate({ index: 0, phase: "answering", picked: null, score: 0 });
    }
    return up;
  }, [roomId, hydrate]);

  // Postgres Realtime-Subscribe → Engine hydrieren
  useEffect(() => {
    if (!roomId) return;
    const channel = supabase
      .channel(`rgs-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_game_state",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new;
          if (!row) return;
          hydrate({
            index: row.current_index,
            phase: row.phase,
            picked: row.picked ?? null,
            score: row.score ?? 0,
          });
        }
      )
      .subscribe();

    subRef.current = channel;
    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId, hydrate]);

  // ---- Client → Server: Update-Funktionen ----
  const persistSelect = useCallback(
    async (optionIndex) => {
      if (!roomId) return;
      const eng = getEngine();
      // Nur schreiben, wenn wir auf derselben Frage sind
      await supabase
        .from("room_game_state")
        .update({ picked: optionIndex })
        .eq("room_id", roomId);
    },
    [roomId, getEngine]
  );

  const persistReveal = useCallback(async () => {
    if (!roomId) return;
    const eng = getEngine();
    const picked = eng.answers[eng.index];
    // Punkte lokal berechnen (Prototyp); später gern via RPC serverseitig
    const correct = eng.current?.correctIndex;
    const gain = Number(picked === correct);
    await supabase
      .from("room_game_state")
      .update({
        phase: "revealed",
        score: (eng.score ?? 0) + gain,
      })
      .eq("room_id", roomId);
  }, [roomId, getEngine]);

  const persistNext = useCallback(async () => {
    if (!roomId) return;
    const eng = getEngine();
    const isLast = eng.index + 1 >= eng.questions.length;
    if (isLast) {
      // Finish
      await supabase
        .from("room_game_state")
        .update({ phase: "finished", finished_at: new Date().toISOString() })
        .eq("room_id", roomId);
    } else {
      await supabase
        .from("room_game_state")
        .update({
          current_index: eng.index + 1,
          phase: "answering",
          picked: null,
        })
        .eq("room_id", roomId);
    }
  }, [roomId, getEngine]);

  const persistFinish = useCallback(async () => {
    if (!roomId) return;
    await supabase
      .from("room_game_state")
      .update({ phase: "finished", finished_at: new Date().toISOString() })
      .eq("room_id", roomId);
  }, [roomId]);

  return {
    ensureRow,
    persistSelect,
    persistReveal,
    persistNext,
    persistFinish,
  };
}
