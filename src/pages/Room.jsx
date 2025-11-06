// src/pages/Room.jsx
import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import supabase from "../lib/supabaseClient";
import Quiz from "./Quiz.jsx";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();

  // ---------- State ----------
  const [roomId, setRoomId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [onlineClientIds, setOnlineClientIds] = useState(new Set());
  const [isPlaying, setIsPlaying] = useState(false);
  const [dbError, setDbError] = useState(null);

  // Chat
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  // UI
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // lokale Identität
  const [myPid, setMyPid] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("participant_row_id")
      : null
  );

  // abgeleitet
  const inviteUrl = useMemo(
    () => `${window.location.origin}/room/${code}`,
    [code]
  );
  const iAmInRoom = participants.some((p) => p.id === myPid);
  const onlineCount = participants.reduce(
    (acc, p) => acc + (onlineClientIds.has(p.client_id) ? 1 : 0),
    0
  );
  const canStart = iAmInRoom && onlineCount >= 2;
  const canSend = Boolean(
    roomId && myPid && iAmInRoom && chatInput.trim() && !sending
  );

  // ---------- Helpers ----------
  const ensureClientId = () => {
    const KEY = "participant_client_id";
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  };

  const myDisplayName = () =>
    participants.find((p) => p.id === myPid)?.name ?? "Ich";

  const smoothScrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
    } finally {
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    }
  };

  // --- Neue UI-Helper für Chat-Bubbles ---
  const isMine = useCallback((m) => m.senderPid === myPid, [myPid]);

  const formatTime = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  // ---------- Chat: Laden & Realtime ----------
  const loadMessages = useCallback(async (rid) => {
    if (!rid) return;
    const { data, error } = await supabase
      .from("message")
      .select(
        "id, sender_name, content, created_at, sender_pid, session_id, room_id"
      )
      .eq("room_id", rid)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("message select error", error);
      return;
    }
    setMessages(
      (data ?? []).map((m) => ({
        id: m.id,
        sender: m.sender_name,
        text: m.content,
        createdAt: m.created_at,
        senderPid: m.sender_pid,
        sessionId: m.session_id,
      }))
    );
    smoothScrollToBottom();
  }, []);

  const subscribeMessages = useCallback((rid) => {
    if (!rid) return () => {};
    const ch = supabase
      .channel(`msg-room-${rid}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message",
          filter: `room_id=eq.${rid}`,
        },
        (payload) => {
          const m = payload.new;
          setMessages((prev) => {
            if (prev.some((x) => x.id === m.id)) return prev; // dedupe
            return [
              ...prev,
              {
                id: m.id,
                sender: m.sender_name,
                text: m.content,
                createdAt: m.created_at,
                senderPid: m.sender_pid,
                sessionId: m.session_id,
              },
            ];
          });
          smoothScrollToBottom();
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Vor Senden: active setzen (RLS-Policy)
  const ensureActiveParticipant = useCallback(async () => {
    if (!roomId || !myPid) return;
    try {
      await supabase
        .from("participants")
        .update({ active: true, last_seen: new Date().toISOString() })
        .eq("id", myPid)
        .eq("room_id", roomId);
    } catch {}
  }, [roomId, myPid]);

  // ---------- Chat: Senden via RPC ----------
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !roomId || !myPid || !iAmInRoom || sending) return;

    setSending(true);
    await ensureActiveParticipant();

    // 1) RPC – schreibt atomar über SECURITY DEFINER
    const { data: row, error } = await supabase.rpc("chat_send_message", {
      p_room: roomId,
      p_sender: myPid,
      p_content: text,
    });

    if (error) {
      console.group("rpc chat_send_message error");
      console.log("message:", error.message);
      console.log("details:", error.details);
      console.log("hint:", error.hint);
      console.log("code:", error.code);
      console.log("full:", JSON.stringify(error, null, 2));
      console.groupEnd();
      setSending(false);
      return;
    }

    // 2) Eingabe leeren – Anzeige kommt via Realtime bei allen Clients
    setChatInput("");
    setSending(false);

    // 3) Fallback: Falls Realtime verspätet ist, füge lokal hinzu (nur wenn noch nicht vorhanden)
    if (row && !messages.some((m) => m.id === row.id)) {
      setMessages((prev) => [
        ...prev,
        {
          id: row.id,
          sender: row.sender_name,
          text: row.content,
          createdAt: row.created_at,
          senderPid: row.sender_pid,
          sessionId: row.session_id,
        },
      ]);
      smoothScrollToBottom();
    }

    // 4) Letzte Absicherung
    setTimeout(() => loadMessages(roomId), 250);
  }, [
    chatInput,
    roomId,
    myPid,
    iAmInRoom,
    sending,
    ensureActiveParticipant,
    loadMessages,
    messages,
  ]);

  // ---------- Spielstart ----------
  const startGame = useCallback(async () => {
    try {
      const startedAtIso = new Date().toISOString();
      await supabase
        .from("rooms")
        .update({ started_at: startedAtIso })
        .eq("id", roomId);
      setIsPlaying(true);
    } catch {}

    try {
      const ch = supabase.channel(`game-room-${roomId}`);
      await ch.subscribe();
      await ch.send({
        type: "broadcast",
        event: "game_start",
        payload: { by: myPid, at: Date.now() },
      });
      supabase.removeChannel(ch);
    } catch {}

    try {
      localStorage.setItem("current_room_code", code);
      localStorage.setItem("current_room_id", roomId ?? "");
    } catch {}
  }, [roomId, myPid, code]);

  // ---------- Room laden ----------
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDbError(null);

    (async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id, started_at")
        .eq("code", code)
        .maybeSingle();

      if (error || !data) {
        if (active) {
          setDbError("Konnte Raum nicht laden.");
          setLoading(false);
        }
        return;
      }

      if (active) {
        setRoomId(data.id);
        setIsPlaying(Boolean(data.started_at));
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [code]);

  // ---------- Teilnehmer beitreten / reaktivieren ----------
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    (async () => {
      try {
        const clientId = ensureClientId();
        const defaultName = `Spieler ${Math.floor(Math.random() * 900 + 100)}`;

        // 1) Bereits gespeicherten Participant wieder aktivieren
        const storedRowId = localStorage.getItem("participant_row_id");
        if (storedRowId) {
          const { error: upErr1, count: c1 } = await supabase
            .from("participants")
            .update({ active: true })
            .eq("id", storedRowId)
            .eq("room_id", roomId)
            .select("id", { count: "exact", head: true });
          if (!upErr1 && c1 === 1) {
            if (!cancelled) setMyPid(storedRowId);
          }
        }

        // 2) Existiert (room_id, client_id)?
        const { data: existing } = await supabase
          .from("participants")
          .select("id")
          .eq("room_id", roomId)
          .eq("client_id", clientId)
          .maybeSingle();

        if (existing?.id) {
          await supabase
            .from("participants")
            .update({ active: true })
            .eq("id", existing.id);
          localStorage.setItem("participant_row_id", existing.id);
          if (!cancelled) setMyPid(existing.id);
        } else {
          // 3) Join
          const { data: upserted, error } = await supabase
            .from("participants")
            .upsert(
              [
                {
                  room_id: roomId,
                  client_id: clientId,
                  name: defaultName,
                  active: true,
                },
              ],
              {
                onConflict: "room_id,client_id",
              }
            )
            .select("id")
            .single();
          if (error) {
            if (error.message?.includes("ROOM_FULL")) {
              navigate("/", { replace: true });
              return;
            }
            setDbError(error.message);
            return;
          }
          if (!cancelled && upserted?.id) {
            localStorage.setItem("participant_row_id", upserted.id);
            setMyPid(upserted.id);
          }
        }
      } catch (e) {
        setDbError("Fehler beim Beitritt/Rejoin.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, navigate]);

  // ---------- Teilnehmerliste laden + Realtime ----------
  useEffect(() => {
    if (!roomId) return;

    let channel;

    async function loadParticipantsOnce() {
      const { data } = await supabase
        .from("participants")
        .select("id, client_id, name, joined_at, active")
        .eq("room_id", roomId)
        .eq("active", true)
        .order("joined_at", { ascending: true });
      setParticipants(
        (data ?? []).map((p) => ({
          id: p.id,
          client_id: p.client_id,
          name: p.name,
          joined_at: p.joined_at,
        }))
      );
    }

    loadParticipantsOnce();

    channel = supabase
      .channel(`room-${roomId}-participants`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          setParticipants((prev) => {
            const { eventType, new: n, old: o } = payload;

            if (eventType === "INSERT") {
              if (n.active && !prev.some((p) => p.id === n.id)) {
                return [
                  ...prev,
                  {
                    id: n.id,
                    client_id: n.client_id,
                    name: n.name,
                    joined_at: n.joined_at,
                  },
                ];
              }
            } else if (eventType === "DELETE") {
              return prev.filter((p) => p.id !== o.id);
            } else if (eventType === "UPDATE") {
              if (o.active && !n.active)
                return prev.filter((p) => p.id !== n.id);
              if (!o.active && n.active && !prev.some((p) => p.id === n.id)) {
                return [
                  ...prev,
                  {
                    id: n.id,
                    client_id: n.client_id,
                    name: n.name,
                    joined_at: n.joined_at,
                  },
                ];
              }
              return prev.map((p) =>
                p.id === n.id
                  ? { ...p, client_id: n.client_id, name: n.name }
                  : p
              );
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [roomId]);

  // ---------- Presence ----------
  useEffect(() => {
    if (!roomId) return;

    const clientId = ensureClientId();
    const presenceCh = supabase.channel(`presence-room-${roomId}`, {
      config: { presence: { key: clientId } },
    });

    presenceCh
      .on("presence", { event: "sync" }, () => {
        const state = presenceCh.presenceState();
        setOnlineClientIds(new Set(Object.keys(state)));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          presenceCh.track({
            client_id: clientId,
            room_id: roomId,
            pid: myPid,
            t: Date.now(),
          });
        }
      });

    return () => {
      supabase.removeChannel(presenceCh);
    };
  }, [roomId, myPid]);

  // ---------- Heartbeat ----------
  useEffect(() => {
    if (!roomId || !myPid) return;

    const beat = async () => {
      try {
        await supabase
          .from("participants")
          .update({ last_seen: new Date().toISOString(), active: true })
          .eq("id", myPid)
          .eq("room_id", roomId);
      } catch {}
    };

    beat();
    const t = setInterval(beat, 10000);
    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [roomId, myPid]);

  // ---------- Game-Start Broadcast ----------
  useEffect(() => {
    if (!roomId) return;
    const gameCh = supabase
      .channel(`game-room-${roomId}`)
      .on("broadcast", { event: "game_start" }, () => setIsPlaying(true))
      .subscribe();
    return () => {
      supabase.removeChannel(gameCh);
    };
  }, [roomId]);

  // ---------- Chat: initial laden + subscribe ----------
  useEffect(() => {
    if (!roomId) return;
    let unsub = () => {};
    (async () => {
      await loadMessages(roomId);
      unsub = subscribeMessages(roomId);
    })();
    return () => {
      try {
        unsub?.();
      } catch {}
    };
  }, [roomId, loadMessages, subscribeMessages]);

  // ---------- Soft-Leave ----------
  useEffect(() => {
    const softLeave = async () => {
      const pid = localStorage.getItem("participant_row_id");
      const clientId = localStorage.getItem("participant_client_id");
      try {
        if (pid) {
          await supabase
            .from("participants")
            .update({ active: false })
            .eq("id", pid);
        } else if (roomId && clientId) {
          await supabase
            .from("participants")
            .update({ active: false })
            .match({ room_id: roomId, client_id: clientId });
        }
      } catch {}
    };

    window.addEventListener("beforeunload", softLeave);
    window.addEventListener("pagehide", softLeave);
    return () => {
      window.removeEventListener("beforeunload", softLeave);
      window.removeEventListener("pagehide", softLeave);
      softLeave();
    };
  }, [roomId]);

  // ---------- UI ----------
  if (loading) return <div className="min-h-dvh bg-white" />;

  if (!roomId) {
    return (
      <div className="min-h-dvh grid place-content-center p-4">
        <div className="max-w-md rounded-xl bg-white p-6 shadow">
          <h1 className="text-lg font-semibold">Raum nicht gefunden</h1>
          <p className="mt-2 text-slate-600">
            Der Code <span className="font-mono">{code}</span> ist unbekannt.
          </p>
          <div className="mt-4">
            <Link to="/" className="text-indigo-600 hover:underline">
              ← zurück zur Lobby
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-4">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Linke Karte: Lobby ODER Quiz */}
        <div className="bg-white rounded-2xl shadow p-0 lg:p-6">
          {isPlaying ? (
            <div className="h-full">
              <div className="hidden lg:flex items-center justify-between p-6 pb-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-violet-400 px-4 py-2">
                    <span className="font-semibold text-slate-900">Raum</span>
                    <span className="font-mono text-violet-700">{code}</span>
                  </div>
                </div>
                {/* Zurück zur Lobby */}
                <Link
                  to="/"
                  className="inline-flex items-center rounded-xl px-3 py-2 border border-violet-200 text-violet-600 hover:bg-violet-50 hover:text-violet-700 transition-colors"
                >
                  ← Zurück zur Lobby
                </Link>
              </div>
              <div className="p-4 lg:p-6">
                <Quiz
                  roomId={roomId}
                  code={code}
                  embedded
                  onExit={() => setIsPlaying(false)}
                />
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-xl border border-violet-400 px-4 py-2">
                    <span className="font-semibold text-slate-900">Raum</span>
                    <span className="font-mono text-violet-700">{code}</span>
                  </div>
                </div>
                {/* Zurück zur Lobby */}
                <Link
                  to="/"
                  className="inline-flex items-center rounded-xl px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50"
                >
                  ← Zurück zur Lobby
                </Link>
              </div>

              <div className="mt-5">
                <p className="text-gray-600">
                  Teile den Link mit deiner Partnerin/deinem Partner.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={inviteUrl}
                    readOnly
                    className="flex-1 rounded-xl border border-gray-300 px-3 py-2"
                  />
                  <button
                    onClick={copyInvite}
                    className="rounded-xl px-4 py-2 bg-violet-600 text-white hover:bg-violet-700"
                  >
                    Kopieren
                  </button>
                </div>
                {copied && (
                  <div className="mt-1 text-sm text-green-600">
                    Link kopiert ✅
                  </div>
                )}
                {dbError && (
                  <div className="mt-2 text-sm text-red-600">DB: {dbError}</div>
                )}
              </div>

              <div className="mt-5 rounded-xl border border-slate-200 p-4">
                <div className="text-sm text-slate-500 mb-2">Teilnehmer</div>
                <div className="flex flex-wrap items-center gap-2">
                  {participants.length === 0 ? (
                    <span className="text-xs text-slate-500">
                      Noch niemand im Raum …
                    </span>
                  ) : (
                    participants.map((p) => {
                      const online = onlineClientIds.has(p.client_id);
                      return (
                        <span
                          key={p.id}
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs",
                            online
                              ? "bg-green-100 text-green-800"
                              : "bg-slate-100 text-slate-700",
                          ].join(" ")}
                        >
                          <span
                            className={[
                              "h-2 w-2 rounded-full",
                              online ? "bg-green-500" : "bg-slate-400",
                            ].join(" ")}
                          />
                          {p.name}
                          {p.id === myPid && (
                            <span className="opacity-60">(Ich)</span>
                          )}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="button"
                  onClick={startGame}
                  disabled={!canStart || isPlaying}
                  className={[
                    "rounded-xl px-5 py-3 text-sm font-semibold transition",
                    canStart && !isPlaying
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed",
                  ].join(" ")}
                >
                  {isPlaying ? "Spiel läuft…" : "Spiel starten"}
                </button>
                <span className="text-sm text-slate-500">
                  {canStart
                    ? isPlaying
                      ? "Gestartet"
                      : "Bereit!"
                    : "Warte auf 2. Teilnehmer…"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Rechte Karte: Chat */}
        <aside className="bg-white rounded-2xl shadow p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Chat</h2>
          </div>

          <div
            ref={scrollRef}
            className="mt-4 flex-1 overflow-y-auto space-y-2"
          >
            {messages.map((m) => {
              const mine = isMine(m);
              return (
                <div
                  key={m.id}
                  className={[
                    "flex w-full",
                    mine ? "justify-end" : "justify-start",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "max-w-[75%] flex flex-col",
                      mine ? "items-end" : "items-start",
                    ].join(" ")}
                  >
                    {/* Name nur bei anderen anzeigen */}
                    {!mine && (
                      <span className="mb-1 text-[11px] leading-none text-slate-500">
                        {m.sender}
                      </span>
                    )}

                    {/* Bubble */}
                    <div
                      className={[
                        "px-3 py-2 text-sm shadow-sm",
                        mine
                          ? "bg-indigo-600 text-white rounded-2xl rounded-tr-sm"
                          : "bg-slate-100 text-slate-800 rounded-2xl rounded-tl-sm",
                      ].join(" ")}
                    >
                      {m.text}
                    </div>

                    {/* Zeitstempel */}
                    <span
                      className={[
                        "mt-1 text-[10px] leading-none opacity-70",
                        mine ? "text-indigo-700" : "text-slate-500",
                      ].join(" ")}
                    >
                      {formatTime(m.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) sendChat();
            }}
          >
            <input
              type="text"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder={
                iAmInRoom ? "Nachricht…" : "Warte bis du im Raum bist…"
              }
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!canSend}
            >
              {sending ? "…" : "Senden"}
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
