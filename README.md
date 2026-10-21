# Milanote-Connector

Lokaler MCP-Server, mit dem Claude Milanote-Boards anlegen, befüllen, anordnen und lesen kann. Milanote hat keine öffentliche API; der Connector nutzt das private Protokoll der Web-App über einen sichtbar laufenden, angemeldeten Chrome (CDP). Cookies und Tokens bleiben im Browser.

**Stand: Phase 2 (Lesen).** MCP-Tools `whoami`, `list_boards`, `get_board`, `get_board_tree`, `search`. Notizen anlegen bisher nur per Spike-CLI; Schreib-Tools folgen in Phase 3.

- [`docs/phase1.md`](docs/phase1.md): Architektur, Einrichtung, Abnahmetest Schreiben
- [`docs/phase2.md`](docs/phase2.md): Lese-Tools, Abnahmetest Lesen
- [`docs/protocol.md`](docs/protocol.md): Protokollwissen, Quellen, Nutzungsbedingungen, offene Punkte (Phase 0)
- [`tools/probe/`](tools/probe/README.md): passives Mitschnitt-Skript mit Schwärzung

```bash
npm install
npm run chrome                       # Chrome mit eigenem Profil starten, einmal bei Milanote anmelden
npm run spike -- check               # Anmeldung + Socket prüfen, schreibt nichts
npm run spike -- note --board <url> --text "Hallo"
npm run spike -- board <url>         # Board lesen; auch: boards, tree, search <begriff>
npm start                            # MCP-Server (stdio)
npm test && npm run typecheck
```

```
src/
  session/   CDP-Verbindung, Chrome-Start, Brückentab
  protocol/  Engine.IO/Socket.IO, IDs, Aktionen
  domain/    Board-Normalisierung, Text ↔ TipTap, Platzierung
  cli/       Spike-CLI
  milanote.ts  Fassade
  server.ts    MCP-Server
tools/probe/  Mitschnitt (Phase 0)
test/
```

Inoffiziell, nicht mit Milanote verbunden. Zu den Nutzungsbedingungen siehe `docs/protocol.md`, Abschnitt 2.
