# Milanote-Connector

Lokaler MCP-Server, mit dem Claude Milanote-Boards anlegen, befüllen, anordnen und lesen kann. Milanote hat keine öffentliche API; der Connector nutzt das private Protokoll der Web-App über einen sichtbar laufenden, angemeldeten Browser (CDP).

**Stand: Phase 0 (Machbarkeit).** Es gibt noch keinen MCP-Server.

- [`docs/protocol.md`](docs/protocol.md): Protokollwissen aus den Referenzprojekten, Prüfung der Installationsskripte, Nutzungsbedingungen, offene Fragen, Empfehlung und Checkliste für die lokalen Tests.
- [`tools/probe/`](tools/probe/README.md): passives Mitschnitt-Skript (HTTP, Socket.IO, Downloads, Screenshot) mit automatischer Schwärzung.

```bash
npm install
npm test          # Unit-Tests (Schwärzung, Auswertung)
npm run typecheck
npm run probe     # Hilfe zum Probe-Skript
```

Inoffiziell, nicht mit Milanote verbunden. Zu den Nutzungsbedingungen siehe `docs/protocol.md`, Abschnitt 2.
