// Spike-CLI (Phase 1 bis 5): Verbindung prüfen, Boards lesen, Elemente anlegen, ändern, verschieben, anordnen.
// Schreibbefehle landen nie im Home-Board (siehe MILANOTE_ALLOW_HOME in docs/phase3.md).

import { readFileSync, writeFileSync } from 'node:fs';
import { MilanoteClient } from '../milanote.ts';
import { planCompose, type ComposeSpec } from '../layout/compose.ts';
import { loadMetrics } from '../layout/metrics.ts';
import { renderAscii } from '../layout/preview.ts';
import { MilanoteError } from '../errors.ts';
import { launchChrome } from '../session/chrome.ts';
import type { TaskInput } from '../writer.ts';

const HELP = `Milanote-Connector Spike

  npm run chrome                                   Chrome mit eigenem Profil starten, dort einmal anmelden
  npm run spike -- check                           Anmeldung + Socket-Handshake prüfen (schreibt nichts)

Lesen
  npm run spike -- boards [--parent <id|url>]      Unterboards (Standard: Home)
  npm run spike -- board <id|url>                  Board lesen (JSON wie get_board)
  npm run spike -- tree [--root <id|url>] [--depth <n>]
  npm run spike -- search <begriff>

Schreiben (Ziel ist ein Board oder, wo es passt, eine Spalte; jeweils optional --x <n> --y <n> auf Boards)
  npm run spike -- newboard --parent <id|url> --title "Titel"
  npm run spike -- note     --parent <id|url> --text "Markdown erlaubt"
  npm run spike -- link     --parent <id|url> --url https://… [--caption "Text"]
  npm run spike -- todo     --parent <id|url> [--title "Liste"] --task "eins" --task "zwei" [--done "erledigt"]
  npm run spike -- column   --parent <id|url> --title "Spalte" [--note "Text" ...]
  npm run spike -- trash    <id|url> [<id|url> ...]   (nur in den Papierkorb, nie endgültig)

Ändern, verschieben, anordnen
  npm run spike -- update   <id|url> [--text "…"] [--title "…"] [--done true|false] [--caption "…"]
  npm run spike -- move     <id|url> [--parent <id|url>] [--x <n> --y <n>]
  npm run spike -- resize   <id|url> --width <n>             (experimentell)
  npm run spike -- plan     --file spec.json [--ascii]       Layout berechnen, OHNE Browser und ohne zu schreiben
  npm run spike -- compose  --parent <id|url> --file spec.json [--title "Neues Unterboard"] [--x <n> --y <n>]
  npm run spike -- measure  <board-url> [--out metrics.json] Größen im sichtbaren Board messen (liest nur)

Optionen: --port <n> (Standard 9222), --verbose
`;

const COMMANDS = ['check', 'boards', 'board', 'tree', 'search', 'newboard', 'note', 'link', 'todo', 'column', 'trash', 'update', 'move', 'resize', 'plan', 'compose', 'measure'];
const FLAGS_WITH_VALUE = new Set(['--port', '--parent', '--board', '--root', '--depth', '--title', '--text', '--url', '--caption', '--task', '--done', '--note', '--x', '--y', '--width', '--file', '--out']);

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((arg, i) => (arg === name && args[i + 1] !== undefined ? [args[i + 1] as string] : []));
}

function numberOption(args: string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new MilanoteError('args', `${name} muss eine Zahl sein`);
  return value;
}

/** Positionsargumente: alles, was weder Flag noch Wert eines Flags ist. */
function positional(args: string[]): string[] {
  return args.filter((arg, i) => !arg.startsWith('--') && !FLAGS_WITH_VALUE.has(args[i - 1] ?? ''));
}

function first(args: string[], what: string): string {
  const value = positional(args)[0];
  if (!value) throw new MilanoteError('args', `${what} fehlt`);
  return value;
}

