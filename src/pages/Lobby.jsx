// src/pages/Lobby.jsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import supabase from "../lib/supabaseClient";

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

  // Raum erstellen
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

  // Beitreten
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
    <div className="min-h-dvh flex flex-col items-center justify-between bg-white p-4 sm:p-6 lg:p-10">
      {/* 2-spaltiges Layout */}
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        {/* ===== Linke Spalte ===== */}
        <section className="w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Quiz • Lobby
          </h1>

          <button
            onClick={onCreate}
            disabled={busy}
            className="mt-6 inline-flex items-center justify-center gap-2 w-full rounded-xl py-3.5 px-4 
             bg-violet-600 text-white font-medium shadow-sm hover:bg-violet-700 
             active:opacity-90 disabled:opacity-50 transition-colors 
             focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {busy ? "Erstelle…" : "Raum erstellen"}
          </button>

          <form onSubmit={onSubmit} className="mt-6 space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              Mit Code beitreten
            </label>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().trim())}
                placeholder="z. B. ABC12"
                maxLength={5}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                aria-invalid={!!error}
                aria-describedby={error ? "code-error" : undefined}
              />
              <button
                type="submit"
                disabled={!validCode(code) || busy}
                className="rounded-xl px-4 py-2.5 bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
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
        </section>

        {/* ===== Rechte Spalte ===== */}
        <aside className="w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sm:p-8 relative overflow-hidden">
          <div className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full bg-violet-200/40 blur-3xl" />
          <h2 className="text-xl font-semibold tracking-tight">
            Fragen zum Pool hinzufügen
          </h2>
          <p className="mt-2 text-slate-600 leading-relaxed">
            Lege eigene Fragen an und erweitere den Fragensatz
          </p>

          <Link
            to="/add-question"
            className="mt-6 inline-flex items-center justify-center gap-2 w-full rounded-xl py-3.5 px-4 
             bg-violet-600 text-white font-medium shadow-sm hover:bg-violet-700 
             active:opacity-90 transition-colors 
             focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            Fragen hinzufügen
          </Link>

          <div className="mt-8 h-px bg-slate-200" />

          <ul className="mt-6 space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span className="mt-0.5">➕</span>
              Single-Choice
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5">➕</span>
              Teile Fragen mit der Community
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5">➕</span>
              Kategorien & Schwierigkeitsgrad setzen
            </li>
          </ul>
        </aside>
      </div>

      {/* ===== Fußnote ===== */}
      <footer className="w-full max-w-5xl mt-8 mb-4">
        <div className="flex flex-col items-center gap-2 text-xs sm:text-sm text-slate-600">
          <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link to="#" className="text-violet-600 hover:underline">
              Benutzerhandbuch
            </Link>
            <span className="text-slate-400">·</span>
            <Link to="#" className="text-violet-600 hover:underline">
              Impressum
            </Link>
          </nav>
          <p className="text-center">
            Copyright © 2025 Quizmaster AG. All Rights Reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
