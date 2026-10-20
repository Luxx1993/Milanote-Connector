// Passiver Mitschnitt: hängt sich per CDP an die Milanote-Tabs eines laufenden Chrome und schreibt
// HTTP-Anfragen, Antworten, WebSocket-Frames und Downloads als JSONL. Das Skript sendet selbst
// nichts an Milanote; alle Aktionen macht der Mensch im Browser. Jede Zeile wird vor dem Schreiben
// geschwärzt (redact.ts).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CdpConnection, browserWsUrl, isMilanoteUrl, listTargets, type CdpEvent } from './cdp.ts';
import { redactBody, redactHeaders, redactUrl, scrubLine, truncate } from './redact.ts';

export interface CaptureOptions {
  port: number;
  outDir: string;
  allHosts: boolean;
  keepPings: boolean;
  maxBody: number;
}

type Rec = Record<string, unknown>;

// Hosts, die für Bild-Upload und Export relevant sein können (signierte S3-URLs, CDN).
const RELATED_HOST = /(^|\.)(milanote\.com|amazonaws\.com|cloudfront\.net)$/;
// Telemetrie und WAF-Challenge: nur Rauschen.
const NOISE = /nr-data\.net|newrelic|google-analytics|googletagmanager|segment\.(io|com)|sentry\.io|\/awswaf\//;
const TEXT_MIME = /json|text|javascript|xml|x-www-form-urlencoded/i;

