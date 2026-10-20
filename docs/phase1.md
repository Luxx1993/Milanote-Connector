# Phase 1: Fundament

Stand: 20.10.2026. Gebaut: Projekt-Setup, CDP-Session, Socket.IO-Client mit Wiederverbindung, Spike-CLI zum Anlegen einer Notiz und ein MCP-Server mit `whoami` als Durchstich.

## Architektur

```
Claude ──stdio── src/server.ts (MCP)
                     │
              src/milanote.ts  (Fassade: whoami, getBoard, createNote, Prüfung)
               │            │
   src/protocol/…        src/domain/…           Socket.IO, IDs, Aktionen | Text→TipTap, Platzierung
               │
   src/session/bridge.ts  ── CDP ──►  Chrome (eigenes Profil, sichtbar)
                                       ├─ Tab „Milanote-Connector (offen lassen)“ auf app.milanote.com/api/ping
                                       │     fetch(/api/…) und WebSocket wss://app.milanote.com/socket.io/
                                       └─ dein Milanote-Tab (zeigt die Änderungen live)
```

**Entscheidung zum Schreibweg (docs/protocol.md, 5a): Weg B.** Ein eigener, kleiner Socket.IO-Client, dessen WebSocket in einem Tab auf dem Milanote-Ursprung läuft. Gründe:
- So läuft milanote-plus-plus produktiv (Ack 200).
- Der Browser hängt Sitzungs- und WAF-Cookies selbst an. **Cookies und das langlebige Token verlassen den Browser nie**; Node sieht nur Antworten und Frames.
- Keine Abhängigkeit von React-Interna des Editors (Weg C), die bei jedem Milanote-Update brechen können.
- Die Protokolllogik (Handshake, Acks, Zeitlimits, Wiederverbindung, Reihenfolge) liegt in Node und ist ohne Netz getestet.

Ob Milanote die Schreibvorgänge dauerhaft speichert, prüft der Client nach jedem Anlegen per REST (`persisted`). Bleibt das bei dir aus, ist das die Stelle, an der wir auf Weg C umschwenken.

## Sicherheitsregeln im Code

- Kein `ELEMENT_DELETE` im Code; Papierkorb kommt in Phase 3.
- Schreiben ins Home-Board ist gesperrt (Fehler `args`), nur Unterboards.
- Der Brückentab erlaubt nur Pfade unter `/api/` und `/media-service/api/` und nur Sockets zu `wss://app.milanote.com/`.
- Debug-Port nur auf 127.0.0.1, eigenes Chrome-Profil unter `~/.milanote-connector/chrome-profile`.
- MCP-Logs gehen nur nach stderr; Tokens werden nie gelesen oder ausgegeben.

## Einrichtung

```bash
npm install
npm run chrome          # startet Chrome mit Debug-Port und eigenem Profil (Pfad über CHROME_PATH änderbar)
```

Im neuen Chrome-Fenster einmal bei Milanote anmelden (inklusive 2FA). Das Profil bleibt erhalten; beim nächsten Mal genügt `npm run chrome`. Ein laufendes normales Chrome stört nicht, das Profil ist getrennt.

## Abnahmetest

1. In Milanote ein leeres **Testboard** anlegen (nicht das Home-Board) und im Chrome-Fenster öffnen. Board-URL kopieren.
2. `npm run spike -- check`
   Erwartet: `Angemeldet: <Name> · Home-Board …` und `Socket-Handshake ok`. Es wird nichts geschrieben. Ein Hintergrund-Tab „Milanote-Connector (offen lassen)“ erscheint.
3. `npm run spike -- note --board "<Board-URL>" --text "Hallo aus Claude"`
   Erwartet: `Ack von Milanote: ja`, `Per REST gespeichert: ja`.
4. **Abnahme:** Die Notiz erscheint ohne Neuladen im offenen Board-Tab rechts neben vorhandenem Inhalt und ist nach F5 noch da.
5. Optional mit Position: `npm run spike -- note --board "<Board-URL>" --text "Hier" --x 0 --y 40`

Bitte melde mir für Schritt 3 und 4 je: ok, nicht ok (mit Ausgabe), oder „erst nach F5 sichtbar“. Mit `--verbose` zeigt das CLI Verbindungsdetails.

| Beobachtung | Bedeutung | nächster Schritt |
| --- | --- | --- |
| alles ok | Weg B trägt | Phase 2 |
| Ack ja, REST nein | Milanote verwirft still (Fehlerbild aus milanote-skill) | Mitschnitt mit `npm run probe -- capture` während du im Editor eine Notiz anlegst; Vergleich der Frames |
| REST ja, aber erst nach F5 sichtbar | gespeichert, aber keine Live-Übertragung an den Tab | Kanäle (`update-channels`) ergänzen, Phase 2 |
| `Milanote lehnt die Socket-Verbindung ab` | Socket braucht mehr als das Cookie | Mitschnitt des App-Handshakes |
| `rejected` mit Status ≠ 200 | Form der Aktion falsch | Ausgabe an mich |

## In Claude Code einbinden (nur `whoami`)

```bash
claude mcp add milanote -- node /pfad/zu/Milanote-Connector/node_modules/tsx/dist/cli.mjs /pfad/zu/Milanote-Connector/src/server.ts
```

Port über `MILANOTE_CDP_PORT` (Standard 9222). Chrome muss vorher mit `npm run chrome` laufen.

## Getestet

- Unit-Tests (40): Engine.IO/Socket.IO-Pakete, Socket-Client (Handshake, Ping/Pong, Acks, Reihenfolge, Zeitlimits, Verbindungsverlust, Wiederverbindung), IDs, Aktionsform, Text → TipTap, Platzierung, Board-URLs, Schwärzung.
- End-to-End gegen headless Chromium 141 und einen Fake-Server für `app.milanote.com` (REST, Socket.IO, Cookie-Prüfung): `check`, `note` mit und ohne Koordinaten, Home-Sperre, unbekanntes Board, Fehlermeldung ohne Anmeldung, MCP-`whoami` über stdio.
- **Nicht getestet gegen das echte Milanote.** Das ist der Abnahmetest oben.
