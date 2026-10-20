# Phase 0: Protokoll und Machbarkeit

Stand: 20.10.2026. Ergebnis der Phase 0 aus dem Fahrplan, **erster Durchgang ohne Zugriff auf ein Milanote-Konto**.

> **Nachtrag 20.10.2026:** Phase 0 ist bestätigt. Antworten: bezahlter Plan (Limits aus 4.3 und 6 entfallen weitgehend, PDF/PNG-Export sollte verfügbar sein); die Fremdtools werden nicht lokal ausprobiert (Abschnitt 9, Schritte 5 und 6 entfallen). Für Frage 5a ist in Phase 1 Weg B umgesetzt; der Abnahmetest in `docs/phase1.md` klärt, ob er trägt. Der Mitschnitt (Schritt 3) bleibt für Bild-Upload und Export vor Phase 4 und 6 nötig.

## 0. Was hier geprüft ist und was nicht

Dieser Durchgang lief in einer Cloud-Umgebung ohne Milanote-Anmeldung, ohne deinen Browser und ohne Windows. Deshalb:

| Arbeitsschritt aus Phase 0 | Stand |
| --- | --- |
| Quellcode und Doku der Referenz-Repos auswerten | erledigt (Commits siehe Abschnitt 3) |
| Installationsskripte vorab lesen und bewerten | erledigt (Abschnitt 3) |
| `docs/milanote-api.md` aus milanote-plus-plus auswerten | erledigt (Abschnitt 4) |
| Nutzungsbedingungen prüfen (Risiko-Tabelle, Abschnitt 8 im Fahrplan) | erledigt, **Ergebnis braucht deine Entscheidung** (Abschnitt 2) |
| Probe-Skript für Bild-Upload, Export, Screenshot | gebaut, getestet gegen einen lokalen Fake-Server (nicht gegen Milanote), siehe `tools/probe/README.md` |
| `milanote-skill` und `milanote-plus-plus` am Testboard ausprobieren | **offen, nur bei dir lokal möglich** (Checkliste Abschnitt 9) |
| Mitschnitt am echten Konto | **offen, nur bei dir lokal möglich** |

Kennzeichnung im Folgenden: **[M++]** = milanote-plus-plus `docs/milanote-api.md` und `bridge.js` (Mitschnitt vom 30.09.2026, App-Version 3.18.132). **[Skill]** = milanote-skill `opencli/sites/milanote/notes.md` und Code (16. bis 20.10.2026). **[PC]** = thisis-romar/milanote-project-creator (Mai 2026, App-Version 3.18.94). **[luscoma]**, **[setobox]** = die beiden Lese-Projekte. Nichts davon ist von uns verifiziert.

## 1. Kurzfassung

1. **Schreiben, Lesen, Positionieren:** Das Protokoll ist von zwei unabhängigen Quellen recht genau beschrieben. Lesen läuft über REST (`/api/boards`, `/api/elements`, `/api/users/me`), Schreiben über Socket.IO-Aktionen (`ELEMENT_CREATE`, `ELEMENT_UPDATE`, `ELEMENT_MOVE_MULTI`). Koordinaten sind Rastereinheiten (ca. 9 px).
2. **Größter offener Punkt ist nicht der Bild-Upload, sondern der Schreibweg.** [M++] schreibt mit einem eigenen Socket.IO-Client und bekommt Status 200. [Skill] schreibt, ein eigener Socket-Client werde ignoriert, und schreibt deshalb über den Redux-Store des offenen Editors. Trotzdem gehen dort Schreibvorgänge zeitweise verloren. Welcher Weg bei dir stabil ist, entscheidet die Architektur von Phase 1 (Abschnitt 5a).
3. **Bild-Upload ist nachvollziehbar.** [Skill] hat ihn am 16.10.2026 live verifiziert: leeres `IMAGE`-Element per Socket anlegen, `POST /api/elements/attachments/presign`, Datei per `PUT` an die signierte URL. Das Abbruchkriterium aus dem Fahrplan greift damit voraussichtlich nicht; bestätigen muss es der Mitschnitt an deinem Konto (Abschnitt 6).
4. **Export (PDF/PNG) ist von keiner Quelle dokumentiert.** Markdown können wir selbst aus `get_board` erzeugen (so macht es [M++]). Für den nativen PDF/PNG-Export braucht es den Mitschnitt. Screenshot per CDP funktioniert technisch (am Fake-Server getestet), mit bekannten Fallstricken (Abschnitt 7).
5. **Nutzungsbedingungen:** Milanote untersagt Reverse Engineering und „Back-end“-Zugriff ohne schriftliche Zustimmung (Abschnitt 2). Das betrifft jeden der Ansätze, auch die fremden Tools.
6. **Vorläufige Empfehlung: selbst bauen**, die Fremdprojekte nur als Protokollreferenz nutzen. Begründung in Abschnitt 8. Endgültig erst nach deinen lokalen Tests.