export async function capture(options: CaptureOptions): Promise<string> {
  mkdirSync(options.outDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(options.outDir, `${stamp}.capture.jsonl`);
  const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
  const started = Date.now();
  const write = (record: Rec) => writeLine(out, { t: Date.now() - started, ...record });

  const cdp = await CdpConnection.connect(await browserWsUrl(options.port));
  const sessions = new Map<string, { targetId: string; type: string }>();
  const attaching = new Set<string>();
  const requests = new Map<string, { url: string; mime?: string; sessionId?: string }>();
  const pendingExtra = new Map<string, Rec>();
  const sockets = new Set<string>();
  let pings = 0;

  const wanted = (url: string) => !NOISE.test(url) && (options.allHosts || hostMatches(url));
  const key = (sessionId: string | undefined, requestId: unknown) => `${sessionId ?? ''}:${String(requestId)}`;

  const attach = async (targetId: string, type: string, url: string) => {
    if (attaching.has(targetId) || [...sessions.values()].some((s) => s.targetId === targetId)) return;
    if (!['page', 'iframe', 'worker', 'service_worker', 'shared_worker'].includes(type)) return;
    if (!isMilanoteUrl(url)) return;
    attaching.add(targetId);
    try {
      const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })) as { sessionId: string };
      sessions.set(sessionId, { targetId, type });
      await cdp.send('Network.enable', { maxPostDataSize: options.maxBody }, sessionId);
      if (type === 'page' || type === 'iframe') await cdp.send('Page.enable', {}, sessionId).catch(() => undefined);
      await cdp.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
      write({ kind: 'target.attached', type, url: redactUrl(url) });
      console.log(`  verbunden: ${type} ${redactUrl(url)}`);
    } catch (error) {
      write({ kind: 'target.error', type, url: redactUrl(url), error: String(error) });
    } finally {
      attaching.delete(targetId);
    }
  };

  cdp.onEvent((event) => {
    void handle(event).catch((error) => write({ kind: 'probe.error', method: event.method, error: String(error) }));
  });

  async function handle({ method, params: p, sessionId }: CdpEvent): Promise<void> {
    switch (method) {
      case 'Target.targetCreated':
      case 'Target.targetInfoChanged': {
        const info = p.targetInfo as { targetId: string; type: string; url: string };
        await attach(info.targetId, info.type, info.url);
        return;
      }
      case 'Target.detachedFromTarget': {
        if (typeof p.sessionId === 'string') sessions.delete(p.sessionId);
        return;
      }
      case 'Network.requestWillBeSent': {
        const req = p.request as { url: string; method: string; headers: Rec; postData?: string; hasPostData?: boolean };
        if (!wanted(req.url)) return;
        const k = key(sessionId, p.requestId);
        requests.set(k, { url: req.url, sessionId });
        const contentType = headerValue(req.headers, 'content-type');
        let body: Rec | undefined;
        if (contentType && !TEXT_MIME.test(contentType) && (req.hasPostData || req.postData !== undefined)) {
          // z. B. das PUT eines Bildes an die signierte S3-URL: nur Typ und Größe, keine Bytes
          body = { binary: true, contentType, length: req.postData?.length };
        } else if (req.postData !== undefined) body = bodyRecord(req.postData, contentType, options.maxBody);
        else if (req.hasPostData && TEXT_MIME.test(contentType)) {
          const posted = await cdp.send('Network.getRequestPostData', { requestId: p.requestId }, sessionId).catch(() => null);
          if (posted && typeof posted.postData === 'string') body = bodyRecord(posted.postData, contentType, options.maxBody);
        } else if (req.hasPostData) body = { binary: true, contentType };
        write({
          kind: 'http.request',
          id: k,
          method: req.method,
          url: redactUrl(req.url),
          resourceType: p.type,
          headers: redactHeaders(req.headers),
          ...(body ? { body } : {}),
        });
        const extra = pendingExtra.get(k);
        if (extra) {
          pendingExtra.delete(k);
          write(extra);
        }
        return;
      }
      case 'Network.requestWillBeSentExtraInfo': {
        const k = key(sessionId, p.requestId);
        const record = { kind: 'http.request.extra', id: k, headers: redactHeaders(p.headers as Rec) };
        if (requests.has(k)) write(record);
        else pendingExtra.set(k, record);
        if (pendingExtra.size > 500) pendingExtra.clear();
        return;
      }
      case 'Network.responseReceived': {
        const k = key(sessionId, p.requestId);
        const tracked = requests.get(k);
        if (!tracked) return;
        const res = p.response as { status: number; mimeType: string; headers: Rec; url: string };
        tracked.mime = res.mimeType;
        write({ kind: 'http.response', id: k, status: res.status, mimeType: res.mimeType, headers: redactHeaders(res.headers) });
        return;
      }
      case 'Network.loadingFinished': {
        const k = key(sessionId, p.requestId);
        const tracked = requests.get(k);
        if (!tracked) return;
        requests.delete(k);
        if (!tracked.mime || !TEXT_MIME.test(tracked.mime)) {
          write({ kind: 'http.done', id: k, bytes: p.encodedDataLength });
          return;
        }
        const res = await cdp.send('Network.getResponseBody', { requestId: p.requestId }, sessionId).catch(() => null);
        const text = res && typeof res.body === 'string' ? (res.base64Encoded ? '[base64]' : res.body) : '';
        write({ kind: 'http.done', id: k, bytes: p.encodedDataLength, body: bodyRecord(text, tracked.mime, options.maxBody) });
        return;
      }
      case 'Network.loadingFailed': {
        const k = key(sessionId, p.requestId);
        if (!requests.delete(k)) return;
        write({ kind: 'http.failed', id: k, error: p.errorText, canceled: p.canceled, blockedReason: p.blockedReason });
        return;
      }
      case 'Network.webSocketCreated': {
        const url = String(p.url);
        if (!wanted(url)) return;
        sockets.add(key(sessionId, p.requestId));
        write({ kind: 'ws.created', id: key(sessionId, p.requestId), url: redactUrl(url) });
        return;
      }
      case 'Network.webSocketHandshakeResponseReceived': {
        const k = key(sessionId, p.requestId);
        if (!sockets.has(k)) return;
        const res = p.response as { status: number; headers: Rec };
        write({ kind: 'ws.handshake', id: k, status: res.status, headers: redactHeaders(res.headers) });
        return;
      }
      case 'Network.webSocketFrameSent':
      case 'Network.webSocketFrameReceived': {
        const k = key(sessionId, p.requestId);
        if (!sockets.has(k)) return;
        const frame = p.response as { opcode: number; payloadData: string };
        const direction = method.endsWith('Sent') ? 'out' : 'in';
        if (frame.opcode !== 1) {
          write({ kind: 'ws.frame', id: k, direction, opcode: frame.opcode, bytes: frame.payloadData.length });
          return;
        }
        if (!options.keepPings && (frame.payloadData === '2' || frame.payloadData === '3')) {
          pings += 1;
          return;
        }
        write({ kind: 'ws.frame', id: k, direction, ...bodyRecord(frame.payloadData, 'json', options.maxBody) });
        return;
      }
      case 'Network.webSocketClosed': {
        const k = key(sessionId, p.requestId);
        if (sockets.delete(k)) write({ kind: 'ws.closed', id: k });
        return;
      }
      case 'Browser.downloadWillBegin': {
        write({ kind: 'download.begin', url: redactUrl(String(p.url)), filename: p.suggestedFilename, guid: p.guid });
        return;
      }
      case 'Browser.downloadProgress': {
        if (p.state !== 'inProgress') write({ kind: 'download.progress', guid: p.guid, state: p.state, bytes: p.totalBytes });
        return;
      }
    }
  }

  await cdp.send('Target.setDiscoverTargets', { discover: true });
  // Downloads (z. B. Export als PDF/PNG) melden, ohne das Download-Verhalten des Browsers zu ändern.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true }).catch(() => undefined);
  const targets = await listTargets(cdp);
  for (const target of targets) await attach(target.targetId, target.type, target.url);
  if (sessions.size === 0) console.log('  Noch kein Milanote-Tab offen. Sobald einer geöffnet wird, verbindet sich das Skript.');
  write({ kind: 'probe.start', options: { allHosts: options.allHosts, keepPings: options.keepPings, maxBody: options.maxBody } });

  console.log(`\nMitschnitt läuft -> ${file}`);
  console.log('Text + Enter setzt eine Markierung (z. B. "Bild per Drag & Drop hochladen"). "q" + Enter beendet.\n');

  let stopped = false;
  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: process.stdin });
    const stop = () => {
      stopped = true;
      rl.close();
      resolve();
    };
    rl.on('line', (line) => {
      const text = line.trim();
      if (text === 'q' || text === 'quit') return stop();
      if (text) {
        write({ kind: 'marker', text });
        console.log(`  Markierung: ${text}`);
      }
    });
    rl.on('close', resolve);
    process.once('SIGINT', stop);
    cdp.onClose(() => {
      if (stopped) return;
      console.log('Browser-Verbindung beendet.');
      stop();
    });
  });

  write({ kind: 'probe.stop', pingsSkipped: pings });
  cdp.close();
  await new Promise<void>((resolve) => out.end(resolve));
  return file;
}

function writeLine(out: WriteStream, record: Rec): void {
  out.write(`${scrubLine(JSON.stringify(record))}\n`);
}

function bodyRecord(text: string, contentType: string, max: number): Rec {
  const cut = truncate(redactBody(text, contentType), max);
  return cut.truncated ? { data: cut.text, truncated: true, length: cut.length } : { data: cut.text };
}

function headerValue(headers: Rec, name: string): string {
  for (const [key, value] of Object.entries(headers ?? {})) if (key.toLowerCase() === name) return String(value);
  return '';
}

function hostMatches(url: string): boolean {
  try {
    return RELATED_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
