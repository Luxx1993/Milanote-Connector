// Screenshot des sichtbaren Milanote-Tabs per CDP (Machbarkeit für `screenshot_board`).
// Hinweis aus milanote-skill (notes.md, 2026-10-19): Page.captureScreenshot hängt bei minimierten
// Fenstern. Deshalb erst Page.bringToFront, dann mit Zeitlimit aufnehmen.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CdpConnection, browserWsUrl, isMilanoteUrl, listTargets } from '../../../src/session/cdp.ts';

export async function screenshot(port: number, outDir: string, urlContains?: string): Promise<string> {
  const cdp = await CdpConnection.connect(await browserWsUrl(port));
  try {
    const pages = (await listTargets(cdp)).filter((t) => t.type === 'page' && isMilanoteUrl(t.url));
    const target = urlContains ? pages.find((t) => t.url.includes(urlContains)) : pages[0];
    if (!target) throw new Error(urlContains ? `Kein Milanote-Tab mit "${urlContains}" in der URL` : 'Kein Milanote-Tab offen');
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as { sessionId: string };
    await cdp.send('Page.bringToFront', {}, sessionId);
    const visibility = (await cdp.send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, sessionId)) as {
      result?: { value?: string };
    };
    if (visibility.result?.value !== 'visible') {
      throw new Error('Der Milanote-Tab ist nicht sichtbar (Fenster minimiert?). Fenster in den Vordergrund holen und erneut versuchen.');
    }
    const shot = (await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId, 20_000)) as { data: string };
    mkdirSync(outDir, { recursive: true, mode: 0o700 });
    const file = join(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'), { mode: 0o600 });
    return file;
  } finally {
    cdp.close();
  }
}