## 2. Nutzungsbedingungen

Quelle: [milanote.com/legal/terms-of-service](https://milanote.com/legal/terms-of-service), Stand der Seite 26.02.2024 (ein Tracker meldet eine Fassung mit Wirkung zum 25.02.2026; nicht bestätigt, bitte die Live-Seite lesen). Relevante Stellen (Auszüge):

- **7.3(a)(2):** „no 'back-end' access to Milanote is available to the User unless expressly agreed in writing“
- **7.7(c)(2):** der Nutzer darf nicht „directly or indirectly copy, recreate, decompile, reverse engineer or otherwise obtain, modify or use any source or object …“
- **7.6(a):** nichts tun, was die Sicherheit der Systeme beeinträchtigt
- **2(c), 7.1(c):** Milanote darf Konten bei Verstößen sperren bzw. die Lizenz nach eigenem Ermessen entziehen

Automatisierung, Bots oder Scraping werden nicht ausdrücklich erwähnt. Die Nutzung des privaten Protokolls und das Mitschneiden fallen aber plausibel unter 7.3 und 7.7. Folgen im schlimmsten Fall: Sperrung des Kontos.

**Vorschlag:** Bei Milanote-Support schriftlich anfragen, ob ein persönlicher, lokaler Connector für das eigene Konto geduldet wird (7.3(a)(2) sieht eine schriftliche Zustimmung ausdrücklich vor). Bis dahin nur ein Test-Workspace, keine wichtigen Daten, niedrige Frequenz. **Das ist deine Entscheidung**, ich setze nichts davon voraus.

## 3. Quellen und Installationsskripte

| Repo | Commit (geklont 20.10.2026) | Lizenz | Plattform | Bewertung |
| --- | --- | --- | --- | --- |
| RZX00/milanote-skill | `6009af9` (20.10.2026) | MIT | Windows 11 getestet, braucht OpenCLI + Chrome-Erweiterung | beste Quelle für Bild-Upload und Schreib-Probleme |
| xxNightshade/milanote-plus-plus | `01cd98d` (30.09.2026) | **keine Lizenzdatei** (Code nicht übernehmbar, nur Wissen) | nur Windows (C++, WebView2) | beste Protokoll-Doku |
| thisis-romar/milanote-project-creator | `b2c190e` (06.05.2026) | MIT | Edge über CDP | Timing-Hinweise, älterer Stand |
| luscoma/milanote-mcp | `9147de5` (04.05.2026) | MIT | Python, nur lesend | Such-Endpunkt |
| setobox/milanote-api | `d27fedc` (08.10.2026) | keine Lizenzdatei | Cloudflare Worker, nur geteilte Boards | Share-Token-Ablauf |

### 3.1 milanote-skill: `install.sh` / `install.ps1`

Was die Skripte tun (je unter 60 Zeilen, vollständig gelesen):

- Laden den **aktuellen `main`-Branch** als Tarball von `codeload.github.com` (nicht auf einen Commit festgelegt). Bei `curl … | bash` läuft also, was gerade auf `main` liegt, nicht das, was ich gelesen habe.
- Löschen per `rm -rf` und ersetzen: `~/.claude/skills/milanote`, `~/.cursor/skills/milanote`, `~/.codex/skills/milanote`, `~/.agents/skills/milanote`, `~/.opencli/clis/milanote`. Die Ordner werden auch angelegt, wenn du Cursor/Codex nicht nutzt.
- Kopieren `notes.md` nach `~/.opencli/sites/milanote/`.
- Kein `sudo`, keine weiteren Downloads, kein Ausführen von Code während der Installation. `preflight.sh` ruft nur `opencli milanote types` auf.

Was nicht im Repo steckt und ich nicht geprüft habe: **OpenCLI** (`@jackwener/opencli`, npm) und dessen **Chrome-Erweiterung**. Über sie läuft der Adapter-Code in deinem angemeldeten Milanote-Tab (`page.evaluate`): er liest den React-/Redux-Zustand der App, liest Permission-Tokens aus dem Speicher und sendet Aktionen über den Store. Das ist mehr Zugriff als ein normales Skript.

Auffälligkeiten im Adapter:
- Es gibt einen `delete`-Befehl, der **`ELEMENT_DELETE` sendet (endgültig, kein Papierkorb)**. Laut `notes.md` wurden Probe-Boards so gelöscht. Widerspricht unserer Regel „nur Papierkorb“; im Test nicht benutzen.
- UI-Fallback (`--via auto`, Standard): bei verworfenen Schreibvorgängen steuert der Adapter Maus und Tastatur im Editor (20 bis 40 s pro Notiz, Fenster darf nicht minimiert sein).

Sicherer Weg für den Test:
1. Repo klonen und auf den gelesenen Commit festlegen: `git clone https://github.com/RZX00/milanote-skill && cd milanote-skill && git checkout 6009af9`
2. Probelauf in ein Wegwerf-Home: `HOME=$(mktemp -d) bash install.sh` und ansehen, was entsteht.
3. Für den eigentlichen Test nur den Adapter kopieren (`opencli/clis/milanote` nach `~/.opencli/clis/milanote`); den Skill brauchst du für den Test nicht.
4. `delete` nicht verwenden; Schreibtests mit `--via api`, damit kein UI-Fallback anspringt und man sieht, ob der API-Weg trägt.

### 3.2 milanote-plus-plus: Build- und Hilfsskripte

Es gibt kein Installationsskript, sondern eine selbst zu bauende `.exe` (Visual Studio 2022/2026, C++). Gelesen:

- `build.cmd`: baut Release x64, beendet dabei **alle laufenden `Milanote++.exe` per `taskkill /f`**, kopiert die exe auf den Desktop, falls dort schon eine liegt. Unkritisch.
- `test-mcp.cmd`: führt `--install` aus (**schreibt in `claude_desktop_config.json`**, Store- und klassischen Pfad) und mit Argument `gdd` legt es ein Board in deinem Home an. Nicht blind ausführen.
- `diag.cmd`: kopiert deine Claude-Desktop-Konfiguration und das Log in den Repo-Ordner. Nicht nötig.
- `github.cmd`, `release.cmd`, `scrub-history.cmd`: Werkzeuge des Autors zum Veröffentlichen (Push, Release, History neu schreiben). **Nicht ausführen**, für dich ohne Nutzen.
- **Selbst-Update (`Updater.cpp`):** Jede gestartete exe fragt höchstens alle 6 Stunden die GitHub-Releases von `xxNightshade/milanote-plus-plus` ab, lädt eine neuere exe, prüft deren SHA-256 gegen eine Datei aus demselben Release und **ersetzt sich selbst**. Die Prüfsumme schützt nur vor kaputten Downloads, nicht vor einem bösartigen Release. Deine selbst gebaute, geprüfte exe würde also durch eine ungeprüfte ersetzt. **Abhilfe vor dem Bauen:** in `Milanote++/Updater.h` `kUpdateRepo = ""` setzen; dann bricht `CheckForUpdate()` mit „update source not configured“ ab (Zeile 215f.).
- Die App speichert die Milanote-Sitzung in `%LOCALAPPDATA%\Milanote++` (WebView2-Profil). Zum Abmelden den Ordner löschen.

Für den Plan-Test (`--whoami`, Notiz anlegen) reicht: Updater abschalten, bauen, `Milanote++.exe --login`, dann `--whoami`. `--install` erst, wenn du es wirklich in Claude Desktop haben willst.

### 3.3 milanote-project-creator

Nicht zum Ausprobieren vorgesehen, nur Referenz. Liest per CDP alle Cookies inklusive HttpOnly (`Network.getCookies`) und baut damit eine eigene Socket-Verbindung aus Node. Hat ebenfalls ein endgültiges `ELEMENT_DELETE`.

## 4. Protokoll (konsolidiert)

### 4.1 Hosts

| Zweck | Host | Quelle |
| --- | --- | --- |
| Web-App, REST unter `/api/…` | `https://app.milanote.com` | alle |
| Realtime (Schreiben) | `wss://app.milanote.com/socket.io/?userId=<userId>&EIO=4&transport=websocket` | [M++], [PC] |
| Kollaboration (Cursor, Live-Text) | `https://app.milanote.com/collab/socket.io` [M++]; `https://collab.milanote.com` [PC, Mai] | widersprüchlich, für uns unwichtig |
| Media-Service (Link-Vorschau, Bilder) | `https://app.milanote.com/media-service/api/…` [M++, Sept]; `https://upload.milanote.com/api` [PC, Mai; Skill-Allowlist, Okt] | **prüfen** |
| Hochgeladene Medien | `https://media.milanote.com/…`, S3-Ordner `p` | [M++] |
| WAF-Challenge | `https://static.milanote.com/awswaf/<id>/challenge.compact.js`, Cookie `aws-waf-token` | [M++] |

### 4.2 Anmeldung

- Sitzungs-Cookie (Better Auth, HttpOnly), gilt nur für die Browsersitzung. Requests vom Ursprung `app.milanote.com` mit `credentials: "include"` sind damit authentifiziert. Ohne Cookie: `401 … authFailureReason: "missing-authentication"`. [M++]
- Zusätzlich ein langlebiges JWT in `localStorage.token` (Payload `{_id, iat, platform, role, rootBoardId}`, **ohne Ablauf**), als `Authorization: Bearer` akzeptiert; `POST /api/auth/upgrade-better-auth-session` erzeugt daraus ein frisches Cookie. [M++] Folgerung für uns: Das ist faktisch ein Dauer-Passwort. Nie auslesen, nie auf Platte schreiben.
- Login selbst braucht reCAPTCHA v3, also nur über die echte Login-Seite. [M++]
- AWS WAF mit JavaScript-Challenge; Antwort mit Header `x-amzn-waf-action` heißt Challenge. [M++]
- Share-Links `?p=<permissionId>`: `GET /api/permissions/token/<permissionId>?elementId=<board>` liefert ein Token, das als `tokens=` an Lese-Requests und im `tokens`-Feld von Aktionen mitgeht. [Skill], [setobox]

### 4.3 REST (lesen)

| Endpunkt | Inhalt | Quelle |
| --- | --- | --- |
| `GET /api/users/me` | `user{_id, email, rootBoardId, quickNotesRootId, clientId, clientTick, contentLimit, …}` | [M++], [Skill], [luscoma] |
| `GET /api/users/me/counts` | Nutzung und Limit (`contentLimit`, Free = 100 Notizen) | [M++] |
| `GET /api/users/me/app-init?timezone=<min>` | Boot-Daten inkl. `boardHierarchies` | [M++] |
| `GET /api/boards?excludeSelf=false&loadAncestors=false&ids=<id>[,<id>]` | Board plus Unterbaum ohne Inhalt der Unterboards; `canvasOrder=true` liefert Z-Reihenfolge; `tokens=` für Share-Boards | [M++], [Skill] |
| `GET /api/boards/modified?ids=<ids>` | `modifiedTime` je Board (Polling der App) | [M++] |
| `GET /api/elements?ids=<ids>&loadAncestors=true` | Elemente plus Elternkette | [M++], [Skill] |
| `GET /api/boards/search?query=&offset=&sort=viewed&locale=` | Volltextsuche, Treffer in `results[].innerHits` | [luscoma] |
| `GET /api/users/me/trash?other-users=false` | Papierkorb | [M++] |
| `POST /api/actions` | nimmt nur analytische Aktionen an; **Element-Änderungen werden hier still ignoriert** | [M++] |
| `POST …/media-service/api/link {url, elementId, environmentFolder:"p", userId, locale}` | Link-Vorschau; ändert das Element nicht | [M++], [PC] |
| `POST /api/elements/attachments/presign` | signierte Upload-URL (Abschnitt 6) | [Skill] |
| `GET …/media-service/api/preview/<boardId>` | „Board-Vorschau“, von niemandem genutzt; **Kandidat für Export/PNG** | [M++] |

### 4.4 Element-Modell

```json
{
  "_id": "1XbZEqlawr6y03",
  "elementType": "CARD",
  "location": { "parentId": "1XbZEplawr6y02", "section": "CANVAS", "position": { "x": 4, "y": 2, "score": 65536 } },
  "content": { "textContent": { "type": "doc", "content": [] } },
  "meta": { "creator": "<userId>", "modifiedBy": "<userId>", "createdTime": 0, "modifiedTime": 0, "versionId": "…" }
}
```

- **Typen:** `BOARD, CARD (Notiz), COLUMN, TASK_LIST, TASK, LINK, LINE, IMAGE, FILE, COMMENT_THREAD, ALIAS, CLONE, SKETCH, ANNOTATION, COLOR_SWATCH, DOCUMENT, TABLE` [M++]
- **Sections:** `CANVAS` (frei, `{x, y, score}`), `INBOX` (Liste in Spalte/To-do-Liste/„Unsorted“, `{index, score}`), `ATTACHED` (Kommentare), `TRASH` (`parentId = <boardId>-trash`, `{addedDate, restoreLocation}`), `DELETED`, `QUICK_NOTES` [M++]
- **Koordinaten:** Rastereinheiten, 1 Einheit ≈ 9 px bei 100 %. Standardbreite Notiz/Spalte 304 px ≈ 34 Einheiten. `score` ist die Z-Reihenfolge, die App nimmt `max(Geschwister) + 65536`. [M++] Größen (Höhe) stehen nicht im Element, wenn `autoHeight`; für die Layout-Engine brauchen wir Schätzwerte oder gemessene Werte aus dem DOM.
- **Rich Text:** TipTap/ProseMirror-JSON, jeder Block hat ein zufälliges 5-Zeichen-`key`. Knoten- und Mark-Liste in [M++].
- **IDs:** [M++]: `<6 Zeichen base62(Unix-Sekunden)><6 Zeichen clientId><2 Zeichen base62(clientTick % 3844)>` (14 Zeichen). [Skill]: eigene IDs mit 16 Zeichen, beginnend mit `1`; „andere Formen speichert die API, der Editor blendet sie aber aus“. [PC]: zufällige 14 Zeichen. **Prüfen.**

### 4.5 Socket.IO (schreiben)

Engine.IO v4 / Socket.IO v4 über WebSocket:

```
<- 0{"sid":…,"pingInterval":25000,"pingTimeout":20000,"maxPayload":"1e7"}
-> 40
<- 40{"sid":…}
<- 2  /  -> 3                                         Ping/Pong
-> 42<ackId>["action", {…}]                           Aktion senden
<- 43<ackId>[{"status":200}]                          Bestätigung
<- 42["action", {…, "remote":true}]                   Aktionen anderer Clients
-> 42<ackId>["update-channels", {"joined":[…], "left":[]}]
```

Kanäle: `<boardId>`, `<boardId>-LIVE`, `<userId>`, `<userId>-PERSONAL`. [PC] sendet bei `update-channels` zusätzlich `bufferFlush:true, replay:true`.

Umschlag jeder Aktion [M++]:

```json
{ "type": "…", "sync": true, "timestamp": 0,
  "user": { "_id": "<userId>", "clientId": "1WkDRF", "clientTick": 950 },
  "tokens": [], "deviceId": "mdid-…", "sessionId": "msid-…",
  "activity": { "track": false, "boardId": "<boardId>" }, "channels": ["<boardId>"] }
```

Aktionen:

| Aktion | Form | Quelle |
| --- | --- | --- |
| `ELEMENT_CREATE` | `{id, elementType, location, content, meta, creationSource, markAsFetched}`; für Boards, die danach befüllt werden, `markAsFetched:false` | [M++] |
| `ELEMENT_UPDATE` | `{updates:[{id, changes, meta:{modifiedVersionId, versionId}}]}` [M++, Skill]; `{updates:[{id, data}]}` [PC] | **prüfen** |
| `ELEMENT_MOVE_MULTI` | `{moves:[{id, location, from}], moveOperation:"DROP"|"TRASH"|…}` [M++]; [Skill] nutzt `ELEMENT_MOVE` mit `location` auf oberster Ebene | **prüfen** |
| Papierkorb | `ELEMENT_MOVE_MULTI` nach `{parentId:"<boardId>-trash", section:"TRASH", position:{addedDate, restoreLocation}}`, `moveOperation:"TRASH"` | [M++] |
| `ELEMENT_SET_TYPE` | `{id, elementType, changes}`, z. B. Link wird nach der Vorschau zu `IMAGE` | [M++] |
| `ELEMENT_DELETE` | endgültig. **Wird von uns nie gesendet.** | alle |
| `USER_NAVIGATE` | Board-Wechsel, danach `update-channels` | [PC] |

### 4.6 Timing

- Fahrplan: 800 ms nach Board-Erstellung, bevor Kinder angelegt werden. [PC] korrigiert im Code: „800 ms reichte nicht, frische Boards brauchen ca. 3 s“.
- [M++] wartet nicht fest, sondern auf das Ack jeder Aktion (Zeitlimit 15 s).
- [Skill] wartet 80 ms zwischen Aktionen und 400 ms vor der Prüfung.
- Die App cached Boards in IndexedDB und lädt nur nach, wenn `/api/boards/modified` neuer ist; neu erzeugte Inhalte erscheinen in offenen Tabs ggf. erst nach Neuladen. [M++]

## 5. Widersprüche, die Phase 0 klären muss

**a) Eigener Socket-Client oder Editor-Store?** (entscheidet die Architektur)

