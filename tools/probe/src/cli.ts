// Einstieg: npm run probe -- <befehl> [optionen]

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CdpConnection, browserWsUrl, isMilanoteUrl, listTargets } from '../../../src/session/cdp.ts';
import { capture } from './capture.ts';
import { screenshot } from './screenshot.ts';
import { summarizeFile } from './summarize.ts';
import { redactUrl } from './redact.ts';

const DEFAULT_OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'captures');

const HELP = `Milanote-Probe (Phase 0, nur lokal)

  npm run probe -- targets                 Verbindung prüfen, Milanote-Tabs auflisten
  npm run probe -- capture [optionen]      Passiv mitschneiden, bis "q" + Enter
      --port <n>        Debug-Port (Standard 9222)
      --out <dir>       Zielordner (Standard tools/probe/captures, gitignored)
      --all-hosts       auch Hosts außerhalb milanote.com / S3 / CloudFront mitschneiden
      --keep-pings      Engine.IO-Ping/Pong-Frames nicht auslassen
      --max-body <n>    maximale Zeichen pro Body (Standard 200000)
  npm run probe -- screenshot [--port <n>] [--out <dir>] [--url <teil>]
  npm run probe -- summarize <datei.capture.jsonl>
`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const port = Number(option(args, '--port') ?? 9222);
  const outDir = option(args, '--out') ?? DEFAULT_OUT;

  switch (command) {
    case 'targets': {
      const cdp = await CdpConnection.connect(await browserWsUrl(port));
      const targets = (await listTargets(cdp)).filter((t) => isMilanoteUrl(t.url));
      cdp.close();
      if (!targets.length) console.log('Verbunden, aber kein Milanote-Tab offen.');
      for (const t of targets) console.log(`${t.type.padEnd(15)} ${redactUrl(t.url)}`);
      return;
    }
    case 'capture': {
      const file = await capture({
        port,
        outDir,
        allHosts: args.includes('--all-hosts'),
        keepPings: args.includes('--keep-pings'),
        maxBody: Number(option(args, '--max-body') ?? 200_000),
      });
      console.log(`\nGespeichert: ${file}\nAuswerten: npm run probe -- summarize "${file}"`);
      return;
    }
    case 'screenshot': {
      console.log(`Gespeichert: ${await screenshot(port, outDir, option(args, '--url'))}`);
      return;
    }
    case 'summarize': {
      const file = args[0];
      if (!file) throw new Error('Datei fehlt: npm run probe -- summarize <datei>');
      process.stdout.write(summarizeFile(file));
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
