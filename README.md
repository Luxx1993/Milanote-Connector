# Milanote-Connector

Lokaler MCP-Server, mit dem Claude Milanote-Boards anlegen, befüllen, anordnen und lesen kann. Milanote hat keine öffentliche API; der Connector nutzt das private Protokoll der Web-App über einen sichtbar laufenden, angemeldeten Chrome (CDP). Cookies und Tokens bleiben im Browser.

**Stand: Phase 1 (Fundament).** Notizen anlegen per Spike-CLI, MCP-Server mit `whoami`. Weitere Tools ab Phase 2.

- [`docs/phase1.md`](docs/phase1.md): Architektur, Einrichtung, **Abnahmetest**
- [`docs/protocol.md`](docs/protocol.md): Protokollwissen, Quellen, Nutzungsbedingungen, offene Punkte (Phase 0)
- [`tools/probe/`](tools/probe/README.md): passives Mitschnitt-Skript mit Schwärzung

```bash
npm install
npm run chrome                       # Chrome mit eigenem Profil starten, einmal bei Milanote anmelden
npm run spike -- check               # Anmeldung + Socket prüfen, schreibt nichts
npm run spike -- note --board <url> --text "Hallo"
npm start                            # MCP-Server (stdio)
npm test && npm run typecheck
```

```
src/
  session/   CDP-Verbindung, Chrome-Start, Brückentab
  protocol/  Engine.IO/Socket.IO, IDs, Aktionen
  domain/    Text → TipTap, Platzierung
  cli/       Spike-CLI
  milanote.ts  Fassade
  server.ts    MCP-Server
tools/probe/  Mitschnitt (Phase 0)
test/
```

Inoffiziell, nicht mit Milanote verbunden. Zu den Nutzungsbedingungen siehe `docs/protocol.md`, Abschnitt 2.
