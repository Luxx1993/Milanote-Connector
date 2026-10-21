# Phase 5: Positionieren und Layout

Stand: 21.10.2026. Vier neue MCP-Tools (`compose_board`, `move_element`, `update_element`, `resize_element`), eine Layout-Engine mit fünf Strategien und ein Größenmodell, das sich an deinem Board nachmessen lässt. **Gegen das echte Milanote ist davon noch nichts gelaufen.** Die Engine selbst ist reine Rechnung und vollständig getestet; unsicher sind die Maße (siehe unten) und die Aktionsformen für Verschieben, Ändern und Breite.

## Aufgabenteilung

Claude entscheidet, **was zusammengehört** (Gruppen, Titel, Reihenfolge der Einträge). Der Code entscheidet, **wo es liegt**. Claude gibt in `compose_board` keine Koordinaten an.

## Tools

| Tool | Zweck | Wichtig |
| --- | --- | --- |
| `compose_board` | Gruppen und Inhalte in einem Aufruf anlegen und anordnen | Layout `columns`, `grid`, `masonry`, `timeline` oder `radial`; mit `title` entsteht ein neues Unterboard |
| `move_element` | Element auf x/y, auf ein anderes Board, in eine Spalte (Ende) oder eine Aufgabe in eine andere Liste | warnt bei vermuteter Überlappung |
| `update_element` | Text, Titel, Erledigt-Status oder Beschriftung ändern | Felder je Typ, siehe unten |
| `resize_element` | Breite ändern | **experimentell**, Einheit unbestätigt |

### compose_board

```jsonc
{
  "parent": "<Board-URL>",           // nicht das Home-Board
  "title": "Reise nach Lissabon",    // optional: neues Unterboard anlegen und darin aufbauen
  "layout": "columns",
  "groups": [
    { "title": "Anreise",   "items": ["Flug **TP 123** um 8:15", { "type": "link", "url": "https://www.flytap.com", "caption": "Buchung" }] },
    { "title": "Programm",  "items": [{ "type": "todo", "title": "Tag 1", "tasks": ["Belém", { "text": "Pastéis", "done": true }] }, "Sintra"] }
  ]
}
```

Einträge: ein String (Notiz, Markdown), `{type:"note", text}`, `{type:"link", url, caption?}` oder `{type:"todo", title?, tasks}`. Weitere Parameter: `center` (radial), `columns` (Spalten je Gruppe bzw. je Reihe), `maxWidth` (ab dieser Breite wird umbrochen, Standard 300 Einheiten), `x`/`y` (Ursprung). Grenzen: 30 Gruppen, 40 Einträge je Gruppe, 150 Elemente je Aufruf.

| Layout | Was entsteht | Gut für |
| --- | --- | --- |
| `columns` | jede Gruppe eine **Milanote-Spalte** mit ihren Karten darin, Spalten nebeneinander (4 je Reihe) | Kanban, Listen nach Thema (Titel Pflicht) |
| `grid` | je Gruppe eine Überschriftskarte (`## Titel`) über einem Raster, Blöcke nebeneinander | Übersichten, Recherche |
| `masonry` | wie `grid`, aber jede Karte in die jeweils kürzeste Spalte | Moodboards, Sammlungen |
| `timeline` | je Gruppe eine Bahn: Überschrift links, Einträge der Reihe nach nach rechts | Abläufe, Zeitpläne (Reihenfolge = zeitlich) |
| `radial` | Mittelpunktskarte (`center` Pflicht), je Gruppe ein Zweig nach außen | Mindmaps |

Ohne `title` landet der Block rechts neben dem vorhandenen Inhalt des Boards. Mit `title` beginnt er im neuen Board bei (4, 4). Das Ergebnis nennt Ursprung, Blockgröße, die IDs aller angelegten Elemente (`created`, mit Gruppe) und wie bei den anderen Schreib-Tools `persisted` und `warnings`.

Hinweise: Die Linien einer Mindmap fehlen (Linien/`LINE`-Elemente sind nicht umgesetzt). Die Überschriften der Nicht-Spalten-Layouts sind normale Notizkarten. Links bekommen nach dem Anlegen ihre Vorschau wie bei `add_link`.

### Garantien der Engine

- **Überlappungsfrei:** Jede Strategie arbeitet mit Regalpackung bzw. Kollisionssuche; zusätzlich prüft `layout()` das Ergebnis und wirft einen Fehler, statt Überlappendes auszugeben. Getestet mit 1000 zufälligen Eingaben (5 Strategien × 200 Seeds).
- **Ganzzahlig, ab 0/0, deterministisch:** gleiche Eingabe, gleiche Koordinaten.
- **Prüfen vor Schreiben:** Ein ungültiger Auftrag (fehlender Titel bei `columns`, `center` bei `radial`, ungültige URL, zu viele Elemente) ändert nichts am Board.
- Die Garantie gilt für **geschätzte** Größen. Ob es auch im echten Board stimmt, hängt von den Maßen ab.

