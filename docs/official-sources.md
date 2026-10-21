# Abgleich mit offiziellen Milanote-Angaben

Stand: 21.10.2026. Geprüft wurde, was Milanote selbst öffentlich sagt: Hilfe-Center, Versionshinweise, Nutzungsbedingungen, Datenschutzerklärung, Sicherheits- und Offenlegungsseite, `robots.txt`.

## Umfang und Grenzen der Prüfung

- **Nicht ausgewertet habe ich den JavaScript-Code der Web-App.** Er ist öffentlich ausgeliefert, aber seine Analyse fiele unter das Verbot des Reverse Engineerings in den Nutzungsbedingungen (Abschnitt 7.7), auf das ich dich selbst hingewiesen habe. Alles auf Protokollebene (Socket.IO, Aktionstypen, Felder, IDs, Upload-Ablauf) bleibt deshalb **unbestätigt**. Es lässt sich nur an deinem eigenen Konto mit den Abnahmetests und dem Mitschnitt klären.
- **Methode:** Die Seiten wurden über ein Lesewerkzeug abgerufen, das Inhalte zusammenfasst und Zitate auf rund 125 Zeichen kürzt. Wörtlich sind deshalb nur kurze Zitate. Wo es zählt (Nutzungsbedingungen), lies bitte das Original. Die Nummerierung der Klauseln wich zwischen zwei Abrufen ab; belastbar sind die Zitate und die Abschnitte 7.3, 7.6, 7.7.
- Preise habe ich nicht geprüft: `milanote.com/pricing` liefert 404, die Hilfeartikel verweisen auf eine Plans-Seite ohne Zahlen.

## Ergebnis auf einen Blick

| Prüfung | Ergebnis |
| --- | --- |
| Gibt es eine offizielle API, Integration oder einen MCP-Server? | **Nein, nichts dokumentiert** (siehe 1) |
| Verbieten die Bedingungen unser Vorgehen ausdrücklich? | **Nicht ausdrücklich**; Automatisierung wird nicht erwähnt, aber „Back-end“-Zugriff und Reverse Engineering sind untersagt (siehe 2) |
| Falsch in meinen Unterlagen und im Code | **6 Punkte, alle korrigiert** (in den Tabellen als „korrigiert“ markiert, Liste in 11) |
| Präzisiert oder ergänzt | weitere Punkte in 2 bis 7 |
| Offiziell nicht belegbar | Einheit der Koordinaten, Kartenhöhen, gesamtes Protokoll (siehe 10) |

## 1. Offizielle API oder Integration?

