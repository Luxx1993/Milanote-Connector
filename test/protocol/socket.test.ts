import { describe, expect, it } from 'vitest';
import { SocketClient, SocketError, type FrameTransport } from '../../src/protocol/socket.ts';

/** Fake-Server: antwortet wie Milanote auf Handshake, Pings und Aktionen. */
class FakeTransport implements FrameTransport {
  sent: string[] = [];
  closed = false;
  private messageListeners: ((data: string) => void)[] = [];
  private closeListeners: ((reason: string) => void)[] = [];

  constructor(private readonly behaviour: { ack?: 'ok' | 'never' | 'reject'; connect?: 'ok' | 'error' | 'silent' } = {}) {
    queueMicrotask(() => this.serverSend('0{"sid":"s","pingInterval":25000,"pingTimeout":20000}'));
  }

  send(data: string): void {
    this.sent.push(data);
    if (data === '40') {
      if (this.behaviour.connect === 'error') this.serverSend('44{"message":"nope"}');
      else if (this.behaviour.connect !== 'silent') this.serverSend('40{"sid":"c"}');
      return;
    }
    const match = /^42(\d+)/.exec(data);
    if (match && this.behaviour.ack !== 'never') {
      const status = this.behaviour.ack === 'reject' ? 403 : 200;
      this.serverSend(`43${match[1]}[{"status":${status}}]`);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListeners.forEach((l) => l('client'));
  }

  onMessage(listener: (data: string) => void): void {
    this.messageListeners.push(listener);
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListeners.push(listener);
  }

  serverSend(data: string): void {
    queueMicrotask(() => this.messageListeners.forEach((l) => l(data)));
  }

  serverClose(): void {
    this.closed = true;
    this.closeListeners.forEach((l) => l('server'));
  }
}

function setup(behaviour: ConstructorParameters<typeof FakeTransport>[0] = {}, extra: Partial<ConstructorParameters<typeof SocketClient>[1]> = {}) {
  const transports: FakeTransport[] = [];
  const client = new SocketClient(
    async () => {
      const t = new FakeTransport(behaviour);
      transports.push(t);
      return t;
    },
    { url: 'wss://app.milanote.com/socket.io/', ackTimeoutMs: 100, connectTimeoutMs: 100, minIntervalMs: 0, backoffMs: 1, maxConnectAttempts: 2, ...extra },
  );
  return { client, transports };
}

describe('SocketClient', () => {
  it('macht den Handshake und ordnet Acks zu', async () => {
    const { client, transports } = setup();
    const ack = await client.emit('action', { type: 'ELEMENT_CREATE' });
    expect(ack).toEqual([{ status: 200 }]);
    expect(transports[0]?.sent).toEqual(['40', '421["action",{"type":"ELEMENT_CREATE"}]']);
    expect(client.isOpen).toBe(true);
    client.close();
  });

  it('beantwortet Pings mit Pong', async () => {
    const { client, transports } = setup();
    await client.connect();
    transports[0]?.serverSend('2');
    await new Promise((r) => setTimeout(r, 0));
    expect(transports[0]?.sent).toContain('3');
    client.close();
  });

  it('sendet nacheinander, auch bei parallelen Aufrufen', async () => {
    const { client, transports } = setup();
    const results = await Promise.all([client.emit('action', { n: 1 }), client.emit('action', { n: 2 }), client.emit('action', { n: 3 })]);
    expect(results).toHaveLength(3);
    expect(transports[0]?.sent.slice(1)).toEqual(['421["action",{"n":1}]', '422["action",{"n":2}]', '423["action",{"n":3}]']);
    client.close();
  });

  it('meldet fehlende Bestätigung als Zeitüberschreitung', async () => {
    const { client } = setup({ ack: 'never' });
    await expect(client.emit('action', {})).rejects.toMatchObject({ code: 'timeout' });
    client.close();
  });

  it('gibt nach abgelehntem Connect mit verständlicher Meldung auf', async () => {
    const { client, transports } = setup({ connect: 'error' });
    const error = await client.connect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocketError);
    expect((error as SocketError).message).toContain('nach 2 Versuchen');
    expect((error as SocketError).message).toContain('nope');
    expect(transports).toHaveLength(2);
  });

  it('bricht hängende Handshakes per Zeitlimit ab', async () => {
    const { client } = setup({ connect: 'silent' }, { maxConnectAttempts: 1 });
    await expect(client.connect()).rejects.toMatchObject({ code: 'connect' });
  });

  it('verwirft offene Aktionen bei Verbindungsverlust und verbindet beim nächsten Aufruf neu', async () => {
    const { client, transports } = setup({ ack: 'never' }, { ackTimeoutMs: 5_000 });
    const pending = client.emit('action', { n: 1 });
    await new Promise((r) => setTimeout(r, 5));
    transports[0]?.serverClose();
    await expect(pending).rejects.toMatchObject({ code: 'closed' });
    expect(client.isOpen).toBe(false);

    const second = client.emit('action', { n: 2 });
    await new Promise((r) => setTimeout(r, 5));
    expect(transports).toHaveLength(2);
    expect(transports[1]?.sent).toEqual(['40', '422["action",{"n":2}]']);
    client.close();
    await expect(second).rejects.toMatchObject({ code: 'closed' });
  });

  it('reicht Server-Ereignisse weiter', async () => {
    const events: unknown[] = [];
    const { client, transports } = setup({}, { onEvent: (name, args) => events.push([name, args]) });
    await client.connect();
    transports[0]?.serverSend('42["action",{"type":"ELEMENT_UPDATE","remote":true}]');
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([['action', [{ type: 'ELEMENT_UPDATE', remote: true }]]]);
    client.close();
  });
});