| Weg | Wer | Beobachtung |
| --- | --- | --- |
| A: eigener Socket.IO-Client in Node, Cookies aus dem Browser | [PC] | funktionierte im Mai 2026 |
| B: eigener Socket.IO-Client in einer Seite auf `app.milanote.com` (gleicher Ursprung), `tokens:[]` | [M++] | Ack 200, im Sept. 2026 produktiv |
| C: Aktionen in den Redux-Store des offenen Editors dispatchen | [Skill] | „ein separater Socket.IO-Client wird ignoriert“; trotzdem zeitweise verworfene Schreibvorgänge, Ursache unbekannt |

Wichtig: Ein Ack mit Status 200 heißt laut [Skill] noch nicht, dass das Element bleibt. Prüfkriterium für unseren Test: Element nach dem Schreiben **in einem zweiten, frisch geladenen Tab** sichtbar und per `/api/boards` (ohne Cache) lesbar, auch nach 5 Minuten noch.

Weg C hängt an React-Interna (Fiber-Baum, Store-Struktur) und bricht bei jedem Bundle-Update eher als A/B. Bevorzugt wäre B (in der Seite, aber mit eigenem, kleinem Client) oder A.

**b)** `ELEMENT_UPDATE` mit `changes` oder `data`. **c)** Verschieben mit `ELEMENT_MOVE_MULTI` oder `ELEMENT_MOVE`. **d)** Media-Host. **e)** ID-Format, das der Editor akzeptiert. **f)** Wartezeit nach Board-Erstellung.

