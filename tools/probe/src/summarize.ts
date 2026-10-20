// Fasst einen Mitschnitt zusammen: welche REST-Endpunkte, welche Socket-Aktionen, welche Downloads,
// jeweils mit Beispiel-Keys. Ergebnis ist Markdown für docs/protocol.md.

import { readFileSync } from 'node:fs';

type Rec = Record<string, unknown>;

interface Endpoint {
  count: number;
  statuses: Set<number>;
  queryKeys: Set<string>;
  requestKeys: Set<string>;
  responseKeys: Set<string>;
  markers: Set<string>;
}

interface SocketEvent {
  out: number;
  in: number;
  keys: Set<string>;
  markers: Set<string>;
}

/** Ersetzt IDs im Pfad durch Platzhalter, damit gleiche Endpunkte zusammenfallen. */
export function pathTemplate(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => {
      if (/^[a-f0-9]{24}$/i.test(segment)) return ':userId';
      if (/^[0-9A-Za-z]{12,18}(-trash)?$/.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment)) return ':id';
      if (/^[0-9a-f-]{32,36}$/i.test(segment)) return ':uuid';
      if (/^\d{3,}$/.test(segment)) return ':n';
      return segment;
    })
    .join('/');
}

/** Zerlegt einen Socket.IO-Frame (`42`, `421`, `431`, ...) in Pakettyp, Ack-ID und JSON-Inhalt. */
export function parseSocketIo(data: string): { packet: string; ackId?: string; payload: unknown } | null {
  const match = /^(4[0-6])(\d*)([[{].*)$/s.exec(data);
  if (!match) return null;
  try {
    return { packet: match[1] ?? '', ackId: match[2] || undefined, payload: JSON.parse(match[3] ?? '') };
  } catch {
    return null;
  }
}

export function summarize(lines: string[]): string {
  const endpoints = new Map<string, Endpoint>();
  const byId = new Map<string, string>();
  const events = new Map<string, SocketEvent>();
  const downloads: string[] = [];
  const markers: string[] = [];
  const hosts = new Map<string, number>();
  let marker = '(vor der ersten Markierung)';

  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: Rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    switch (rec.kind) {
      case 'marker':
        marker = String(rec.text);
        markers.push(`${formatTime(rec.t)} ${marker}`);
        break;
      case 'http.request': {
        let url: URL;
        try {
          url = new URL(String(rec.url));
        } catch {
          break;
        }
        hosts.set(url.host, (hosts.get(url.host) ?? 0) + 1);
        const name = `${rec.method} ${url.host}${pathTemplate(url.pathname)}`;
        byId.set(String(rec.id), name);
        const ep = endpoints.get(name) ?? newEndpoint();
        endpoints.set(name, ep);
        ep.count += 1;
        ep.markers.add(marker);
        for (const key of url.searchParams.keys()) ep.queryKeys.add(key);
        addKeys(ep.requestKeys, (rec.body as Rec | undefined)?.data);
        break;
      }
      case 'http.response': {
        const ep = endpoints.get(byId.get(String(rec.id)) ?? '');
        if (ep && typeof rec.status === 'number') ep.statuses.add(rec.status);
        break;
      }
      case 'http.done': {
        const ep = endpoints.get(byId.get(String(rec.id)) ?? '');
        if (ep) addKeys(ep.responseKeys, (rec.body as Rec | undefined)?.data);
        break;
      }
      case 'ws.frame': {
        if (typeof rec.data !== 'string') break;
        const frame = parseSocketIo(rec.data);
        if (!frame) break;
        let name: string;
        let body: unknown;
        if (frame.packet === '42' && Array.isArray(frame.payload)) {
          const [event, first] = frame.payload as [unknown, unknown];
          const type = first && typeof first === 'object' && 'type' in first ? `:${String((first as Rec).type)}` : '';
          name = `${String(event)}${type}`;
          body = first;
        } else if (frame.packet === '43') {
          name = '(ack)';
          body = Array.isArray(frame.payload) ? frame.payload[0] : frame.payload;
        } else {
          name = `(paket ${frame.packet})`;
          body = frame.payload;
        }
        const ev = events.get(name) ?? { out: 0, in: 0, keys: new Set<string>(), markers: new Set<string>() };
        events.set(name, ev);
        if (rec.direction === 'out') ev.out += 1;
        else ev.in += 1;
        ev.markers.add(marker);
        addKeys(ev.keys, body);
        break;
      }
      case 'download.begin':
        downloads.push(`${formatTime(rec.t)} ${String(rec.filename)} <- ${String(rec.url)}`);
        break;
    }
  }

  const out: string[] = ['# Mitschnitt-Zusammenfassung', ''];
  if (markers.length) out.push('## Markierungen', '', ...markers.map((m) => `- ${m}`), '');
  out.push('## Hosts', '', ...[...hosts].sort((a, b) => b[1] - a[1]).map(([h, n]) => `- ${h}: ${n}`), '');
  out.push('## HTTP-Endpunkte', '', '| Endpunkt | Anzahl | Status | Query | Request-Keys | Response-Keys | bei Markierung |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const [name, ep] of [...endpoints].sort()) {
    out.push(`| \`${name}\` | ${ep.count} | ${[...ep.statuses].join(', ')} | ${list(ep.queryKeys)} | ${list(ep.requestKeys)} | ${list(ep.responseKeys)} | ${list(ep.markers)} |`);
  }
  out.push('', '## Socket.IO-Ereignisse', '', '| Ereignis | gesendet | empfangen | Keys | bei Markierung |', '| --- | --- | --- | --- | --- |');
  for (const [name, ev] of [...events].sort()) {
    out.push(`| \`${name}\` | ${ev.out} | ${ev.in} | ${list(ev.keys)} | ${list(ev.markers)} |`);
  }
  if (downloads.length) out.push('', '## Downloads', '', ...downloads.map((d) => `- ${d}`));
  return `${out.join('\n')}\n`;
}

export function summarizeFile(file: string): string {
  return summarize(readFileSync(file, 'utf8').split('\n'));
}

function newEndpoint(): Endpoint {
  return { count: 0, statuses: new Set(), queryKeys: new Set(), requestKeys: new Set(), responseKeys: new Set(), markers: new Set() };
}

function addKeys(into: Set<string>, data: unknown): void {
  let value = data;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) for (const key of Object.keys(value)) into.add(key);
}

function list(values: Set<string>): string {
  const all = [...values];
  const shown = all.slice(0, 12).map((v) => v.replace(/\|/g, '\\|'));
  return all.length > 12 ? `${shown.join(', ')}, … (+${all.length - 12})` : shown.join(', ');
}

function formatTime(t: unknown): string {
  const ms = typeof t === 'number' ? t : 0;
  return `[${(ms / 1000).toFixed(1)} s]`;
}