## Größen und Einheiten: was unsicher ist

Milanote speichert **keine Höhen** (automatische Höhe). Die drei Referenzprojekte widersprechen sich außerdem bei der Einheit der Koordinaten:

| Quelle | Pixel je Einheit | Breite einer Notiz |
| --- | --- | --- |
| milanote-plus-plus | ca. 9 | 34 Einheiten (304 px) |
| project-creator | ca. 7 | Spalte ca. 39–40 Einheiten (ca. 280 px) |
| milanote-skill | unbekannt | 18 × 12 Einheiten (vermutlich zu klein) |

Deshalb sind die Standardwerte **bewusst großzügig** (Notiz, Spalte, Liste und Link 40 Einheiten breit, Zeilenhöhe 3, 32 Zeichen je Zeile): lieber zu viel Abstand als überlappende Karten. Das Aussehen ist dann lockerer als nötig.

Zum Nachmessen am eigenen Board gibt es einen **lesenden** Befehl:

```bash
npm run spike -- measure "<Board-URL>" --out metrics.json
```

Er verlangt, dass das Board in einem Tab des Debug-Chrome offen und sichtbar ist. Er liest die Rechtecke der Karten im Tab, bestimmt per Regression die Einheit (Pixel je Einheit, mit Güte), rechnet Breiten und Höhen je Typ in Einheiten um, sagt, **in welcher Einheit `content.width` gespeichert ist**, und schlägt Werte für `MILANOTE_METRICS_FILE` vor. Damit das klappt, braucht ein Board mindestens drei Elemente mit verschiedenen Positionen. Die Erkennung der Karten im DOM (ein Element, dessen `id` auf die Element-ID endet) ist geraten: Findet er nichts, steht das in der Ausgabe, und die Standardwerte bleiben. Die Auswertung ist getestet, die Anbindung an das echte Milanote-DOM nicht.

Mit `MILANOTE_METRICS_FILE=metrics.json` (oder per `claude mcp add … -e`) übernimmt der Server die Werte. Einstellbar sind unter anderem `noteWidth`, `columnWidth`, `charsPerLine`, `lineHeight`, `gap` und `heightScale` (Faktor auf alle Höhen).

**Folge für die Automatik aus Phase 3:** `add_note`, `add_link` usw. rechnen die Breite vorhandener Karten jetzt ebenfalls mit diesem Modell (bisher fest 34), damit eine Notiz nach einem `compose_board` nicht die letzte Spalte überdeckt.

## Verschieben (`move_element`)

| Ziel | Ergebnis |
| --- | --- |
| nichts, aber `x` und `y` | auf dem eigenen Board an diese Stelle, nach vorn in der Z-Reihenfolge |
| Board | auf die Fläche dieses Boards; mit `x`/`y` dorthin, sonst automatisch rechts neben den Inhalt |
| Spalte | ans Ende der Spalte (keine Koordinaten) |
| To-do-Liste | nur Aufgaben, ans Ende |

Regeln wie in milanote-plus-plus: Boards und Spalten nur auf Boards; Aufgaben nur in Listen und umgekehrt; nie in sich selbst oder einen Nachfahren; Home und alles darin gesperrt. Spalten und Boards nehmen ihren Inhalt mit. **Nicht möglich:** innerhalb einer Liste umsortieren. Die Aktion ist `ELEMENT_MOVE_MULTI` mit `DROP`; milanote-skill nutzt `ELEMENT_MOVE` (siehe `docs/protocol.md` 5c). Der Abgleich zeigt, ob Milanote sie annimmt.

## Ändern (`update_element`)

| Typ | Felder |
| --- | --- |
| `CARD` | `text` (Markdown) |
| `TASK` | `text`, `done` |
| `BOARD`, `COLUMN` | `title` |
| `TASK_LIST` | `title` (leer entfernt die Kopfzeile) |
| `LINK`, `IMAGE`, `FILE` | `caption` (leer entfernt sie) |

Alles andere wird abgelehnt, bevor etwas gesendet wird. Die Form (`ELEMENT_UPDATE` mit `changes` und der bisherigen Versions-ID) stammt aus milanote-plus-plus und milanote-skill; project-creator nutzt `data` statt `changes` (protocol.md 5b). Auch hier entscheidet der Abgleich.

## Abnahmetest

Chrome läuft (`npm run chrome`), du bist angemeldet, ein **leeres Testboard** ist offen. `<URL>` ist seine Adresse.

