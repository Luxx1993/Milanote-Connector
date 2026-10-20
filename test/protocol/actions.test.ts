import { describe, expect, it } from 'vitest';
import { IdGenerator, base62 } from '../../src/protocol/ids.ts';
import { ackStatus, elementCreate } from '../../src/protocol/actions.ts';

const NOW = 1_790_795_254_321;

describe('IdGenerator', () => {
  it('erzeugt 14-stellige Element-IDs nach dem Muster Zeit + clientId + Tick', () => {
    const ids = new IdGenerator(() => NOW);
    const first = ids.elementId();
    const second = ids.elementId();
    expect(first).toHaveLength(14);
    expect(first.slice(0, 6)).toBe(base62(Math.floor(NOW / 1000)));
    expect(first.slice(6, 12)).toBe(ids.clientId);
    expect(first.slice(12)).toBe('02');
    expect(second.slice(12)).toBe('03');
    expect(ids.clientTick).toBe(3);
  });

  it('bildet Sitzungs-, Geräte- und Versions-IDs', () => {
    const ids = new IdGenerator(() => NOW);
    expect(ids.sessionId).toMatch(/^msid-[0-9A-Za-z]{10}$/);
    expect(ids.deviceId).toMatch(/^mdid-[0-9A-Za-z]{10}$/);
    expect(ids.createVersionId()).toBe(`${ids.sessionId.slice(5)}-1`);
    expect(ids.nextVersionId()).toBe(`${ids.sessionId.slice(5)}-1`);
    expect(ids.nextVersionId()).toBe(`${ids.sessionId.slice(5)}-2`);
    expect(ids.blockKey()).toMatch(/^[0-9A-Za-z]{5}$/);
  });

  it('base62 wie die Web-App', () => {
    expect(base62(0)).toBe('0');
    expect(base62(61)).toBe('Z');
    expect(base62(62)).toBe('10');
  });
});

describe('elementCreate', () => {
  it('entspricht der dokumentierten Form', () => {
    const ids = new IdGenerator(() => NOW);
    const id = ids.elementId();
    const action = elementCreate(
      { userId: 'u1', ids, platform: 'Milanote-Connector', now: () => NOW },
      { id, elementType: 'CARD', boardId: 'B1', location: { parentId: 'B1', section: 'CANVAS', position: { x: 4, y: 2, score: 65536 } }, content: { textContent: null } },
    );
    expect(action).toMatchObject({
      type: 'ELEMENT_CREATE',
      sync: true,
      timestamp: NOW,
      user: { _id: 'u1', clientId: ids.clientId, clientTick: 2 },
      tokens: [],
      deviceId: ids.deviceId,
      sessionId: ids.sessionId,
      id,
      elementType: 'CARD',
      location: { parentId: 'B1', section: 'CANVAS', position: { x: 4, y: 2, score: 65536 } },
      meta: { creator: 'u1', modifiedBy: 'u1', createdTime: NOW, platform: 'Milanote-Connector', versionId: `${ids.sessionId.slice(5)}-1` },
      creationSource: 'TOOLBAR',
      markAsFetched: true,
      activity: { track: false, boardId: 'B1' },
      channels: ['B1'],
    });
  });

  it('markiert neue Boards nicht als geladen', () => {
    const ids = new IdGenerator(() => NOW);
    const action = elementCreate(
      { userId: 'u1', ids, platform: 'x', now: () => NOW },
      { id: ids.elementId(), elementType: 'BOARD', boardId: 'B1', location: { parentId: 'B1', section: 'CANVAS', position: { x: 0, y: 0, score: 1 } }, content: {} },
    );
    expect(action.markAsFetched).toBe(false);
  });
});

describe('ackStatus', () => {
  it('liest den Status aus dem Ack', () => {
    expect(ackStatus([{ status: 200 }])).toBe(200);
    expect(ackStatus([{ status: 403, error: 'x' }])).toBe(403);
    expect(ackStatus([])).toBeUndefined();
    expect(ackStatus(['ok'])).toBeUndefined();
  });
});
