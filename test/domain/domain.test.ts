import { describe, expect, it } from 'vitest';
import { docToText, textToDoc } from '../../src/domain/richtext.ts';
import { CARD_WIDTH, GAP, SCORE_STEP, nextCanvasPosition } from '../../src/domain/placement.ts';
import { canvasChildrenOf } from '../../src/domain/hierarchy.ts';
import { parseBoardRef } from '../../src/milanote.ts';

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

describe('Markdown gemäß Milanotes Textformaten', () => {
  const nodeTypes = (md: string) => (textToDoc(md, key).content ?? []).map((n) => [n.type, n.attrs?.level ?? null]);

  it('kennt nur zwei Überschriftsebenen: ### wird wie ## behandelt', () => {
    expect(nodeTypes('# a\n\n## b\n\n### c\n\n#### d')).toEqual([['heading', 1], ['heading', 2], ['heading', 2], ['paragraph', null]]);
  });

  it('wandelt Codeblöcke um und behält Leerzeilen und Einrückung darin', () => {
    const doc = textToDoc('Vorher\n\n```ts\nconst a = 1;\n\n  if (a) {}\n```\nNachher', key);
    expect(doc.content?.map((n) => n.type)).toEqual(['paragraph', 'codeBlock', 'paragraph']);
    const code = doc.content?.[1];
    expect(code?.attrs).toMatchObject({ language: 'ts' });
    expect(code?.content).toEqual([{ type: 'text', text: 'const a = 1;\n\n  if (a) {}' }]);
    expect(docToText(doc)).toBe('Vorher\n\n```ts\nconst a = 1;\n\n  if (a) {}\n```\n\nNachher');
  });

  it('schließt einen offenen Codeblock am Textende und lässt leere zu', () => {
    expect(nodeTypes('```\nohne Ende')).toEqual([['codeBlock', null]]);
    expect(textToDoc('```\n```', key).content?.[0]).toMatchObject({ type: 'codeBlock', attrs: { language: null } });
  });

  it('erzeugt die belegten Elemente: Trennlinie, Inline-Code, Durchgestrichenes, Aufgaben, Zitat', () => {
    const doc = textToDoc('---\n\n`x` und ~~y~~\n\n- [x] erledigt\n\n> Zitat', key);
    expect(doc.content?.map((n) => n.type)).toEqual(['horizontalRule', 'paragraph', 'taskList', 'blockquote']);
    expect(doc.content?.[1]?.content?.map((n) => n.marks?.[0]?.type)).toEqual(['code', undefined, 'strike']);
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

describe('canvasChildrenOf', () => {
  it('nimmt nur direkte Kinder auf der Fläche', () => {
    const children = canvasChildrenOf(
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
