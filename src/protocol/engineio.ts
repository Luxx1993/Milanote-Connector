// Engine.IO-v4- und Socket.IO-v4-Pakete als reine Funktionen (ohne Netz, einzeln testbar).
// Aufbau siehe docs/protocol.md, Abschnitt 4.5.

export type Packet =
  | { kind: 'open'; sid?: string; pingInterval: number; pingTimeout: number }
  | { kind: 'ping' }
  | { kind: 'pong' }
  | { kind: 'close' }
  | { kind: 'noop' }
  | { kind: 'connect'; sid?: string }
  | { kind: 'disconnect' }
  | { kind: 'connect_error'; message: string }
  | { kind: 'event'; ackId?: number; name: string; args: unknown[] }
  | { kind: 'ack'; ackId: number; args: unknown[] }
  | { kind: 'unknown'; raw: string };

export function decode(raw: string): Packet {
  const type = raw[0];
  switch (type) {
    case '0': {
      const data = parseObject(raw.slice(1));
      return {
        kind: 'open',
        sid: typeof data.sid === 'string' ? data.sid : undefined,
        pingInterval: typeof data.pingInterval === 'number' ? data.pingInterval : 25_000,
        pingTimeout: typeof data.pingTimeout === 'number' ? data.pingTimeout : 20_000,
      };
    }
    case '1':
      return { kind: 'close' };
    case '2':
      return { kind: 'ping' };
    case '3':
      return { kind: 'pong' };
    case '6':
      return { kind: 'noop' };
    case '4':
      return decodeSocketIo(raw);
    default:
      return { kind: 'unknown', raw };
  }
}

function decodeSocketIo(raw: string): Packet {
  const sioType = raw[1];
  const rest = raw.slice(2);
  switch (sioType) {
    case '0': {
      const data = parseObject(rest);
      return { kind: 'connect', sid: typeof data.sid === 'string' ? data.sid : undefined };
    }
    case '1':
      return { kind: 'disconnect' };
    case '4': {
      const data = parseObject(rest);
      return { kind: 'connect_error', message: typeof data.message === 'string' ? data.message : rest.slice(0, 200) };
    }
    case '2':
    case '3': {
      const match = /^(\d*)(\[.*)$/s.exec(rest);
      if (!match) return { kind: 'unknown', raw };
      let args: unknown;
      try {
        args = JSON.parse(match[2] ?? '');
      } catch {
        return { kind: 'unknown', raw };
      }
      if (!Array.isArray(args)) return { kind: 'unknown', raw };
      const ackId = match[1] ? Number(match[1]) : undefined;
      if (sioType === '3') return ackId === undefined ? { kind: 'unknown', raw } : { kind: 'ack', ackId, args };
      const [name, ...rest2] = args;
      return { kind: 'event', ackId, name: String(name), args: rest2 };
    }
    default:
      return { kind: 'unknown', raw };
  }
}

export const PONG = '3';
export const CONNECT = '40';

export function encodeEvent(name: string, payload: unknown, ackId?: number): string {
  return `42${ackId ?? ''}${JSON.stringify([name, payload])}`;
}

function parseObject(text: string): Record<string, unknown> {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
