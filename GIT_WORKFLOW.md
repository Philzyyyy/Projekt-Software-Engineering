<<<<<<< HEAD
📝 Git-Workflow (Checkliste für unser Projekt)

1. Neues Update starten
   git pull origin main

Holt die neuesten Änderungen von GitHub.

Wichtig, bevor du selbst etwas änderst → so vermeidest du Konflikte.

2. Änderungen machen

Dateien bearbeiten, speichern.

Änderungen prüfen:

git status

3. Änderungen vormerken & committen
   git add .
   git commit -m "kurze Beschreibung der Änderung"

👉 Beispiele für Commit-Nachrichten:

feat: add room creation button

fix: correct typo in Lobby page

docs: update README with Git workflow

4. Änderungen hochladen
   git push origin main

Schiebt deine Änderungen nach GitHub.

Vercel baut automatisch neu → Live-Version wird aktualisiert.

⚠️ Typische Stolperfallen

Konflikt bei Push („non-fast-forward“)
→ erst git pull --rebase origin main, Konflikte lösen, dann git push.

--force Push nur wenn bewusst der Remote-Stand überschrieben werden soll (selten nötig).

Keine Secrets committen → .env darf nie ins Repo.

💡 Tipps

Lieber kleine Commits statt riesiger Sammelcommits.

Commit-Message immer im Präsens, kurz & eindeutig.

Vor dem Urlaub oder längeren Pausen: Push machen, damit dein Stand sicher online ist.