Alle sechs Punkte beantwortet ein einziger Mitschnitt, in dem du die Aktionen von Hand im Editor ausführst (Abschnitt 9, Schritt 3).

## 6. Bild-Upload

Ablauf laut [Skill] (am 16.10.2026 mit PNG und Textdatei verifiziert):

1. Leeres Element per `ELEMENT_CREATE` anlegen: `elementType: "IMAGE"` (bzw. `FILE`), `content: {}` oder `{caption}`.
2. `POST /api/elements/attachments/presign` mit `{filename, contentType, elementId, fileType: "image"|"file", imageType: "original", fileSize}` → Antwort enthält `presignedUrl` (oder `data.presignedUrl`).
3. `PUT <presignedUrl>` mit `content-type` und den rohen Bytes.
4. Milanote verknüpft die Datei serverseitig; das Element ist fertig, sobald `content.image`/`url` gesetzt ist (Polling, bis 8 s). Bild-URLs stehen danach in `content.image.original`.

Bild per URL: [Skill] meldet „image URL“ als verifizierte Erstellung; [M++] beschreibt, dass die Link-Vorschau für Bild-URLs `elementType: "IMAGE"` liefert und der Client das Element per `ELEMENT_SET_TYPE` umwandelt.

Offen (klärt der Mitschnitt): ob die App nach dem `PUT` noch eine Bestätigungs-Aktion sendet; wer Breite, Höhe und Thumbnails setzt; das echte Größenlimit (4 MB ist die Grenze des Skills, nicht unbedingt Milanotes); Fehlerbild beim Free-Plan-Limit (laut Cotlet 10 Uploads).

