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
 * - broadcastet lokale Events ('pick', 'reveal', 'next')
 * - hört auf Remote-Events und ruft die bereitgestellten Handler auf
 */
export default function useRealtimeConsensus({
  roomId,
  onPick,
  onReveal,
  onNext,
}) {
  const clientId = useMemo(() => getClientId(), []);
  const channelRef = useRef(null);

  // Channel abonnieren
  useEffect(() => {
    if (!roomId) return;

    const ch = supabase
      .channel(`game-room-${roomId}-quiz`) // eigenständiger Channel für Quiz-Events
      .on("broadcast", { event: "pick" }, (msg) => {
        // Eigene Events ignorieren
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
      .subscribe();

    channelRef.current = ch;
    return () => {
      if (ch) supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [roomId, clientId, onPick, onReveal, onNext]);

  // Sender
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

  return { sendPick, sendReveal, sendNext };
}
