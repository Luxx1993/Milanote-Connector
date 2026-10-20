import { describe, expect, it } from 'vitest';
import { decode, encodeEvent } from '../../src/protocol/engineio.ts';

describe('decode', () => {
  it('liest das Open-Paket mit Heartbeat-Werten', () => {
    expect(decode('0{"sid":"abc","pingInterval":25000,"pingTimeout":20000,"maxPayload":"1e7"}')).toEqual({
      kind: 'open',
      sid: 'abc',
      pingInterval: 25000,
      pingTimeout: 20000,
    });
  });

  it('unterscheidet Ping, Pong, Connect und Connect-Fehler', () => {
    expect(decode('2')).toEqual({ kind: 'ping' });
    expect(decode('3')).toEqual({ kind: 'pong' });
    expect(decode('40{"sid":"x"}')).toEqual({ kind: 'connect', sid: 'x' });
    expect(decode('40')).toEqual({ kind: 'connect', sid: undefined });
    expect(decode('44{"message":"not authorized"}')).toEqual({ kind: 'connect_error', message: 'not authorized' });
    expect(decode('41')).toEqual({ kind: 'disconnect' });
  });

  it('liest Ereignisse mit und ohne Ack-ID sowie Acks', () => {
    expect(decode('42["action",{"type":"X","remote":true}]')).toEqual({ kind: 'event', ackId: undefined, name: 'action', args: [{ type: 'X', remote: true }] });
    expect(decode('4217["action",{}]')).toEqual({ kind: 'event', ackId: 17, name: 'action', args: [{}] });
    expect(decode('4317[{"status":200}]')).toEqual({ kind: 'ack', ackId: 17, args: [{ status: 200 }] });
  });

  it('meldet Unbekanntes statt zu werfen', () => {
    expect(decode('42kaputt').kind).toBe('unknown');
    expect(decode('43[{}]').kind).toBe('unknown');
    expect(decode('9').kind).toBe('unknown');
  });
});

describe('encodeEvent', () => {
  it('baut Frames mit Ack-ID', () => {
    expect(encodeEvent('action', { type: 'ELEMENT_CREATE' }, 5)).toBe('425["action",{"type":"ELEMENT_CREATE"}]');
    expect(encodeEvent('update-channels', { joined: [] })).toBe('42["update-channels",{"joined":[]}]');
  });
});
