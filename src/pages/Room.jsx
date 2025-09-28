// src/pages/Room.jsx
import { useParams, Link, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import supabase from "../lib/supabaseClient";

export default function Room() {
  const { code } = useParams();
  const navigate = useNavigate();

  // ----- State -----
  const [copied, setCopied] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]); // Dummy-Chat nur lokal
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [myPid, setMyPid] = useState(
    typeof window !== "undefined"
      ? localStorage.getItem("participant_row_id")
      : null
  );
  const [onlineClientIds, setOnlineClientIds] = useState(new Set()); // Presence (Option A)
  const scrollRef = useRef(null);

  const inviteUrl = useMemo(
    () => `${window.location.origin}/room/${code}`,
    [code]
  );

  // Wir starten das Spiel, wenn in der DB 2 aktive Teilnehmer sind.
  const canStart = participants.length >= 2;

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

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // no-op
    }
  };

  const myDisplayName = () => {
    return participants.find((p) => p.id === myPid)?.name ?? "Ich";
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        sender: myDisplayName(),
        text: chatInput.trim(),
      },
    ]);
    setChatInput("");
    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 0);
  };

  // ---------- 1) Raum-ID aus Code laden ----------
  useEffect(() => {
    let active = true;
    setLoading(true);
    setDbError(null);

    (async () => {
      const { data, error } = await supabase
        .from("rooms")
        .select("id")
        .eq("code", code)
        .maybeSingle();

      if (error) {
        console.error("rooms select error", error);
        if (active) setDbError("Konnte Raum nicht laden.");
      }
      if (active) {
        setRoomId(data?.id ?? null);
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [code]);

  // ---------- 2) Betreten/Rejoin: bestehende Zeile reaktivieren (active=true), sonst upsert ----------
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    (async () => {
      try {
        const clientId = ensureClientId();
        const defaultName = `Spieler ${Math.floor(Math.random() * 900 + 100)}`;

        // 2.1 Reaktivieren per gespeicherter Row-ID
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
            const { data: fresh } = await supabase
              .from("participants")
              .select("id, client_id, name, joined_at")
              .eq("room_id", roomId)
              .eq("active", true)
              .order("joined_at", { ascending: true });
            if (!cancelled && fresh) setParticipants(fresh);
            return;
          }
        }

        // 2.2 Prüfen, ob (room_id, client_id) existiert
        const { data: existing, error: selErr } = await supabase
          .from("participants")
          .select("id, name")
          .eq("room_id", roomId)
          .eq("client_id", clientId)
          .maybeSingle();

        if (!selErr && existing?.id) {
          const { error: upErr2 } = await supabase
            .from("participants")
            .update({ active: true })
            .eq("id", existing.id)
            .eq("room_id", roomId);

          if (!upErr2) {
            localStorage.setItem("participant_row_id", existing.id);
            if (!cancelled) setMyPid(existing.id);
            const { data: fresh } = await supabase
              .from("participants")
              .select("id, client_id, name, joined_at")
              .eq("room_id", roomId)
              .eq("active", true)
              .order("joined_at", { ascending: true });
            if (!cancelled && fresh) setParticipants(fresh);
            return;
          }
        }

        // 2.3 Kein bestehender Datensatz -> normaler Join via UPSERT
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
            { onConflict: "room_id,client_id" }
          )
          .select("id, name")
          .single();

        if (error) {
          console.error("participants upsert error", error);
          if (error.message?.includes("ROOM_FULL")) {
            alert("Dieser Raum ist bereits voll (max. 2).");
            navigate("/", { replace: true });
            return;
          }
          setDbError(error.message);
          return;
        }

        if (!cancelled && upserted?.id) {
          localStorage.setItem("participant_row_id", upserted.id);
          setMyPid(upserted.id);
          const { data: fresh } = await supabase
            .from("participants")
            .select("id, client_id, name, joined_at")
            .eq("room_id", roomId)
            .eq("active", true)
            .order("joined_at", { ascending: true });
          if (!cancelled && fresh) setParticipants(fresh);
        }
      } catch (e) {
        console.error(e);
        setDbError("Fehler beim Beitritt/Rejoin.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId, navigate]);

  // ---------- 3) Teilnehmer initial laden + Realtime abonnieren (nur active=true) ----------
  useEffect(() => {
    if (!roomId) return;

    let channel;

    async function loadParticipants() {
      const { data, error } = await supabase
        .from("participants")
        .select("id, client_id, name, joined_at")
        .eq("room_id", roomId)
        .eq("active", true)
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("participants select error", error);
        setDbError(error.message);
        return;
      }
      setParticipants(data ?? []);
    }

    loadParticipants();

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
            const { eventType, new: newRow, old: oldRow } = payload;

            if (eventType === "INSERT") {
              if (
                newRow.active === true &&
                !prev.some((p) => p.id === newRow.id)
              ) {
                return [
                  ...prev,
                  {
                    id: newRow.id,
                    client_id: newRow.client_id,
                    name: newRow.name,
                    joined_at: newRow.joined_at,
                  },
                ];
              }
            } else if (eventType === "DELETE") {
              return prev.filter((p) => p.id !== oldRow.id);
            } else if (eventType === "UPDATE") {
              if (oldRow.active === true && newRow.active === false) {
                return prev.filter((p) => p.id !== newRow.id);
              }
              if (oldRow.active === false && newRow.active === true) {
                if (!prev.some((p) => p.id === newRow.id)) {
                  return [
                    ...prev,
                    {
                      id: newRow.id,
                      client_id: newRow.client_id,
                      name: newRow.name,
                      joined_at: newRow.joined_at,
                    },
                  ];
                }
              }
              return prev.map((p) =>
                p.id === newRow.id
                  ? { ...p, client_id: newRow.client_id, name: newRow.name }
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

  // ---------- 3b) Fallback: alle 8s neu laden ----------
  useEffect(() => {
    if (!roomId) return;
    let stopped = false;

    async function refresh() {
      const { data } = await supabase
        .from("participants")
        .select("id, client_id, name, joined_at")
        .eq("room_id", roomId)
        .eq("active", true)
        .order("joined_at", { ascending: true });
      if (!stopped && data) setParticipants(data);
    }

    const t = setInterval(refresh, 8000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [roomId]);

  // ---------- 3c) Presence (Option A): sofortige Online/Offline-Anzeige ohne DB-Writes ----------
  useEffect(() => {
    if (!roomId) return;

    const clientId = ensureClientId();

    const presenceCh = supabase.channel(`presence-room-${roomId}`, {
      config: { presence: { key: clientId } },
    });

    presenceCh
      .on("presence", { event: "sync" }, () => {
        const state = presenceCh.presenceState(); // { clientId: [{...}], ...}
        const keys = Object.keys(state);
        setOnlineClientIds(new Set(keys));
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

  // ---------- 3d) Heartbeat: hält last_seen & active=true (HB 10s), startet erst mit myPid ----------
  useEffect(() => {
    if (!roomId || !myPid) return;

    const beat = async () => {
      try {
        await supabase
          .from("participants")
          .update({ last_seen: new Date().toISOString(), active: true })
          .eq("id", myPid)
          .eq("room_id", roomId);
      } catch {
        /* best-effort */
      }
    };

    beat(); // sofort
    const t = setInterval(beat, 10000); // alle 10s
    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [roomId, myPid]);

  // ---------- 4) Verlassen: Soft Leave (active=false) bei Close/Route-Leave ----------
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
      } catch {
        /* best-effort */
      }
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
  if (loading) {
    return (
      <div className="min-h-dvh grid place-content-center p-4">
        <div className="text-slate-600">Lade Raum …</div>
      </div>
    );
  }

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

  const onlineCount = participants.reduce(
    (acc, p) => acc + (onlineClientIds.has(p.client_id) ? 1 : 0),
    0
  );

  return (
    <div className="min-h-dvh p-4">
      <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Linke Karte: Lobby-Inhalt */}
        <div className="bg-white rounded-2xl shadow p-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-content-center rounded-xl bg-slate-900 text-white">
                🏛️
              </div>
              <div>
                <div className="text-sm text-slate-500">Raum</div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                  {code}
                </h1>
              </div>
            </div>
            <div className="text-sm text-slate-700">
              Teilnehmer (aktiv):{" "}
              <span className="font-semibold">{participants.length}</span>
              <span className="ml-3 text-slate-500">online: {onlineCount}</span>
            </div>
          </div>

          {/* Hinweis, wenn Partner offline (Presence) */}
          {participants.length >= 1 && onlineCount < 2 && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              Warten auf zweiten Spieler...
            </div>
          )}

          {/* Invite */}
          <div className="mt-5">
            <p className="text-gray-600">
              Teile den Link mit deiner Partnerin/deinem Partner, damit sie
              beitreten kann.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={inviteUrl}
                readOnly
                className="flex-1 rounded-xl border border-gray-300 px-3 py-2"
              />
              <button
                onClick={copyInvite}
                className="rounded-xl px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700"
              >
                Kopieren
              </button>
            </div>
            {copied && (
              <div className="mt-1 text-sm text-green-600">Link kopiert ✅</div>
            )}
            {dbError && (
              <div className="mt-2 text-sm text-red-600">DB: {dbError}</div>
            )}
            {participants.length >= 2 &&
              !participants.some((p) => p.id === myPid) && (
                <div className="mt-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Der Raum ist voll.{" "}
                  <button
                    className="underline"
                    onClick={() => navigate("/", { replace: true })}
                  >
                    Zur Lobby
                  </button>
                </div>
              )}
          </div>

          {/* Teilnehmerliste mit Presence-Status */}
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

          {/* CTA: Spiel starten – weiterhin über DB-Status (2 aktive) */}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              disabled={!canStart}
              className={[
                "rounded-xl px-5 py-3 text-sm font-semibold transition",
                canStart
                  ? "bg-indigo-600 text-white hover:bg-indigo-500"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed",
              ].join(" ")}
            >
              Spiel starten
            </button>
            <span className="text-sm text-slate-500">
              {canStart ? "Bereit!" : "Warte auf 2. Teilnehmer…"}
            </span>
          </div>

          {/* Workflow-Info */}
          <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-600">
            <span className="font-medium">Anleitung:</span> Das Spiel kann
            gestartet werden, sobald zwei Spieler der Lobby beigetreten sind.
          </div>

          {/* Back link */}
          <div className="pt-6">
            <Link to="/" className="text-indigo-600 hover:underline">
              ← zurück zur Lobby
            </Link>
          </div>
        </div>

        {/* Rechte Karte: Chat (nur Demo, lokal) */}
        <aside className="bg-white rounded-2xl shadow p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Chat</h2>
          </div>

          <div
            ref={scrollRef}
            className="mt-4 flex-1 overflow-y-auto space-y-2"
          >
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">Noch keine Nachrichten …</p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="flex flex-col">
                  <span className="text-xs text-slate-500">{m.sender}</span>
                  <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-800 inline-block w-fit max-w-[75%]">
                    {m.text}
                  </span>
                </div>
              ))
            )}
          </div>

          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
          >
            <input
              type="text"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Nachricht…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Senden
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