- Der offizielle Hilfe-Index ([llms.txt](https://help.milanote.com/llms.txt)) enthält **keinen** Artikel zu API, Integrationen, Automatisierung oder Zapier.
- In den [Versionshinweisen](https://milanote.com/releases/web) der Web-App (Juli 2025 bis 20.10.2026, drei Seiten gelesen) kommt weder API noch KI, MCP, Integration noch Automatisierung vor.
- Die [Sicherheitsseite](https://help.milanote.com/en/articles/382480-security-practices-at-milanote.md) erwähnt weder API-Tokens noch Integrationen. `robots.txt` sagt dazu nichts.
- **Folge:** Es bleibt bei dem inoffiziellen Weg. Dass etwas nicht dokumentiert ist, heißt aber nicht, dass es nicht existiert oder geplant ist. Nachfragen beim Support klärt das (siehe 2).

## 2. Nutzungsbedingungen, Offenlegungsrichtlinie, Datenschutz

Quelle: [Terms of service](https://milanote.com/legal/terms-of-service), Seite „Last updated: 26 February 2024“. Die Fassung „25.02.2026“ aus einem Drittanbieter-Tracker (die ich früher erwähnte) ist auf der offiziellen Seite **nicht zu sehen**.

| Punkt | Befund |
| --- | --- |
| Back-end-Zugriff | „no 'back-end' access to Milanote is available to the User unless expressly agreed in writing“ (7.3). Milanote werde „only … installed, accessed and maintained by the Company“. |
| Reverse Engineering | Untersagt ist, „directly or indirectly copy, recreate, decompile, reverse engineer“ (7.7), auch Algorithmen und Architektur. |
| Sicherheit | „shall not do anything to prejudice the security or privacy of the Company's systems“ (7.6). |
| Automatisierung, Roboter, Skripte, KI | **Abschnitt 7 äußert sich dazu nicht.** Das ist weder Erlaubnis noch Verbot. |
| Folgen | „The Company may suspend the Account or restrict the access of any User that breaches the terms“; die Lizenz ist widerruflich (7.1). |
| Offenlegungsrichtlinie | [Vulnerability Disclosure Policy](https://help.milanote.com/en/articles/13841715-vulnerability-disclosure-policy.md): Schutz vor rechtlichen Schritten nur für Sicherheitsforschung in gutem Glauben an **eigens zum Testen angelegten Konten**, ohne „data manipulation, or service disruption“. Das ist **kein Freibrief** für unseren Connector. Die Adresse security@milanote.com ist nur für Sicherheitslücken da, nicht für Anfragen zu diesem Projekt. |
| `robots.txt` | sperrt `/api` nicht (nur drei Abfrageparameter für Crawler). Das ist keine Erlaubnis. |
| Support | support@milanote.com, laut [Hilfe-Center](https://help.milanote.com/en/articles/1887648-help-i-ve-lost-my-content.md) „We normally reply within 24 hours“. |
| Datenschutzerklärung | [Privacy policy](https://milanote.com/legal/privacy-policy): Server in den USA; Boardinhalte und KI/maschinelles Lernen werden nicht erwähnt. Wenn du Boardinhalte an Claude gibst, sind das deine Daten; bei geteilten Boards auch die anderer. |
| Sicherheit/WAF | Milanote nennt eine „managed Web Application Firewall“ auf allen öffentlichen Endpunkten (passt zur Bot-Abwehr, die der Brückentab im echten Browser umgeht). Rate-Limiting wird nicht erwähnt, wir bleiben bei niedriger Frequenz. |

**Einschätzung:** Das Mitschneiden und Nutzen des privaten Protokolls fällt plausibel unter 7.3 und 7.7; verboten „für Automatisierung“ steht nirgends. Das Risiko ist eine Kontosperre, nicht Strafverfolgung. Es bleibt **deine Entscheidung**. Wenn du Klarheit willst, ist das der Weg (Entwurf unten, nichts gesendet).

> **Entwurf an support@milanote.com** (Englisch, zum Anpassen; ich habe nichts gesendet)
>
> Subject: Question about personal automation of my own Pro account
>
> Hi, I'm a Pro user building a small personal tool that lets an AI assistant (Claude, via a local MCP server) read my own boards and add or move cards. It runs only on my computer, uses my own logged-in browser session, works at low frequency, never deletes anything (items go to the trash), and does not touch other people's data. I understand sections 7.3 and 7.7 of the Terms restrict back-end access and reverse engineering. Is personal use like this acceptable, and is there an official API or approved way to do it? Thanks!

## 3. Plan und Limits

| Aussage in meinen Unterlagen | Offiziell ([Upload-Limits Free/Pro](https://help.milanote.com/en/articles/1722107-how-do-file-upload-limits-differ-between-free-and-pro-plans.md), [Dateitypen](https://help.milanote.com/en/articles/1159010-what-kind-of-files-can-i-upload.md)) | Status |
| --- | --- | --- |
| Free: 100 Notizen/Bilder/Links, 10 Uploads (Cotlet) | Free: **100 Karten** („notes, images, etc.“), **10 Dateien** („PDFs, Word, PSD, etc.“). Pro: unbegrenzt | bestätigt, präzisiert: „Uploads“ meint Dateien, Bilder zählen offenbar zu den Karten |
| Bilder bis 4 MB | **Free: 10 MB je Bild, 50 MB sonst. Pro: 100 MB je Bild, 5 GB sonst.** 4 MB ist nur das Limit des Skills | **korrigiert** |
| Bildformate | JPEG, GIF, PNG, WebP, TIFF, BMP, ICO, SVG und RAW-Formate. **HEIC steht nicht in der Liste.** Dazu Audio, Video, Office, PDF, Archive | neu; für Phase 4 relevant |
| Verhalten am Limit | nicht dokumentiert | offen |
| Board-Größe | Versionshinweis vom 2.6.2026 „Increased board size limits“, ohne Zahlen | offen |

Du hast einen bezahlten Plan: Das Kartenlimit (100) und die Dateizahl (10) gelten für dich nicht. Der [Pro-Plan-Artikel](https://help.milanote.com/en/articles/3600864-what-are-the-benefits-of-a-pro-plan.md) nennt dazu keine Zahlen, nur „unlimited space“.

## 4. Elemente und Verhalten

Quellen: Hilfeartikel zu [Spalten](https://help.milanote.com/en/articles/10478526-columns.md), [To-do-Listen](https://help.milanote.com/en/articles/10486983-to-do-lists.md), [Links](https://help.milanote.com/en/articles/1722065-links.md), [Bildern](https://help.milanote.com/en/articles/359381-images.md), [Dokumenten](https://help.milanote.com/en/articles/10458661-documents.md), [Home-Board](https://help.milanote.com/en/articles/9860047-what-is-the-home-board.md), [Unsortiert](https://help.milanote.com/en/articles/111399-unsorted-notes.md), [Verschachteln](https://help.milanote.com/en/articles/9860073-nesting-boards.md).

| Aussage in meinen Unterlagen/Code | Offiziell | Status |
| --- | --- | --- |
| Elementtypen aus milanote-plus-plus (Note, Spalte, To-do, Link, Bild, Datei, Board, Linie, Tabelle, Sketch, Farbfeld, Dokument …) | Die Hilfe nennt dieselben Kartenarten, dazu Synced notes (entspricht `CLONE`), Map-, Video- und Audio-Karten | bestätigt; Map/Video/Audio nicht behandelt |
| Boards nur auf Boards verschieben (Regel aus M++) | „You can put boards or documents into a column“ | **korrigiert**: Boards dürfen in Spalten |
| Spalten nicht in Spalten | „Columns can't be nested“ | bestätigt |
| Spalten haben Titel, sind in der Breite änderbar | Titel ja; Größenänderung „by dragging its bottom right edge“; einklappbar | bestätigt |
| To-do-Liste mit optionalem Titel | „Add a title …“ ist optional | bestätigt |
| (nicht berücksichtigt) | Aufgaben haben Fälligkeit, Zuweisung und Einrücken (Unteraufgaben) | ergänzt: **nicht unterstützt** |
| Link-Karte: Vorschaubild, Beschreibung, URL | genau das; eine **Board-URL wird zur Verknüpfung** auf das Board | bestätigt, ergänzt |
| „Zeigt die URL auf ein Bild, wird daraus eine Bildkarte“ | **nicht belegt** („does not confirm that an image URL becomes an image card“) | **korrigiert**: Aussage aus dem Tool-Text entfernt |
| Bild: Beschriftung ein/aus, Position sperrbar | „toggle an image caption“, „Lock position“ | bestätigt |
| Bild per URL einfügen | nicht dokumentiert (nur Hochladen, Ziehen, Web Clipper, Bildbibliothek) | offen |
| Home-Board gesperrt (eigene Regel) | Home ist „always private“, nicht teilbar, nicht exportierbar | passt; das Schreibverbot dort ist unsere Vorsicht, kein Verbot von Milanote |
| `INBOX` = „Unsorted“ | „Every board has its own Unsorted Notes section“; was auf ein Board gezogen wird, landet dort | bestätigt (dass es technisch `INBOX` ist, bleibt Annahme) |
| Dokumente | nur Text, gleiche Formatierung wie Notizen, nicht gleichzeitig von mehreren bearbeitbar | ergänzt |

## 5. Textformatierung

Quellen: [Text Formatting](https://help.milanote.com/en/articles/4675110-text-formatting.md), [Keyboard shortcuts](https://help.milanote.com/en/articles/111393-keyboard-shortcuts.md), [Versionshinweise](https://milanote.com/releases/web). Milanote: „deliberately minimal“.

| Format | Belegt? | Umgang im Code |
| --- | --- | --- |
| Überschriften | **nur zwei Ebenen** („Large heading“, „Normal heading“) | **korrigiert**: `#` und `##`; `###` wird wie `##` behandelt (vorher Ebene 3) |
| Fett, kursiv, unterstrichen, durchgestrichen, hervorgehoben | ja (Tastenkürzel) | fett, kursiv, durchgestrichen werden erzeugt |
| Inline-Code | ja (Versionshinweis 13.10.2026: kombinierbar mit fett, kursiv, Hervorhebung, Links) | wird erzeugt |
| Trennlinie | ja („Divider lines“, Versionshinweis 24.6.2025, `---`) | wird erzeugt |
| Callout | ja (1.7.2025) | wird nicht erzeugt |
| Aufzählung, Nummerierung, Zitat, Checkbox in Notizen | ja (Tastenkürzel und Markdown-Eingabe `.`, `1.`, `>`, `[ ]`) | werden erzeugt |
| Codeblock | ja | **neu**: Markdown-Codezäune (```) werden unterstützt |
| Links | ja | werden erzeugt |

Die Knotenformen (TipTap-Struktur) bleiben unbestätigt; ob Milanote das Erzeugte so darstellt, zeigt der Abnahmetest.

## 6. Export

Quelle: [Exporting your work](https://help.milanote.com/en/articles/111395-exporting-your-work.md).

- **Formate:** PDF Standard, PDF Large, PNG, Word, Markdown, Plain text; dazu „Generate ZIP“ für alle Bilder und Dateien (kommt per E-Mail, wenn groß).
- **PDF und PNG begrenzen den Export auf eine Seite** („will limit your board export to a single page“). Das bestätigt die Angabe aus dem Fahrplan.
- **Das Home-Board lässt sich nicht exportieren.** Neu: `export_board` (Phase 6) muss das melden.
- Tabellen sind seit 28.1.2026 im Export. Die Zuverlässigkeit wurde laut Versionshinweisen am 26.5., 25.8., 22.9. und 13.10.2026 verbessert, der Export ist also noch in Bewegung.
- Nicht angegeben: welche Pläne exportieren dürfen und was Markdown/Text genau enthalten.
- **Korrektur an `protocol.md`:** „Export ist von keiner Quelle dokumentiert“ stimmte nicht. Dokumentiert sind Formate und Verhalten; **das Protokoll dazu nicht**.

## 7. Papierkorb

Quelle: [The trash](https://help.milanote.com/en/articles/10583739-the-trash.md).

- „Deleted content remains in the trash for **3 months**“, in der Oberfläche unten links; Abschnitte „Deleted by me“ und „Deleted by others“.
- Wiederherstellen durch Zurückziehen aufs Board. In den Mobil-Apps ist Wiederherstellen nicht möglich.
- „Empty trash“ löscht endgültig; das tun wir nie.
- Nicht beantwortet: ob der Papierkorb je Board oder global ist (nur „Deleted by others“ ist board-bezogen) und was mit Inhalt einer gelöschten Spalte oder eines Boards geschieht.
- **Korrigiert:** Tool-Text und Doku sagten „Papierkorb des Boards“. Das ist technisch aus milanote-plus-plus (`<boardId>-trash`), aber offiziell nicht belegt. Die Tools nennen jetzt die belegte Aufbewahrungszeit.
- Zusätzlich gilt Strg+Z nur, solange Milanote offen ist.

## 8. Änderungsrisiko

Die Versionshinweise zeigen **20 Einträge zwischen 19.5. und 20.10.2026**, also nahezu wöchentliche Änderungen, darunter Export, Tabellen, Textformate und eine Farbüberarbeitung. Das stützt das Risiko „Milanote ändert intern etwas“ und den geplanten Canary-Test (Phase 7).

## 9. Zusätzliche Angaben ohne Folge für den Code

- Es gibt Desktop-Apps für Mac und Windows, iOS/Android-Apps und Web Clipper für Chrome, Firefox, Safari. Der Connector nutzt die Web-App in Chrome.
- Anmeldung: Passwort, Google, Apple. Eine Zwei-Faktor-Anmeldung für Kundenkonten steht nicht in der Sicherheitsseite (sie nennt MFA nur für Mitarbeiter).
- Preise: nicht geprüft (siehe oben).

## 10. Offiziell nicht belegbar

- **Einheit der Koordinaten, Kartengrößen, Höhenberechnung:** Das Hilfe-Center nennt nur Zoom und das Ziehen an Ecken, keine Maße oder ein Raster. Die Quellen widersprechen sich (7 bis 9 Pixel je Einheit). Klärung nur mit `npm run spike -- measure` an deinem Board (`docs/phase5.md`).
- **Das gesamte Protokoll:** Socket.IO, Aktionsformen (`ELEMENT_*`), Felder, IDs, Upload-Ablauf, Presign, Media-Service-Pfade.
- Verhalten an den Limits und bei fehlgeschlagener Link-Vorschau.

## 11. Was ich geändert habe

1. **Überschriften:** nur zwei Ebenen. Zuvor wurden `###` als Ebene 3 erzeugt, die Milanote laut Hilfe nicht kennt. Geändert in `richtext.ts` und dem Tool-Text.
2. **Boards in Spalten** sind erlaubt (`move_element`). Zuvor lehnte der Code das ab.
3. **Codeblöcke** (```) werden als Codeblock erzeugt statt als Fließtext.
4. **`add_link`:** Die Behauptung „Bild-URL wird zur Bildkarte“ ist aus dem Tool-Text entfernt, stattdessen steht die belegte Board-Verknüpfung.
5. **Papierkorb:** Formulierung „Papierkorb des Boards, wiederherstellbar“ ersetzt durch die belegten Angaben (3 Monate, zurückziehen).
6. **Dokumentation:** Bildgrößen (10/100 MB statt 4 MB), Free-Limits (Karten und Dateien), Nutzungsbedingungen (Zitate statt unsicherer Klauselnummern, Support-Adresse), Export (Formate, Home-Board, eine Seite).

Noch offen und als Wunsch notiert: Aufgaben mit Fälligkeit, Zuweisung und Einrückung, Callouts, Dokument-Karten.
