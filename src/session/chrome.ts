// Startet Chrome sichtbar mit Debug-Port und einem eigenen Profil nur für den Connector.
// Seit Chrome 136 ist ein eigenes Profil (--user-data-dir) für den Debug-Port Pflicht. Die Anmeldung
// bei Milanote (inklusive 2FA) passiert einmal von Hand in diesem Profil und bleibt dort erhalten.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_PROFILE_DIR = join(homedir(), '.milanote-connector', 'chrome-profile');

export function findChrome(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates: string[] =
    process.platform === 'win32'
      ? [
          join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
          join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
          join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return candidates.find((path) => existsSync(path));
}

export async function isDebugPortOpen(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function launchChrome(port: number, profileDir = DEFAULT_PROFILE_DIR): Promise<string> {
  if (await isDebugPortOpen(port)) return `Auf Port ${port} läuft bereits ein Browser mit Debug-Port.`;
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome nicht gefunden. Pfad über die Umgebungsvariable CHROME_PATH angeben.');
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${port}`,
      // Nur lokal erreichbar (Standard, hier ausdrücklich gesetzt).
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'https://app.milanote.com',
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  for (let i = 0; i < 50; i += 1) {
    if (await isDebugPortOpen(port)) return `Chrome läuft (Profil ${profileDir}, Port ${port}).`;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Chrome wurde gestartet, aber der Debug-Port antwortet nicht.');
}
