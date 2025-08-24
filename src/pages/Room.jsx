import { useParams, Link } from "react-router-dom";
import { useState } from "react";

export default function Room() {
  const { code } = useParams();
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/room/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: nichts tun
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6 space-y-4">
        <h1 className="text-xl font-semibold">Raum: {code}</h1>
        <p className="text-gray-600">
          Teile den Link mit deiner Partnerin, damit sie beitreten kann.
        </p>

        <div className="flex items-center gap-2">
          <input
            value={`${location.origin}/room/${code}`}
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
          <div className="text-sm text-green-600">Link kopiert ✅</div>
        )}

        <div className="pt-2">
          <Link to="/" className="text-indigo-600 hover:underline">
            ← zurück zur Lobby
          </Link>
        </div>
      </div>
    </div>
  );
}
