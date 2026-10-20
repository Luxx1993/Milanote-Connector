// Brückentab: ein eigener Tab auf https://app.milanote.com/api/ping im per CDP gesteuerten Chrome.
// Weil er auf dem Milanote-Ursprung läuft, hängt der Browser Sitzungs- und WAF-Cookies selbst an
// REST-Aufrufe und den WebSocket an. Cookies und Tokens verlassen den Browser nie; Node sieht nur
// Antworten und Socket-Frames. Die gesamte Protokolllogik (Socket.IO, Acks, Wiederverbindung) liegt
// in Node (protocol/socket.ts), der Tab ist nur eine Leitung.

import { CdpConnection, isMilanoteUrl, listTargets, type CdpEvent } from './cdp.ts';
import type { FrameTransport } from '../protocol/socket.ts';

export const MILANOTE_ORIGIN = 'https://app.milanote.com';
const BRIDGE_URL = `${MILANOTE_ORIGIN}/api/ping`;
const BINDING = '__milanoteConnector';
const BRIDGE_VERSION = 1;

// Läuft im Tab. Bewusst klein: fetch mit Cookies, WebSocket-Leitung, WAF-Token erneuern.
const PAGE_SCRIPT = `(() => {
  if (window.__mc && window.__mc.version === ${BRIDGE_VERSION}) return;
  const emit = (msg) => { try { window.${BINDING}(JSON.stringify(msg)); } catch (e) {} };
  const sockets = new Map();
  let next = 0;
  window.__mc = {
    version: ${BRIDGE_VERSION},
    async fetch(req) {
      const init = { method: req.method, credentials: 'include', headers: { accept: 'application/json' } };
      if (req.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(req.body); }
      const res = await fetch(req.path, init);
      const text = await res.text();
      const tooLong = text.length > 20000000;
      return { status: res.status, text: tooLong ? '' : text, tooLong, waf: res.headers.get('x-amzn-waf-action') || '', href: location.href };
    },
    wsOpen(url) {
      const id = ++next;
      const ws = new WebSocket(url);
      sockets.set(id, ws);
      ws.onopen = () => emit({ ev: 'open', id });
      ws.onmessage = (m) => emit({ ev: 'message', id, data: String(m.data) });
      ws.onerror = () => emit({ ev: 'error', id });
      ws.onclose = (e) => { sockets.delete(id); emit({ ev: 'close', id, code: e.code, reason: e.reason || '' }); };
      return id;
    },
    wsSend(id, data) { const ws = sockets.get(id); if (!ws || ws.readyState !== 1) return false; ws.send(data); return true; },
    wsClose(id) { const ws = sockets.get(id); if (ws) ws.close(); },
    async wafRefresh() {
      if (!window.AwsWafIntegration) {
        const html = await (await fetch('/', { credentials: 'include' })).text();
        const m = html.match(/https:\\/\\/static\\.milanote\\.com\\/awswaf\\/[0-9a-f]+\\/challenge[\\w.]*\\.js/);
        if (!m) return false;
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = m[0]; s.onload = resolve; s.onerror = () => reject(new Error('WAF-Skript nicht ladbar'));
          document.documentElement.appendChild(s);
        });
      }
      if (window.AwsWafIntegration && typeof window.AwsWafIntegration.getToken === 'function') { await window.AwsWafIntegration.getToken(); return true; }
      return false;
    },
  };
  try { document.title = 'Milanote-Connector (offen lassen)'; } catch (e) {}
})()`;

export interface HttpResult {
  status: number;
  text: string;
  tooLong: boolean;
  waf: string;
}

type SocketListener = { onMessage: (data: string) => void; onClose: (reason: string) => void; onOpen: () => void; onError: () => void };

export class PageBridge {
  private readonly sockets = new Map<number, SocketListener>();
  // Ereignisse, die eintreffen, bevor Node die Socket-ID kennt (Rennen zwischen Antwort und Binding).
  private readonly early = new Map<number, { ev: string; data?: string; code?: number; reason?: string }[]>();

  private constructor(
    private readonly cdp: CdpConnection,
    private readonly sessionId: string,
    readonly targetId: string,
  ) {
    cdp.onEvent((event) => this.onEvent(event));
  }

