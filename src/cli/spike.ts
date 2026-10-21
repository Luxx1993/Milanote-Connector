// Spike-CLI (Phase 1 und 2): Verbindung prüfen, Notiz anlegen, Boards lesen.
//   npm run chrome                                     Chrome mit Debug-Port und eigenem Profil starten
//   npm run spike -- check                             Anmeldung und Socket-Handshake prüfen (schreibt nichts)
//   npm run spike -- note --board <id|url> --text "…" [--x 10 --y 4]
//   npm run spike -- boards [--parent <id|url>] | board <id|url> | tree [--root <id|url>] [--depth n] | search <begriff>

import { MilanoteClient } from '../milanote.ts';
import { MilanoteError } from '../errors.ts';
import { launchChrome } from '../session/chrome.ts';

const HELP = `Milanote-Connector Spike (Phase 1 und 2)

  npm run chrome                                  Chrome mit eigenem Profil starten, dort einmal anmelden
  npm run spike -- check                          Anmeldung + Socket-Handshake prüfen (schreibt nichts)
  npm run spike -- note --board <id|url> --text "Hallo" [--x <n> --y <n>]
                                                  Notiz anlegen (nie ins Home-Board)
  npm run spike -- boards [--parent <id|url>]     Unterboards (Standard: Home)
  npm run spike -- board <id|url>                 Board lesen (JSON wie get_board)
  npm run spike -- tree [--root <id|url>] [--depth <n>]
  npm run spike -- search <begriff>
Optionen: --port <n> (Standard 9222), --verbose
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(args: string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new MilanoteError('args', `${name} muss eine Zahl sein`);
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
  if (!['check', 'note', 'boards', 'board', 'tree', 'search'].includes(command ?? '')) {
    console.log(HELP);
    return;
  }

  const client = await MilanoteClient.connect({ port, log });
  try {
    const user = await client.whoami();
    console.log(`Angemeldet: ${user.displayName || '(ohne Namen)'} · Home-Board ${user.rootBoardId}`);
    if (command === 'check') {
      const started = Date.now();
      await client.checkSocket();
      console.log(`Socket-Handshake ok (${Date.now() - started} ms). Es wurde nichts geschrieben.`);
      return;
    }
    const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
    if (command === 'boards') return print(await client.listBoards(option(args, '--parent')));
    if (command === 'board') {
      if (!args[0] || args[0].startsWith('--')) throw new MilanoteError('args', 'Board-ID oder URL fehlt');
      return print(await client.readBoard(args[0]));
    }
    if (command === 'tree') return print(await client.getBoardTree(option(args, '--root'), numberOption(args, '--depth')));
    if (command === 'search') {
      const query = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--port').join(' ');
      return print(await client.search(query));
    }
    const board = option(args, '--board');
    const text = option(args, '--text');
    if (!board || !text) throw new MilanoteError('args', 'Bitte --board und --text angeben');
    const started = Date.now();
    const result = await client.createNote({ boardId: board, text, x: numberOption(args, '--x'), y: numberOption(args, '--y') });
    console.log(`Notiz ${result.id} angelegt bei x=${result.position.x}, y=${result.position.y} (${Date.now() - started} ms)`);
    console.log(`  Ack von Milanote: ${result.acknowledged ? 'ja' : 'nein'}`);
    console.log(`  Per REST gespeichert: ${result.persisted ? 'ja' : 'NEIN (siehe docs/phase1.md, Abnahme)'}`);
    console.log(`  Board: ${result.boardUrl}`);
    console.log('Abnahme: Erscheint die Notiz live im sichtbaren Tab? Bleibt sie nach Neuladen (F5) erhalten?');
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof MilanoteError) console.error(`Fehler (${error.code}): ${error.message}`);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
