// src/game/useRealtimeConsensus.js
import { useEffect, useMemo, useRef, useState } from "react";
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
 * Realtime-Konsens:
 * Events:
 *  - pick   {questionIndex, optionIndex}
 *  - reveal {questionIndex, optionIndex?}
 *  - next   {toIndex, isLast}
 *  - finish {}
 *  - state  {index, phase}
 *
 * Sendet erst nach SUBSCRIBED; bis dahin Outbox-Puffer.
 */
export default function useRealtimeConsensus({
  roomId,
  onPick,
  onReveal,
  onNext,
  onFinish,
  onState, // Snapshot
}) {
  const clientId = useMemo(() => getClientId(), []);
  const channelRef = useRef(null);
  const [ready, setReady] = useState(false);
  const outboxRef = useRef([]);

  const enqueueOrSend = (event, payload) => {
    const msg = {
      type: "broadcast",
      event,
      payload: { ...payload, by: clientId, at: Date.now() },
    };
    const ch = channelRef.current;
    if (ready && ch) ch.send(msg);
    else outboxRef.current.push(msg);
  };

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
        const { questionIndex, optionIndex } = msg.payload || {};
        onReveal?.({ questionIndex, optionIndex, from: "remote" });
      })
      .on("broadcast", { event: "next" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        const { toIndex, isLast } = msg.payload || {};
        onNext?.({ toIndex, isLast, from: "remote" });
      })
      .on("broadcast", { event: "finish" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        onFinish?.({ from: "remote" });
      })
      .on("broadcast", { event: "state" }, (msg) => {
        if (msg?.payload?.by === clientId) return;
        const { index, phase } = msg.payload || {};
        if (typeof index === "number" && typeof phase === "string") {
          onState?.({ index, phase, from: "remote" });
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setReady(true);
          while (outboxRef.current.length) ch.send(outboxRef.current.shift());
        }
      });

    channelRef.current = ch;
    setReady(false);
    outboxRef.current = [];

    return () => {
      if (ch) supabase.removeChannel(ch);
      channelRef.current = null;
      setReady(false);
      outboxRef.current = [];
    };
  }, [roomId, clientId, onPick, onReveal, onNext, onFinish, onState]);

  // Public Sender
  const sendPick = (questionIndex, optionIndex) =>
    enqueueOrSend("pick", { questionIndex, optionIndex });
  const sendReveal = (questionIndex, optionIndex) =>
    enqueueOrSend("reveal", { questionIndex, optionIndex });
  const sendNext = (toIndex, isLast) =>
    enqueueOrSend("next", { toIndex, isLast });
  const sendFinish = () => enqueueOrSend("finish", {});
  const sendState = (index, phase) => enqueueOrSend("state", { index, phase });

  return { sendPick, sendReveal, sendNext, sendFinish, sendState, ready };
}
