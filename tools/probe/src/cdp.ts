// Minimaler Chrome-DevTools-Protocol-Client (flache Sessions über eine Browser-Verbindung).
// Nutzt das in Node 22 eingebaute WebSocket, damit das Probe-Skript keine Laufzeitabhängigkeiten hat.

export type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };
type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
}

export class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(event: CdpEvent) => void>();
  private closedHandlers = new Set<() => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (message) => this.onMessage(String(message.data)));
    ws.addEventListener('close', () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('CDP-Verbindung geschlossen'));
      }
      this.pending.clear();
      for (const handler of this.closedHandlers) handler();
    });
  }

  static async connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpConnection> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP-Verbindung zu ${wsUrl} hat nicht geantwortet`)), timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP-Verbindung zu ${wsUrl} fehlgeschlagen`)); }, { once: true });
    });
    return new CdpConnection(ws);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} ohne Antwort nach ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
  }

  onEvent(listener: (event: CdpEvent) => void): void {
    this.listeners.add(listener);
  }

  onClose(handler: () => void): void {
    this.closedHandlers.add(handler);
  }

  close(): void {
    this.ws.close();
  }

  private onMessage(raw: string): void {
    let message: { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      if (message.error) p.reject(new Error(message.error.message || 'CDP-Fehler'));
      else p.resolve(message.result ?? {});
      return;
    }
    if (message.method) {
      const event: CdpEvent = { method: message.method, params: message.params ?? {}, sessionId: message.sessionId };
      for (const listener of this.listeners) listener(event);
    }
  }
}

/** Liest die Browser-WebSocket-URL vom lokalen Debug-Port. */
export async function browserWsUrl(port: number): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/json/version`);
  } catch {
    throw new Error(
      `Kein Browser auf 127.0.0.1:${port}. Chrome mit eigenem Profil starten, z. B.:\n` +
        `  chrome --remote-debugging-port=${port} --user-data-dir=<Pfad>/.chrome-profile https://app.milanote.com\n` +
        'Seit Chrome 136 wird der Debug-Port im Standardprofil ignoriert; ein eigenes Profil ist Pflicht (siehe tools/probe/README.md).',
    );
  }
  const info = (await response.json()) as { webSocketDebuggerUrl?: string };
  if (!info.webSocketDebuggerUrl) throw new Error('Der Debug-Port liefert keine webSocketDebuggerUrl');
  return info.webSocketDebuggerUrl;
}

export function isMilanoteUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'milanote.com' || host.endsWith('.milanote.com');
  } catch {
    return false;
  }
}

export async function listTargets(cdp: CdpConnection): Promise<TargetInfo[]> {
  const result = await cdp.send('Target.getTargets');
  return (result.targetInfos as TargetInfo[] | undefined) ?? [];
}
