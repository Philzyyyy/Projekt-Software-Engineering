import { useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../lib/supabaseClient";

// <-- euer zentraler Client

function genCode(len = 5) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXZ0123456789";
  return Array.from(
    { length: len },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

const validCode = (v) => /^[A-Z0-9]{5}$/.test(v);

export default function Lobby() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Raum erstellen -> INSERT in rooms, bei Kollision neuen Code probieren
  const onCreate = async () => {
    if (busy) return;
    setBusy(true);
    setError("");

    for (let i = 0; i < 3; i++) {
      const c = genCode();
      const { error: insertErr } = await supabase
        .from("rooms")
        .insert({ code: c });
      if (!insertErr) {
        setBusy(false);
        navigate(`/room/${c}`);
        return;
      }
      // Nur bei echter Duplicate weiterversuchen – sonst abbrechen
      const msg = String(insertErr.message || "").toLowerCase();
      if (!msg.includes("duplicate") && !msg.includes("unique")) {
        setBusy(false);
        setError("Konnte Raum nicht erstellen. Bitte später erneut versuchen.");
        return;
      }
    }

    setBusy(false);
    setError(
      "Konnte keinen eindeutigen Code erzeugen. Bitte erneut versuchen."
    );
  };

  // Beitreten -> SELECT rooms by code
  const onJoin = async () => {
    if (!validCode(code)) {
      setError("Bitte 5-stelligen Code (A–Z, 0–9) eingeben.");
      return;
    }
    setBusy(true);
    setError("");

    const { data, error: selectErr } = await supabase
      .from("rooms")
      .select("code")
      .eq("code", code)
      .maybeSingle();

    setBusy(false);

    if (selectErr) {
      setError("Prüfung fehlgeschlagen. Bitte später erneut versuchen.");
      return;
    }
    if (!data) {
      setError("Raum nicht gefunden. Prüfe den Code.");
      return;
    }
    navigate(`/room/${code}`);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    await onJoin();
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-6">
        <h1 className="text-2xl font-semibold">Quiz • Lobby</h1>

        <button
          onClick={onCreate}
          disabled={busy}
          className="w-full rounded-xl py-3 px-4 bg-indigo-600 text-white font-medium hover:bg-indigo-700 active:opacity-90 disabled:opacity-50"
        >
          {busy ? "Erstelle…" : "Raum erstellen"}
        </button>

        <form onSubmit={onSubmit} className="space-y-2">
          <label className="block text-sm font-medium">
            Mit Code beitreten
          </label>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
              placeholder="z. B. ABC12"
              maxLength={5}
              className="flex-1 rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              aria-invalid={!!error}
              aria-describedby={error ? "code-error" : undefined}
            />
            <button
              type="submit"
              disabled={!validCode(code) || busy}
              className="rounded-xl px-4 py-2 bg-gray-900 text-white hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Beitreten
            </button>
          </div>
          <p
            id="code-error"
            className="text-sm text-red-600 min-h-5"
            aria-live="polite"
          >
            {error || " "}
          </p>
        </form>
      </div>
    </div>
  );
}
