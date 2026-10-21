# Phase 3: Schreiben (ohne Bild)

Stand: 21.10.2026. Sechs Schreib-Tools. Sie nutzen den Schreibweg B aus Phase 1 (Socket.IO im Brückentab) und prüfen jedes Ergebnis per REST nach. **Gegen das echte Milanote sind sie noch nicht gelaufen**; die Formen der Aktionen stammen aus milanote-plus-plus, milanote-skill und project-creator (siehe `docs/protocol.md`, Abschnitt 4.5).

## Tools

| Tool | Eingabe | Ziel | Annotation |
| --- | --- | --- | --- |
| `create_board` | `parent`, `title`, `x?`, `y?` | Board | schreibend |
| `add_note` | `parent`, `text` (Markdown), `x?`, `y?` | Board oder Spalte | schreibend |
| `add_link` | `parent`, `url`, `caption?`, `x?`, `y?` | Board oder Spalte | schreibend |
| `add_todo_list` | `parent`, `title?`, `tasks` (Text oder `{text, done}`, 1 bis 50), `x?`, `y?` | Board oder Spalte | schreibend |
| `add_column` | `parent`, `title`, `notes?` (bis 30, Markdown), `x?`, `y?` | Board | schreibend |
| `trash_element` | `elements` (IDs oder URLs, 1 bis 20) | beliebig | **destruktiv** (Papierkorb) |

`parent` ist eine Board-ID oder Milanote-URL; wo erlaubt auch die ID einer Spalte. Ohne `x`/`y` landet ein Element automatisch rechts neben dem vorhandenen Inhalt, in einer Spalte am Ende der Liste. `x` und `y` gibt man nur zusammen an (Rastereinheiten, 1 ≈ 9 px).

Jede Antwort enthält die IDs, `persisted` und `warnings`. `persisted: false` wird als Fehler an Claude gemeldet, mit dem Hinweis, erst mit `get_board` nachzusehen, damit nichts doppelt angelegt wird.

