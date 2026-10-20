import { describe, expect, it } from 'vitest';
import { docToText, textToDoc } from '../../src/domain/richtext.ts';
import { CARD_WIDTH, GAP, SCORE_STEP, nextCanvasPosition } from '../../src/domain/placement.ts';
import { canvasChildren, parseBoardRef } from '../../src/milanote.ts';

const key = () => 'k1234';

describe('textToDoc', () => {
  it('macht aus Leerzeilen Absätze und aus Zeilenumbrüchen hardBreaks', () => {
    expect(textToDoc('Erste Zeile\nzweite Zeile\n\nNeuer Absatz', key)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { key: 'k1234', textAlign: 'left' },
          content: [{ type: 'text', text: 'Erste Zeile' }, { type: 'hardBreak' }, { type: 'text', text: 'zweite Zeile' }],
        },
        { type: 'paragraph', attrs: { key: 'k1234', textAlign: 'left' }, content: [{ type: 'text', text: 'Neuer Absatz' }] },
      ],
    });
  });

  it('übersteht Hin- und Rückweg', () => {
    const text = 'Hallo\nWelt\n\nZweiter Absatz';
    expect(docToText(textToDoc(text, key))).toBe(text);
    expect(docToText(textToDoc('a\r\n\r\n\r\nb', key))).toBe('a\n\nb');
  });
});

describe('nextCanvasPosition', () => {
  it('setzt auf leere Boards oben links', () => {
    expect(nextCanvasPosition([])).toEqual({ x: 0, y: 2, score: SCORE_STEP });
  });

  it('setzt rechts neben den vorhandenen Inhalt, Z-Reihenfolge darüber', () => {
    const pos = nextCanvasPosition([
      { x: 0, y: 4, score: 65536 },
      { x: 40, y: 10, score: 196608, width: 50 },
    ]);
    expect(pos).toEqual({ x: 90 + GAP, y: 4, score: 196608 + SCORE_STEP });
  });

  it('nimmt gewünschte Koordinaten (gerundet)', () => {
    expect(nextCanvasPosition([{ x: 0, y: 0, score: 10 }], { x: 12.4, y: 7.6 })).toEqual({ x: 12, y: 8, score: 10 + SCORE_STEP });
  });

  it('nutzt die Standardbreite, wenn keine Breite bekannt ist', () => {
    expect(nextCanvasPosition([{ x: 10, y: 0, score: 0 }]).x).toBe(10 + CARD_WIDTH + GAP);
  });
});

describe('canvasChildren', () => {
  it('nimmt nur direkte Kinder auf der Fläche', () => {
    const children = canvasChildren(
      {
        B: { _id: 'B', elementType: 'BOARD' },
        a: { _id: 'a', elementType: 'CARD', location: { parentId: 'B', section: 'CANVAS', position: { x: 1, y: 2, score: 3 } } },
        b: { _id: 'b', elementType: 'CARD', location: { parentId: 'col', section: 'INBOX', position: { index: 0, score: 0 } } },
        c: { _id: 'c', elementType: 'CARD', location: { parentId: 'B-trash', section: 'TRASH' } },
        d: { _id: 'd', elementType: 'COLUMN', location: { parentId: 'B', section: 'CANVAS', position: { x: 50, y: 2, score: 9 } }, content: { width: 40 } },
      },
      'B',
    );
    expect(children).toEqual([
      { x: 1, y: 2, score: 3, width: undefined },
      { x: 50, y: 2, score: 9, width: 40 },
    ]);
  });
});

describe('parseBoardRef', () => {
  it('akzeptiert IDs und Milanote-URLs', () => {
    expect(parseBoardRef('1XbZEplawr6y02')).toBe('1XbZEplawr6y02');
    expect(parseBoardRef('https://app.milanote.com/1XbZEplawr6y02/mein-board?p=x')).toBe('1XbZEplawr6y02');
  });

  it('lehnt Fremdes ab', () => {
    expect(() => parseBoardRef('https://example.com/1XbZEplawr6y02')).toThrow(/Keine Milanote-URL/);
    expect(() => parseBoardRef('abc')).toThrow(/Ungültige Board-ID/);
  });
});