**Abbruchkriterium:** voraussichtlich nicht erreicht, weil der Ablauf nachvollziehbar und von einer Quelle live bestätigt ist.

## 7. Export und Screenshot

- **Markdown/Text:** selbst erzeugen aus `get_board` (TipTap → Markdown). [M++] macht genau das mit einem Gliederungsformat (`#` Board, `##` Spalte, `###` Notiz, `- [ ]` Aufgaben). Kein natives Export-Protokoll nötig.
- **PDF/PNG nativ:** von keiner Quelle beschrieben. Kandidaten: `media-service/api/preview/<boardId>` oder ein eigener Export-Endpunkt. Ob synchron, asynchron (Job) oder als Download, zeigt der Mitschnitt; das Probe-Skript protokolliert Downloads (`download.begin`).
- **Screenshot per CDP:** `Page.captureScreenshot` nach `Page.bringToFront`; im Probe-Skript umgesetzt und gegen eine lokale Seite getestet. Fallstricke laut [Skill]: hängt bei minimiertem Fenster (das Skript prüft deshalb `document.visibilityState`), zeigt nur den sichtbaren Ausschnitt. Ganzes Board erfordert Zoom-to-Fit oder Kacheln, das ist Phase 6.

## 8. Empfehlung: nutzen, forken oder selbst bauen