  /** Findet den Brückentab oder legt ihn im Hintergrund an und installiert das Skript. */
  static async open(cdp: CdpConnection): Promise<PageBridge> {
    const targets = await listTargets(cdp);
    let target = targets.find((t) => t.type === 'page' && t.url.startsWith(BRIDGE_URL));
    if (!target) {
      const created = (await cdp.send('Target.createTarget', { url: BRIDGE_URL, background: true })) as { targetId: string };
      target = { targetId: created.targetId, type: 'page', title: '', url: BRIDGE_URL, attached: false };
    }
    const { sessionId } = (await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as { sessionId: string };
    const bridge = new PageBridge(cdp, sessionId, target.targetId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.addBinding', { name: BINDING }, sessionId);
    // Nach einem Neuladen des Tabs automatisch wieder installieren.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SCRIPT }, sessionId);
    await bridge.waitForOrigin();
    await bridge.install();
    return bridge;
  }

  /** REST-Aufruf aus dem Tab heraus. Nur Pfade unter /api/ und /media-service/api/ sind erlaubt. */
  async http(method: string, path: string, body?: unknown): Promise<HttpResult> {
    if (!/^\/(api|media-service\/api)\//.test(path)) throw new Error(`Pfad nicht erlaubt: ${path}`);
    return (await this.call('fetch', { method, path, body })) as HttpResult;
  }

  async refreshWafToken(): Promise<boolean> {
    return Boolean(await this.call('wafRefresh'));
  }

  /** WebSocket im Tab öffnen; erfüllt sich, sobald er offen ist. */
  async openSocket(url: string): Promise<FrameTransport> {
    if (!url.startsWith('wss://app.milanote.com/')) throw new Error(`Socket-URL nicht erlaubt: ${url}`);
    const messageListeners: ((data: string) => void)[] = [];
    const closeListeners: ((reason: string) => void)[] = [];
    let id = 0;
    const opened = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket öffnet nicht (Zeitüberschreitung)')), 15_000);
      const listener: SocketListener = {
        onOpen: () => {
          clearTimeout(timer);
          resolve();
        },
        onMessage: (data) => messageListeners.forEach((l) => l(data)),
        onError: () => undefined,
        onClose: (reason) => {
          clearTimeout(timer);
          this.sockets.delete(id);
          reject(new Error(`WebSocket geschlossen (${reason})`));
          closeListeners.forEach((l) => l(reason));
        },
      };
      void this.call('wsOpen', url).then(
        (value) => {
          id = Number(value);
          this.sockets.set(id, listener);
          const buffered = this.early.get(id) ?? [];
          this.early.delete(id);
          for (const msg of buffered) this.dispatch(listener, msg);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
    await opened;
    return {
      send: async (data) => {
        if (!(await this.call('wsSend', id, data))) throw new Error('WebSocket ist nicht offen');
      },
      close: () => void this.call('wsClose', id).catch(() => undefined),
      onMessage: (listener) => messageListeners.push(listener),
      onClose: (listener) => closeListeners.push(listener),
    };
  }

  private async install(): Promise<void> {
    await this.evaluate(PAGE_SCRIPT);
  }

  private async waitForOrigin(): Promise<void> {
    for (let i = 0; i < 50; i += 1) {
      const href = String(await this.evaluate('location.href').catch(() => ''));
      if (isMilanoteUrl(href) && href.startsWith(MILANOTE_ORIGIN)) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Der Brückentab hat app.milanote.com nicht geladen');
  }

  private async call(method: string, ...args: unknown[]): Promise<unknown> {
    const expression = `(async () => { ${PAGE_SCRIPT}; return await window.__mc.${method}(...${JSON.stringify(args)}); })()`;
    return this.evaluate(expression);
  }

  private async evaluate(expression: string): Promise<unknown> {
    const result = (await this.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId, 60_000)) as {
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    };
    if (result.exceptionDetails) {
      throw new Error(`Fehler im Brückentab: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unbekannt'}`);
    }
    return result.result?.value;
  }

  private dispatch(listener: SocketListener, msg: { ev: string; data?: string; code?: number; reason?: string }): void {
    if (msg.ev === 'open') listener.onOpen();
    else if (msg.ev === 'message') listener.onMessage(msg.data ?? '');
    else if (msg.ev === 'error') listener.onError();
    else if (msg.ev === 'close') listener.onClose(`Code ${msg.code}${msg.reason ? `, ${msg.reason}` : ''}`);
  }

  private onEvent({ method, params, sessionId }: CdpEvent): void {
    if (sessionId !== this.sessionId) return;
    if (method === 'Runtime.bindingCalled' && params.name === BINDING) {
      let msg: { ev: string; id: number; data?: string; code?: number; reason?: string };
      try {
        msg = JSON.parse(String(params.payload));
      } catch {
        return;
      }
      const listener = this.sockets.get(msg.id);
      if (listener) this.dispatch(listener, msg);
      else if (this.early.size < 16) this.early.set(msg.id, [...(this.early.get(msg.id) ?? []), msg]);
      return;
    }
    // Tab neu geladen oder geschlossen: offene Sockets sind weg.
    if (method === 'Runtime.executionContextsCleared' || method === 'Inspector.detached') {
      for (const [id, listener] of [...this.sockets]) {
        this.sockets.delete(id);
        listener.onClose('Brückentab neu geladen');
      }
    }
  }
}
