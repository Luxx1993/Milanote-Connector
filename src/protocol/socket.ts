// Socket.IO-v4-Client über einen austauschbaren Frame-Transport.
// Kapselt Handshake, Ping/Pong, Ack-Zuordnung, Zeitlimits, Wiederverbindung und die Reihenfolge der
// Aktionen. Der Transport (im Betrieb: ein WebSocket im Brückentab, siehe session/bridge.ts) reicht nur
// Text-Frames durch.

import { CONNECT, PONG, decode, encodeEvent, type Packet } from './engineio.ts';

export interface FrameTransport {
  send(data: string): Promise<void> | void;
  close(): void;
  onMessage(listener: (data: string) => void): void;
  onClose(listener: (reason: string) => void): void;
}

/** Öffnet eine Verbindung; das Promise erfüllt sich, sobald der Transport offen ist. */
export type TransportFactory = (url: string) => Promise<FrameTransport>;

export type SocketErrorCode = 'connect' | 'timeout' | 'closed';

export class SocketError extends Error {
  constructor(
    message: string,
    readonly code: SocketErrorCode,
  ) {
    super(message);
    this.name = 'SocketError';
  }
}

export interface SocketOptions {
  url: string;
  connectTimeoutMs?: number;
  ackTimeoutMs?: number;
  /** Mindestabstand zwischen zwei gesendeten Aktionen. */
  minIntervalMs?: number;
  maxConnectAttempts?: number;
  backoffMs?: number;
  onEvent?: (name: string, args: unknown[]) => void;
  log?: (message: string) => void;
}