function readSpec(file: string): ComposeSpec {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as ComposeSpec;
  } catch (error) {
    throw new MilanoteError('args', `${file} ist keine lesbare JSON-Datei: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Layout berechnen und anzeigen. Braucht weder Browser noch Konto und schreibt nichts. */
function plan(args: string[]): void {
  const spec = readSpec(required(args, '--file'));
  const result = planCompose(spec, loadMetrics());
  console.log(`Layout ${spec.layout}: ${result.count} Elemente, Block ${result.bounds.w} × ${result.bounds.h} Einheiten (geschätzt)`);
  if (args.includes('--ascii')) console.log(`\n${renderAscii(result)}\n`);
  else console.log(JSON.stringify(result.steps.map((st) => ({ key: st.key, type: st.type, ...(st.rel ? { x: st.rel.x, y: st.rel.y, w: st.rel.w, h: st.rel.h } : { in: st.parentKey, index: st.index }) })), null, 2));
}

function required(args: string[], name: string, alias?: string): string {
  const value = option(args, name) ?? (alias ? option(args, alias) : undefined);
  if (!value) throw new MilanoteError('args', `Bitte ${name} angeben`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const port = numberOption(args, '--port') ?? 9222;
  const log = args.includes('--verbose') ? (m: string) => console.error(`  · ${m}`) : undefined;

  if (command === 'chrome') {
    console.log(await launchChrome(port));
    console.log('Im Chrome-Fenster bei Milanote anmelden (einmalig), danach: npm run spike -- check');
    return;
  }
  if (!COMMANDS.includes(command ?? '')) {
    console.log(HELP);
    return;
  }
  if (command === 'plan') return plan(args);

  const client = await MilanoteClient.connect({ port, log });
  try {
    const user = await client.whoami();
    console.error(`Angemeldet: ${user.displayName || '(ohne Namen)'} · Home-Board ${user.rootBoardId}`);
    const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
    const at = { x: numberOption(args, '--x'), y: numberOption(args, '--y') };
    const parent = () => required(args, '--parent', '--board');

    switch (command) {
      case 'check': {
        const started = Date.now();
        await client.checkSocket();
        console.log(`Socket-Handshake ok (${Date.now() - started} ms). Es wurde nichts geschrieben.`);
        return;
      }
      case 'boards':
        return print(await client.listBoards(option(args, '--parent')));
      case 'board': {
        const ref = positional(args)[0];
        if (!ref) throw new MilanoteError('args', 'Board-ID oder URL fehlt');
        return print(await client.readBoard(ref));
      }
      case 'tree':
        return print(await client.getBoardTree(option(args, '--root'), numberOption(args, '--depth')));
      case 'search':
        return print(await client.search(positional(args).join(' ')));
      case 'newboard':
        return report(await client.write.createBoard({ parent: parent(), title: required(args, '--title'), ...at }));
      case 'note':
        return report(await client.write.addNote({ parent: parent(), text: required(args, '--text'), ...at }));
      case 'link':
        return report(await client.write.addLink({ parent: parent(), url: required(args, '--url'), caption: option(args, '--caption'), ...at }));
      case 'todo': {
        const tasks: TaskInput[] = [...options(args, '--task'), ...options(args, '--done').map((text) => ({ text, done: true }))];
        return report(await client.write.addTodoList({ parent: parent(), title: option(args, '--title'), tasks, ...at }));
      }
      case 'column':
        return report(await client.write.addColumn({ parent: parent(), title: required(args, '--title'), notes: options(args, '--note'), ...at }));
      case 'update': {
        const done = option(args, '--done');
        if (done !== undefined && done !== 'true' && done !== 'false') throw new MilanoteError('args', '--done erwartet true oder false');
        return report(await client.write.updateElement({ element: first(args, 'Element-ID oder URL'), text: option(args, '--text'), title: option(args, '--title'), caption: option(args, '--caption'), done: done === undefined ? undefined : done === 'true' }));
      }
      case 'move':
        return report(await client.write.moveElement({ element: first(args, 'Element-ID oder URL'), parent: option(args, '--parent'), ...at }));
      case 'resize': {
        const width = numberOption(args, '--width');
        if (width === undefined) throw new MilanoteError('args', 'Bitte --width angeben');
        return report(await client.write.resizeElement({ element: first(args, 'Element-ID oder URL'), width }));
      }
      case 'compose': {
        const spec = readSpec(required(args, '--file'));
        return report(await client.write.composeBoard({ parent: parent(), title: option(args, '--title'), spec, ...at }));
      }
      case 'measure': {
        const result = await client.measureBoard(first(args, 'Board-URL'));
        print(result);
        const out = option(args, '--out');
        if (out) {
          writeFileSync(out, `${JSON.stringify(result.suggestedMetrics, null, 2)}\n`, { mode: 0o600 });
          console.error(`Vorschlag gespeichert: ${out}\nVerwenden mit: MILANOTE_METRICS_FILE=${out}`);
        }
        return;
      }
      case 'trash': {
        const result = await client.write.trash({ elements: positional(args) });
        print(result);
        if (!result.persisted) process.exitCode = 1;
        return;
      }
    }
  } finally {
    client.close();
  }
}

/** Ausgabe für Schreibbefehle: JSON, danach die Abnahme-Hinweise. Exitcode 1, wenn nicht gespeichert. */
function report(result: { persisted: boolean; boardUrl?: string; warnings: string[] }): void {
  console.log(JSON.stringify(result, null, 2));
  console.error(result.persisted ? 'Gespeichert (per REST bestätigt).' : 'ACHTUNG: per REST nicht bestätigt, siehe warnings und docs/phase3.md.');
  console.error('Abnahme: Erscheint das Element live im offenen Board und bleibt nach F5 erhalten?');
  if (!result.persisted) process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (error instanceof MilanoteError) console.error(`Fehler (${error.code}): ${error.message}`);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