**Vorläufig: selbst bauen** (TypeScript/Node, Architektur wie im Fahrplan), die Fremdprojekte als Protokollreferenz.

- **milanote-skill nutzen?** Hängt an OpenCLI und dessen Chrome-Erweiterung (nicht geprüft), nur unter Windows 11 getestet, Doku auf Chinesisch, verworfene Schreibvorgänge mit langsamem UI-Fallback, endgültiges Löschen eingebaut, kein Export, kein Screenshot, kein `compose_board`, kein MCP-Server. Als Unterbau für einen MCP-Server ungeeignet; als Wissensquelle (MIT) sehr wertvoll, vor allem für Upload und Fehlerbilder.
- **milanote-plus-plus forken?** Nur Windows, C++/WebView2, keine Lizenz (Code darf nicht übernommen werden), kein Upload, Selbst-Updater. Die Tool-Auswahl und das Gliederungsformat sind aber gute Vorbilder für unsere Tools.
- **Selbst bauen:** passt zu den Rahmenbedingungen (TypeScript, CDP, sichtbarer Browser, plattformunabhängig), schließt Export, Screenshot und Layout-Engine ein, und wir können die Regel „nur Papierkorb“ im Code erzwingen.

Was die Empfehlung kippen würde: Wenn bei deinem Test nur Weg C (Editor-Store) zuverlässig schreibt, übernehmen wir die Technik aus dem Skill (MIT, mit Hinweis), bauen aber trotzdem selbst.

