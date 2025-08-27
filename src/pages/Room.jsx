// src/pages/Room.jsx
import { useParams, Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import supabase from "../lib/supabaseClient";

export default function Room() {
  const { code } = useParams();

  // ----- State -----
  const [copied, setCopied] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]); // Dummy-Chat nur lokal
  const [chatInput, setChatInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const scrollRef = useRef(null);

  const inviteUrl = useMemo(
    () => `${window.location.origin}/room/${code}`,
    [code]
  );
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
    const meRowId = localStorage.getItem("participant_row_id");
    return participants.find((p) => p.id === meRowId)?.name ?? "Ich";
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

  // ---------- 2) Mich als Participant anlegen (Upsert auf room_id+client_id) ----------
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;

    (async () => {
      try {
        const clientId = ensureClientId();
        const defaultName = `Spieler ${Math.floor(Math.random() * 900 + 100)}`;

        const { data, error } = await supabase
          .from("participants")
          .upsert(
            [{ room_id: roomId, client_id: clientId, name: defaultName }],
            { onConflict: "room_id,client_id" }
          )
          .select("id, name")
          .single();

        if (error) {
          console.error("participants upsert error", error);
          setDbError(error.message);
          return;
        }
        if (!cancelled && data?.id) {
          localStorage.setItem("participant_row_id", data.id);
        }
      } catch (e) {
        console.error(e);
        setDbError("Fehler beim Anlegen des Teilnehmers.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // ---------- 3) Teilnehmer initial laden + Realtime abonnieren ----------
  useEffect(() => {
    if (!roomId) return;

    let channel;

    async function loadParticipants() {
      const { data, error } = await supabase
        .from("participants")
        .select("id, name, joined_at")
        .eq("room_id", roomId)
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
              if (!prev.some((p) => p.id === newRow.id)) {
                return [
                  ...prev,
                  {
                    id: newRow.id,
                    name: newRow.name,
                    joined_at: newRow.joined_at,
                  },
                ];
              }
            } else if (eventType === "DELETE") {
              return prev.filter((p) => p.id !== oldRow.id);
            } else if (eventType === "UPDATE") {
              return prev.map((p) =>
                p.id === newRow.id ? { ...p, name: newRow.name } : p
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

  // ---------- 4) Beim Schließen/Unmount: eigenen Participant löschen ----------
  useEffect(() => {
    const leave = () => {
      const pid = localStorage.getItem("participant_row_id");
      if (pid) {
        // Fire-and-forget – in SPAs kann der Request abgebrochen werden, für Prototyp ok.
        supabase.from("participants").delete().eq("id", pid);
        localStorage.removeItem("participant_row_id");
      }
    };
    // a) Browser/Tab schließen oder neu laden
    window.addEventListener("beforeunload", leave);
    // b) Komponente unmountet (z.B. Routewechsel)
    return () => {
      window.removeEventListener("beforeunload", leave);
      leave();
    };
  }, []);

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
              Teilnehmer:{" "}
              <span className="font-semibold">{participants.length}</span>
            </div>
          </div>

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
          </div>

          {/* Teilnehmerliste */}
          <div className="mt-5 rounded-xl border border-slate-200 p-4">
            <div className="text-sm text-slate-500 mb-2">Teilnehmer</div>
            <div className="flex flex-wrap items-center gap-2">
              {participants.length === 0 ? (
                <span className="text-xs text-slate-500">
                  Noch niemand im Raum …
                </span>
              ) : (
                participants.map((p) => (
                  <span
                    key={p.id}
                    className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-800"
                  >
                    {p.name}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* CTA: Spiel starten – ohne Spielansicht */}
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
            <span className="font-medium">Workflow:</span> Diskutiert im Chat
            und stimmt euch ab. Sobald ihr zu zweit seid, könnt ihr{" "}
            <span className="font-semibold">„Spiel starten“</span> klicken. Die
            eigentliche Spiel-/Fragenansicht ist hier bewusst nicht enthalten.
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
