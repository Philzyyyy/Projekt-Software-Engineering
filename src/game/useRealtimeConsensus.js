// src/game/useRealtimeConsensus.js
import { useEffect, useMemo, useRef } from "react";
import supabase from "../lib/supabaseClient";

function getClientId() {
  const KEY = "participant_client_id";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Realtime-Konsens für Quiz:
 * - Events: 'pick', 'reveal', 'next', 'finish'
 */
export default function useRealtimeConsensus({
  roomId,
  onPick,
  onReveal,
  onNext,
  onFinish,
}) {
  const clientId = useMemo(() => getClientId(), []);
  const channelRef = useRef(null);

  useEffect(() => {
    if (!roomId) return;

    const ch = supabase
      .channel(`game-room-${roomId}-quiz`)
      .on("broadcast", { event: "pick" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        const { questionIndex, optionIndex } = msg.payload || {};
        onPick?.({ questionIndex, optionIndex, from: "remote" });
      })
      .on("broadcast", { event: "reveal" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        onReveal?.({ from: "remote" });
      })
      .on("broadcast", { event: "next" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        onNext?.({ from: "remote" });
      })
      .on("broadcast", { event: "finish" }, (msg) => {
        // ⬅️ neu
        if (msg?.payload?.by === clientId) return;
        onFinish?.({ from: "remote" });
      })
      .subscribe();

    channelRef.current = ch;
    return () => {
      if (ch) supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [roomId, clientId, onPick, onReveal, onNext, onFinish]);

  const sendPick = (questionIndex, optionIndex) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "pick",
      payload: { by: clientId, questionIndex, optionIndex, at: Date.now() },
    });
  };

  const sendReveal = () => {
    channelRef.current?.send({
      type: "broadcast",
      event: "reveal",
      payload: { by: clientId, at: Date.now() },
    });
  };

  const sendNext = () => {
    channelRef.current?.send({
      type: "broadcast",
      event: "next",
      payload: { by: clientId, at: Date.now() },
    });
  };

  // ⬇️ neu: finish senden
  const sendFinish = () => {
    channelRef.current?.send({
      type: "broadcast",
      event: "finish",
      payload: { by: clientId, at: Date.now() },
    });
  };

  return { sendPick, sendReveal, sendNext, sendFinish };
}