type State = 'idle' | 'connecting' | 'open' | 'closed';
type Pending = { resolve: (args: unknown[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class SocketClient {
  private state: State = 'idle';
  private transport: FrameTransport | undefined;
  private connecting: Promise<void> | undefined;
  private nextAck = 1;
  private readonly pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private lastEmit = 0;
  private watchdog: NodeJS.Timeout | undefined;
  private heartbeatMs = 45_000;
  private readonly opts: Required<Omit<SocketOptions, 'onEvent' | 'log'>> & Pick<SocketOptions, 'onEvent' | 'log'>;

  constructor(
    private readonly factory: TransportFactory,
    options: SocketOptions,
  ) {
    this.opts = {
      connectTimeoutMs: 15_000,
      ackTimeoutMs: 15_000,
      minIntervalMs: 80,
      maxConnectAttempts: 4,
      backoffMs: 500,
      ...options,
    };
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  /** Verbindet (oder verbindet neu) mit exponentiellem Backoff. Mehrfachaufrufe teilen sich einen Versuch. */
  connect(): Promise<void> {
    if (this.state === 'open') return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      let last: unknown;
      for (let attempt = 1; attempt <= this.opts.maxConnectAttempts; attempt += 1) {
        try {
          await this.openOnce();
          if (attempt > 1) this.log(`Socket nach ${attempt} Versuchen verbunden`);
          return;
        } catch (error) {
          last = error;
          this.log(`Socket-Verbindung, Versuch ${attempt}: ${errorMessage(error)}`);
          if (attempt < this.opts.maxConnectAttempts) await sleep(Math.min(this.opts.backoffMs * 2 ** (attempt - 1), 8_000));
        }
      }
      this.state = 'closed';
      throw new SocketError(`Keine Socket-Verbindung zu Milanote nach ${this.opts.maxConnectAttempts} Versuchen: ${errorMessage(last)}`, 'connect');
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  /**
   * Sendet ein Ereignis und wartet auf das Ack. Aufrufe laufen strikt nacheinander, damit Milanote
   * Aktionen in der Reihenfolge sieht, in der sie erzeugt wurden. Eine bei Verbindungsverlust
   * offene Aktion wird nicht automatisch wiederholt (sie könnte schon angekommen sein).
   */
  emit(name: string, payload: unknown): Promise<unknown[]> {
    const run = async (): Promise<unknown[]> => {
      await this.connect();
      const wait = this.lastEmit + this.opts.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      const transport = this.transport;
      if (!transport) throw new SocketError('Socket ist nicht verbunden', 'closed');
      const ackId = this.nextAck++;
      const acked = new Promise<unknown[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(ackId);
          reject(new SocketError(`Milanote hat "${name}" nicht innerhalb von ${this.opts.ackTimeoutMs} ms bestätigt`, 'timeout'));
        }, this.opts.ackTimeoutMs);
        this.pending.set(ackId, { resolve, reject, timer });
      });
      try {
        await transport.send(encodeEvent(name, payload, ackId));
      } catch (error) {
        this.settle(ackId, new SocketError(`Senden fehlgeschlagen: ${errorMessage(error)}`, 'closed'));
      }
      this.lastEmit = Date.now();
      return acked;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  close(): void {
    const transport = this.transport;
    this.transport = undefined;
    this.state = 'idle';
    this.clearWatchdog();
    this.rejectAll(new SocketError('Socket wurde geschlossen', 'closed'));
    transport?.close();
  }

  private async openOnce(): Promise<void> {
    this.state = 'connecting';
    const transport = await this.factory(this.opts.url);
    await new Promise<void>((resolve, reject) => {
      let phase: 'open' | 'connect' | 'ready' = 'open';
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        transport.close();
        reject(new SocketError(message, 'connect'));
      };
      const timer = setTimeout(() => fail('Zeitüberschreitung beim Verbindungsaufbau'), this.opts.connectTimeoutMs);

      transport.onMessage((raw) => {
        const packet = decode(raw);
        if (phase === 'ready') {
          this.handle(transport, packet);
          return;
        }
        if (packet.kind === 'ping') void transport.send(PONG);
        else if (packet.kind === 'open' && phase === 'open') {
          this.heartbeatMs = packet.pingInterval + packet.pingTimeout;
          phase = 'connect';
          void transport.send(CONNECT);
        } else if (packet.kind === 'connect' && phase === 'connect') {
          phase = 'ready';
          settled = true;
          clearTimeout(timer);
          this.transport = transport;
          this.state = 'open';
          this.armWatchdog(transport);
          resolve();
        } else if (packet.kind === 'connect_error') fail(`Milanote lehnt die Socket-Verbindung ab: ${packet.message}`);
      });
      transport.onClose((reason) => {
        if (phase === 'ready') this.lost(transport, reason);
        else fail(`Verbindung geschlossen (${reason})`);
      });
    });
  }

  private handle(transport: FrameTransport, packet: Packet): void {
    switch (packet.kind) {
      case 'ping':
        void transport.send(PONG);
        this.armWatchdog(transport);
        return;
      case 'ack':
        this.settle(packet.ackId, undefined, packet.args);
        return;
      case 'event':
        this.opts.onEvent?.(packet.name, packet.args);
        return;
      case 'disconnect':
      case 'close':
        transport.close();
        this.lost(transport, 'vom Server getrennt');
        return;
      default:
        return;
    }
  }

  private lost(transport: FrameTransport, reason: string): void {
    if (this.transport !== transport) return;
    this.transport = undefined;
    this.state = 'closed';
    this.clearWatchdog();
    this.log(`Socket getrennt: ${reason}`);
    this.rejectAll(new SocketError(`Verbindung zu Milanote während einer Aktion verloren (${reason}). Ob die Aktion angekommen ist, ist unklar.`, 'closed'));
  }

  private armWatchdog(transport: FrameTransport): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      transport.close();
      this.lost(transport, 'kein Ping vom Server');
    }, this.heartbeatMs);
    this.watchdog.unref?.();
  }

  private clearWatchdog(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private settle(ackId: number, error?: Error, args: unknown[] = []): void {
    const pending = this.pending.get(ackId);
    if (!pending) return;
    this.pending.delete(ackId);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(args);
  }

  private rejectAll(error: Error): void {
    for (const id of [...this.pending.keys()]) this.settle(id, error);
  }

  private log(message: string): void {
    this.opts.log?.(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
