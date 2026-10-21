import { describe, expect, it } from 'vitest';
import { parseSocketIo, pathTemplate, summarize } from '../../tools/probe/src/summarize.ts';

describe('pathTemplate', () => {
  it('ersetzt Element-, Nutzer- und Trash-IDs', () => {
    expect(pathTemplate('/api/elements/1XbZEqlawr6y03/permissions')).toBe('/api/elements/:id/permissions');
    expect(pathTemplate('/api/users/69e02074e309d50f749bc4f3')).toBe('/api/users/:userId');
    expect(pathTemplate('/media-service/api/preview/1XbZEplawr6y02')).toBe('/media-service/api/preview/:id');
    expect(pathTemplate('/api/elements/attachments/presign')).toBe('/api/elements/attachments/presign');
  });
});

describe('parseSocketIo', () => {
  it('trennt Pakettyp, Ack-ID und JSON', () => {
    expect(parseSocketIo('421["action",{"type":"ELEMENT_CREATE"}]')).toEqual({
      packet: '42',
      ackId: '1',
      payload: ['action', { type: 'ELEMENT_CREATE' }],
    });
    expect(parseSocketIo('42["action",{}]')?.ackId).toBeUndefined();
    expect(parseSocketIo('2')).toBeNull();
  });
});

describe('summarize', () => {
  it('gruppiert Endpunkte und Socket-Aktionen je Markierung', () => {
    const lines = [
      { t: 0, kind: 'marker', text: 'Bild hochladen' },
      { t: 10, kind: 'http.request', id: 's:1', method: 'POST', url: 'https://app.milanote.com/api/elements/attachments/presign', body: { data: '{"filename":"a.png","fileType":"image"}' } },
      { t: 20, kind: 'http.response', id: 's:1', status: 200 },
      { t: 30, kind: 'http.done', id: 's:1', body: { data: '{"presignedUrl":"https://x"}' } },
      { t: 40, kind: 'ws.frame', id: 's:9', direction: 'out', data: '425["action",{"type":"ELEMENT_CREATE","id":"1X","elementType":"IMAGE"}]' },
      { t: 50, kind: 'ws.frame', id: 's:9', direction: 'in', data: '435[{"status":200}]' },
      { t: 60, kind: 'download.begin', url: 'https://app.milanote.com/x.pdf', filename: 'board.pdf' },
    ].map((r) => JSON.stringify(r));
    const md = summarize(lines);
    expect(md).toContain('| `POST app.milanote.com/api/elements/attachments/presign` | 1 | 200 |  | filename, fileType | presignedUrl | Bild hochladen |');
    expect(md).toContain('| `action:ELEMENT_CREATE` | 1 | 0 | type, id, elementType | Bild hochladen |');
    expect(md).toContain('| `(ack)` | 0 | 1 | status | Bild hochladen |');
    expect(md).toContain('board.pdf');
  });
});
