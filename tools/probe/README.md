# Probe-Skript (Phase 0, nur lokal)

Schneidet passiv mit, was die Milanote-Web-App im Browser tut: HTTP-Anfragen und -Antworten, WebSocket-Frames (Socket.IO) und Downloads. Das Skript **sendet selbst nichts an Milanote**; alle Aktionen machst du von Hand im Browser. Ziel: Bild-Upload, Export und die offenen Protokollfragen aus `docs/protocol.md` klären.

## Sicherheit vorab

- Der Debug-Port gibt **jedem Programm auf deinem Rechner volle Kontrolle über diesen Browser**, inklusive angemeldeter Sitzungen. Deshalb: eigenes Chrome-Profil nur für diesen Zweck, nur Milanote darin anmelden, Chrome nach dem Mitschnitt schließen.
- Seit Chrome 136 ignoriert Chrome `--remote-debugging-port` im Standardprofil. Ein eigenes Profil (`--user-data-dir`) ist also ohnehin Pflicht. Du meldest dich darin einmal bei Milanote an (inklusive 2FA).
- Erst anmelden, dann mitschneiden. Passwörter werden zwar geschwärzt, gehören aber gar nicht erst in einen Mitschnitt.
- Mitschnitte liegen in `tools/probe/captures/` (gitignored, Dateirechte 0600). Sie enthalten **Boardinhalte, Element-IDs und deine Nutzer-ID**. Nie committen, nie komplett weitergeben.

## Was geschwärzt wird

Vor dem Schreiben läuft jede Zeile durch `src/redact.ts` (Tests in `test/probe/redact.test.ts`):

- Header `Authorization`, `Cookie`, `Set-Cookie`, `x-amz-*`, `milanote-com-permission-tokens` und alles mit token/secret/signature/session/csrf im Namen. Bei Cookies bleiben die Namen lesbar, die Werte werden `REDACTED`.
- Query-Parameter mit Signaturen und Tokens (`X-Amz-Signature`, `X-Amz-Credential`, `X-Amz-Security-Token`, `tokens`, `p` aus Share-Links, …).
- JSON-Felder `token(s)`, `password`, `email`, `permissionId`, `captcha`, … in Bodys und Socket.IO-Frames.
- JWTs, `Bearer …` und E-Mail-Adressen überall im Text, dazu eine letzte Prüfung je fertiger Zeile.
- Engine.IO-Ping/Pong wird ausgelassen (nur gezählt), binäre Bodys werden nicht gespeichert, nur ihre Größe.

## Ablauf

```bash
npm install

# 1. Chrome mit eigenem Profil und Debug-Port starten
# Windows (PowerShell):
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:USERPROFILE\milanote-probe-profile" https://app.milanote.com
# macOS:
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/milanote-probe-profile" https://app.milanote.com
# Linux:
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/milanote-probe-profile" https://app.milanote.com

# 2. Im neuen Fenster bei Milanote anmelden und das Testboard öffnen

# 3. Verbindung prüfen
npm run probe -- targets

# 4. Mitschnitt starten. Vor jeder Aktion im Browser eine Markierung tippen + Enter,
#    z. B. "Bild per Datei hochladen". Mit "q" + Enter beenden.
npm run probe -- capture

# 5. Auswerten (Markdown, ohne Boardinhalte)
npm run probe -- summarize tools/probe/captures/<datei>.capture.jsonl

# Screenshot des sichtbaren Milanote-Tabs (Fenster darf nicht minimiert sein)
npm run probe -- screenshot
```

Optionen für `capture`: `--port`, `--out`, `--all-hosts` (auch fremde Hosts), `--keep-pings`, `--max-body <zeichen>`. Standardmäßig werden nur `*.milanote.com`, `*.amazonaws.com` (signierte Uploads) und `*.cloudfront.net` mitgeschnitten; Telemetrie (New Relic) und WAF-Challenge werden ausgefiltert.

## Was abgedeckt ist

| Frage | Woran man es im Mitschnitt sieht |
| --- | --- |
| Bild-Upload | `POST …/attachments/presign`, danach `PUT` an `*.amazonaws.com` (nur Größe, kein Inhalt), dazu `action:ELEMENT_CREATE`/`ELEMENT_UPDATE` im Socket |
| Bild per URL | `POST …/link` (Media-Service), danach `action:ELEMENT_SET_TYPE` |
| Export PDF/PNG/Markdown | neue Endpunkte, `download.begin` mit Dateiname |
| Schreibaktionen | `action:<TYPE>` mit Keys in der Zusammenfassung, Rohform in der JSONL-Datei |
| Timing | Feld `t` (ms seit Start) in jeder Zeile |

Getestet wurde das Skript gegen Chromium 141 und einen lokalen Fake-Server, der `app.milanote.com` nachbildet (HTTP, WebSocket, Download). Gegen das echte Milanote ist es noch nicht gelaufen.