## 9. Checkliste für dich (lokal)

Voraussetzungen: Node 22, Chrome, ein Milanote-Test-Workspace mit leerem Testboard, nichts Wichtiges im Konto.

1. **Nutzungsbedingungen:** entscheiden, ob du vorher bei Milanote nachfragst (Abschnitt 2).
2. **Chrome mit eigenem Profil starten** und dort einmal bei Milanote anmelden (Anleitung `tools/probe/README.md`). Seit Chrome 136 funktioniert der Debug-Port nicht mit dem Standardprofil.
3. **Mitschnitt** (`npm run probe -- capture`), dabei von Hand im Testboard, je mit Markierung:
   1. Board öffnen
   2. Unterboard anlegen und öffnen
   3. Notiz anlegen und Text tippen
   4. Notiz verschieben
   5. Spalte anlegen, Notiz hineinziehen
   6. To-do-Liste mit zwei Aufgaben, eine abhaken
   7. Link einfügen
   8. Bild per Datei hochladen (PNG unter 4 MB)
   9. Bild per URL einfügen
   10. Export: Markdown/Text, PDF, PNG (falls im Plan verfügbar)
   11. Notiz in den Papierkorb
4. `npm run probe -- summarize <datei>` und **nur die Zusammenfassung** an mich geben (sie enthält Endpunkte, Keys, deine Markierungen und Download-Dateinamen, aber keine Boardinhalte; vorher kurz durchsehen). Die Rohdatei bleibt bei dir; einzelne Zeilen nur nach Durchsicht.
5. Optional **milanote-skill** nach 3.1 testen: `whoami`, `create --type note --via api`, `move`, `upload`. Je Befehl: geht, geht nicht oder fragil.
6. Optional **milanote-plus-plus** nach 3.2 (nur Windows): Updater abschalten, bauen, `--login`, `--whoami`, Notiz anlegen.
7. Ergebnisse zurückmelden; ich trage sie hier ein und wir entscheiden über Phase 1.

## 10. Offene Fragen an dich

1. Welches Betriebssystem nutzt du? milanote-plus-plus läuft nur unter Windows, milanote-skill ist nur dort getestet.
2. Wie gehst du mit den Nutzungsbedingungen um (nachfragen, Risiko tragen, abbrechen)?
3. Free- oder bezahlter Plan? Beeinflusst Limits (100 Elemente, 10 Uploads) und ob PDF/PNG-Export verfügbar ist.
4. Willst du die Fremdtools überhaupt lokal ausprobieren, oder reicht dir der eigene Mitschnitt? Für die Architekturfrage (Abschnitt 5a) genügt der Mitschnitt plus ein kurzer Schreibtest in Phase 1.