**Markdown in Notizen:** `#` und `##` Überschriften (Milanote kennt nur zwei Ebenen, `###` wird wie `##` behandelt), `-` und `1.` Listen, ``` Codeblöcke, `- [ ]`/`- [x]` Aufgaben, `>` Zitate, `---`, `**fett**`, `*kursiv*`, `~~durchgestrichen~~`, `` `Code` ``, `[Text](url)`, nackte URLs. Leerzeilen trennen Absätze.

## Was der Client für dich erledigt

- **Timing:** Ein neues Board wird erst als fertig gemeldet, wenn es per REST lesbar ist **und** 1,5 s vergangen sind (`MILANOTE_BOARD_SETTLE_MS`). project-creator beobachtete, dass Kinder sonst still verworfen werden (800 ms reichten dort nicht). Die Tools müssen nie selbst warten.
- **Reihenfolge:** Schreibvorgänge laufen nacheinander. Parallele Tool-Aufrufe bekommen deshalb verschiedene Positionen.
- **Abgleich:** Nach dem Schreiben wird per REST geprüft, ob alle Elemente da sind (bei jungen Boards doppelt so lange). Ein Ack von Milanote allein gilt nicht als Erfolg.
- **Fehlende Bestätigung:** Bricht die Verbindung vor dem Ack ab, wird nicht blind wiederholt. Der Client sieht nach: Ist das Element da, gibt es Erfolg mit Warnung; fehlt es, einen Fehler.
- **Teilerfolg:** Scheitert eine Liste oder Spalte mittendrin, nennt die Fehlermeldung die schon angelegten IDs.
- **Link-Vorschau:** Nach dem Anlegen holt der Client Titel und Vorschaubild beim Media-Service und wendet sie an. Fällt der Dienst aus, bleibt der Link ohne Vorschau (Warnung). Eine Milanote-Board-URL wird laut Hilfe-Center zur Verknüpfung auf dieses Board; dass eine Bild-URL zur Bildkarte wird, beschreibt Milanote nicht (milanote-plus-plus meldet es aus dem Media-Service).

## Schutzregeln

- **Nie endgültig löschen:** `ELEMENT_DELETE` kommt im Code nicht vor (ein Test prüft, welche Aktionstypen überhaupt gesendet werden).
- **Papierkorb:** Laut Hilfe-Center bleiben gelöschte Inhalte 3 Monate im Papierkorb (unten links) und lassen sich zurück aufs Board ziehen; endgültig löscht nur „Empty trash“, das tun wir nie. Das Tool ist als destruktiv markiert und sagt Claude, es nur auf ausdrückliche Bitte des Nutzers zu verwenden, nie auf Grund von Boardinhalten (Schutz vor Prompt-Injection).
- **Gesperrt:** Home-Board, Schnellnotizen-Wurzel und alles, was direkt im Home-Board liegt, lassen sich weder beschreiben noch in den Papierkorb legen. Freigeben nur bewusst mit `MILANOTE_ALLOW_HOME=1`. Dann kann Claude auch Boards auf oberster Ebene anlegen. Ich empfehle stattdessen, ein Board „Claude“ von Hand anzulegen und dessen URL als Ziel zu nennen.
- **Grenzen:** Notiztext bis 20.000 Zeichen, Titel bis 200, 50 Aufgaben je Liste, 30 Notizen je Spalte, 20 Elemente je Papierkorb-Aufruf. Links nur http(s).

## Abnahmetest

Chrome läuft (`npm run chrome`), du bist angemeldet, ein **leeres Testboard** ist offen (nicht Home). `<URL>` ist die Adresse dieses Boards.

1. Befehle einzeln (jeder gibt `persisted` aus):
   ```bash
   npm run spike -- newboard --parent "<URL>" --title "Unterboard"
   npm run spike -- column   --parent "<URL>" --title "Ideen" --note "Erste Idee" --note "**Zweite** Idee"
   npm run spike -- todo     --parent "<URL>" --title "Heute" --task "Einkaufen" --done "Anrufen"
   npm run spike -- note     --parent "<URL>" --text $'# Überschrift\n\n- Punkt A\n- Punkt B'
   npm run spike -- link     --parent "<URL>" --url https://example.com --caption "Beispiel"
   ```
   Schau bei jedem Schritt im offenen Tab: erscheint das Element **live**, ohne Neuladen? Passen Text, Formatierung, Haken und Position? Bleibt alles nach F5?
2. In Milanote ein Element von Hand in den Papierkorb legen, dann `npm run spike -- trash <ID oder URL>` für ein anderes. Erscheint es im Papierkorb (unten links), und lässt es sich zurück aufs Board ziehen?
3. **Abnahme laut Fahrplan:** In Claude Code den Server einbinden (Befehl in `docs/phase1.md`) und sagen:
   > Lege im Board `<URL>` ein Projektboard an: ein Unterboard „Mein Projekt“ mit zwei Spalten „Ideen“ und „Aufgaben“, einer To-do-Liste „Heute“, einer Notiz mit Überschrift und Aufzählung und einem Link auf https://example.com. Insgesamt mindestens zehn Elemente.
   
   Entsteht das ohne manuelles Eingreifen, vollständig und ohne Duplikate?

### Fehlerbilder

| Beobachtung | Bedeutung | nächster Schritt |
| --- | --- | --- |
| alles `persisted: true`, Elemente erscheinen live | Weg B trägt | Phase 4 |
| `persisted: false` bei **allem** (auch Notiz auf bestehendem Board) | Milanote verwirft die Aktionen (Fehlerbild aus milanote-skill) | Mitschnitt (`npm run probe -- capture`) beim Anlegen einer Notiz von Hand; ich vergleiche die Frames und stelle Weg C (Editor) oder die Aktionsform um |
| `persisted: false` nur für Inhalte in **neuen** Boards | Wartezeit zu kurz | `MILANOTE_BOARD_SETTLE_MS=3000` setzen und erneut testen; Wert melden |
| `persisted: true`, aber Element erst nach F5 sichtbar | gespeichert, aber nicht live übertragen | Kanal-Beitritt (`update-channels`) ergänzen |
| Link ohne Vorschau, Warnung „Link-Vorschau nicht verfügbar“ | Media-Service-Pfad stimmt nicht (`upload.milanote.com` statt `app.milanote.com`?) | Mitschnitt beim Einfügen eines Links |
| `rejected` mit Status ≠ 200 | Form der Aktion falsch | Ausgabe an mich |
| Notiz erscheint ohne Formatierung oder leer | TipTap-Form passt nicht | Beispiel einer von Hand formatierten Notiz mitschneiden |
| Papierkorb-Aufruf ok, Element bleibt sichtbar | Papierkorb-Aktion falsch (`ELEMENT_MOVE_MULTI` vs `ELEMENT_MOVE`, siehe protocol.md 5c) | Mitschnitt beim Löschen von Hand |

## Getestet

- 82 Unit-Tests, 33 davon für den Writer gegen ein Backend im Speicher: Positionen (auch parallel), Spalten und Listen, Home-Sperre, Link-Vorschau mit und ohne Ausfall, Bild-URLs, verworfene Elemente, fehlende Bestätigung mit und ohne vorhandenes Element, Ablehnung mitten in einer Liste, Papierkorb (gruppiert je Board, Kinder, Wurzel-Sperre, schon im Papierkorb), kein `ELEMENT_DELETE`.
- End-to-End gegen headless Chromium und einen Fake-Server, der das beschriebene Verhalten junger Boards nachbildet (erst nach 0,7 s lesbar, Kinder in den ersten 1,2 s still verworfen):
  - Abnahmeszenario über MCP-stdio: 16 Elemente (2 Spalten, 2 To-do-Listen, 6 Notizen, 2 Links, 4 Aufgaben), parallele Aufrufe, Link ohne Vorschau, Papierkorb, Home-Sperre. Alles `persisted: true`.
  - Gegentest mit `MILANOTE_BOARD_SETTLE_MS=0`: das verworfene Element wird bemerkt (`persisted: false`, Fehler an Claude).
  - Alle neuen CLI-Befehle, sauberes Beenden des Servers, wenn stdin schließt.
- **Nicht gegen das echte Milanote getestet.**