1. **Vorschau ohne Risiko:** `npm run spike -- plan --file docs/examples/compose-reise.json --ascii`. Das zeichnet das Layout als Text, ohne Browser, ohne Schreiben. Dasselbe mit `"layout"` auf `grid`, `masonry`, `timeline`, `radial` ändern.
2. **Maße prüfen (optional, aber empfohlen):** Lege von Hand ein paar Notizen, eine Spalte und einen Link auf das Testboard (verschiedene Positionen), dann `npm run spike -- measure "<URL>" --out metrics.json`. Schick mir die Ausgabe: Sie sagt, ob die Standardwerte stimmen, und löst die Einheitenfrage.
3. **Anlegen:** `npm run spike -- compose --parent "<URL>" --file docs/examples/compose-reise.json --title "Reise columns"`. Dann je Layout wiederholen (Datei mit geändertem `layout`, anderer Titel).
4. **Abnahme laut Fahrplan** (20 Elemente aus einer Textvorlage, überlappungsfrei und thematisch gruppiert): Sieh dir jedes der fünf Boards an:
   - Überlappt irgendeine Karte eine andere? (Wenn ja: Board und Layout nennen, dann `measure` laufen lassen.)
   - Gehört zusammen, was zusammengehört? Sind Spalten bzw. Blöcke klar getrennt?
   - Liegt der Inhalt sinnvoll im sichtbaren Bereich (nicht Kilometer entfernt)?
5. **In Claude Code:** Gib Claude eine Textvorlage und sag zum Beispiel:
   > Hier ist meine Reiseplanung (Text). Baue daraus im Board `<URL>` ein neues Unterboard „Lissabon“ auf. Gruppiere nach Themen und nimm das Layout, das am besten passt.
   
   Claude sollte `compose_board` mit sinnvollen Gruppen aufrufen.
6. **Ändern und Verschieben:**
   ```bash
   npm run spike -- update <Notiz-ID> --text "## Neu"
   npm run spike -- move <Notiz-ID> --x 300 --y 20
   npm run spike -- move <Notiz-ID> --parent <Spalten-ID>
   npm run spike -- resize <Spalten-ID> --width 50
   ```
   Folgt das Board live, und bleibt es nach F5 erhalten? Bei `resize`: ändert sich die Breite sichtbar, und um wie viel?

### Fehlerbilder

| Beobachtung | Bedeutung | nächster Schritt |
| --- | --- | --- |
| Karten überlappen sich | Größen zu klein geschätzt | `measure`, Werte in `MILANOTE_METRICS_FILE`; notfalls `heightScale` erhöhen |
| Viel zu große Lücken | Größen zu groß geschätzt | dasselbe, `heightScale` senken |
| Inhalt liegt weit auseinander oder in falscher Größenordnung | Einheit ≠ Annahme | `measure` (`unitPx`) und mir melden |
| `move_element`/`update_element` mit `persisted: false` | Aktionsform stimmt nicht | Mitschnitt (`npm run probe -- capture`), während du dasselbe von Hand tust |
| `resize_element` mit `persisted: false` oder Breite wirkt falsch | `content.width` heißt anders oder hat andere Einheit | `measure` zeigt die Einheit; Mitschnitt beim Ziehen am Rand einer Karte |
| `compose_board` mit `persisted: false` nur für einen Teil | Kinder in neuem Board verworfen | `MILANOTE_BOARD_SETTLE_MS=3000` (siehe `docs/phase3.md`) |

## Nicht enthalten

- **Bestehende Elemente automatisch neu anordnen** („räum das Board auf“). Die Engine könnte es; ich habe es nicht eingebaut, weil es Positionen auf deinem Board überschreibt. Auf Wunsch als eigenes Tool mit Vorschau.
- Umsortieren innerhalb einer Liste, Linien/Verbindungen, Bilder (Phase 4).

## Getestet

- 181 Unit-Tests. Neu: Engine (5 Strategien × 200 zufällige Eingaben ohne Überlappung, Determinismus, Einzelregeln je Strategie), Plan (Beispielvorlage in allen Layouts, Gruppierung, Eingabeprüfung, Grenzen), Größenmodell, Messauswertung (Einheit, Zoom-Unabhängigkeit, Einheit von `content.width`), Writer (Verschieben mit allen Regeln und Fehlerfällen, Ändern je Typ, Breite, `compose_board` inklusive Reihenfolge, Teilfehlern und gleichzeitigen Aufrufen).
- End-to-End gegen headless Chromium und Fake-Server über MCP-stdio: `compose_board` in allen fünf Layouts (je 30–31 Elemente, jeweils `persisted: true`; Spalten mit 4/4/5/3 Karten), Verschieben in Spalte und auf die Fläche, Ändern von Notiz, Aufgabe und Spalte, Breite, vier Fehlerfälle ohne Änderung am Board; CLI-Befehle `plan`, `compose`, `move`, `update`, `resize`, `measure` (mit nachgebautem DOM bei 8 px je Einheit: Einheit exakt erkannt). Die Phase-3-Abnahme läuft unverändert.
- **Nicht gegen das echte Milanote getestet.**
