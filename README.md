# Milanote-Connector

Lokaler MCP-Server, mit dem Claude Milanote-Boards anlegen, befüllen, anordnen und lesen kann. Milanote hat keine öffentliche API; der Connector nutzt das private Protokoll der Web-App über einen sichtbar laufenden, angemeldeten Chrome (CDP). Cookies und Tokens bleiben im Browser.

**Stand: Phase 5 (Layout).** MCP-Tools zum Lesen (`whoami`, `list_boards`, `get_board`, `get_board_tree`, `search`), Schreiben (`create_board`, `add_note`, `add_link`, `add_todo_list`, `add_column`, `trash_element`) und Anordnen (`compose_board` mit fünf Layouts, `move_element`, `update_element`, `resize_element`). Bilder (Phase 4) und Export (Phase 6) fehlen noch.

- [`docs/phase1.md`](docs/phase1.md): Architektur, Einrichtung, Abnahmetest Schreiben
- [`docs/phase2.md`](docs/phase2.md): Lese-Tools, Abnahmetest Lesen
- [`docs/phase3.md`](docs/phase3.md): Schreib-Tools, Schutzregeln, **Abnahmetest**, Fehlerbilder
- [`docs/phase5.md`](docs/phase5.md): Layout-Engine, `compose_board`, Größenmodell und seine Unsicherheiten, **Abnahmetest**
- [`docs/protocol.md`](docs/protocol.md): Protokollwissen, Quellen, Nutzungsbedingungen, offene Punkte (Phase 0)
- [`tools/probe/`](tools/probe/README.md): passives Mitschnitt-Skript mit Schwärzung

```bash
npm install
npm run chrome                       # Chrome mit eigenem Profil starten, einmal bei Milanote anmelden
npm run spike -- check               # Anmeldung + Socket prüfen, schreibt nichts
npm run spike -- board <url>         # Board lesen; auch: boards, tree, search <begriff>
npm run spike -- note --parent <url> --text "Hallo"   # auch: newboard, link, todo, column, trash, update, move, resize
npm run spike -- plan --file docs/examples/compose-reise.json --ascii   # Layout ansehen, ohne Browser
npm run spike -- compose --parent <url> --file spec.json --title "Neues Board"
npm run spike -- measure <board-url> --out metrics.json   # Größen am echten Board messen
npm start                            # MCP-Server (stdio)
npm test && npm run typecheck
```

```
src/
  session/   CDP-Verbindung, Chrome-Start, Brückentab
  protocol/  Engine.IO/Socket.IO, IDs, Aktionen
  domain/    Board-Normalisierung, Hierarchie, Markdown ↔ TipTap, Platzierung
  layout/    Strategien (columns, grid, masonry, timeline, radial), Plan, Größenmodell, Vorschau
  writer.ts    Schreib-Operationen mit Timing, Abgleich und Schutzregeln
  cli/       Spike-CLI
  milanote.ts  Fassade
  measure.ts   Auswertung gemessener Kartengrößen
  server.ts    MCP-Server
tools/probe/  Mitschnitt (Phase 0)
test/
```

Inoffiziell, nicht mit Milanote verbunden. Zu den Nutzungsbedingungen siehe `docs/protocol.md`, Abschnitt 2.
