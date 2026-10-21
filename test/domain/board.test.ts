import { describe, expect, it } from 'vitest';
import { holderBoard, normalizeBoard, normalizeElement, type RawElement } from '../../src/domain/board.ts';
import { toSearchResult } from '../../src/milanote.ts';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { key: 'k' }, content: [{ type: 'text', text }] }] });
const canvas = (parentId: string, x: number, y: number, score = 1) => ({ parentId, section: 'CANVAS', position: { x, y, score } });
const inbox = (parentId: string, index: number) => ({ parentId, section: 'INBOX', position: { index, score: index * 65536 } });

const ORIGIN = 'https://app.milanote.com';
const elements: Record<string, RawElement> = {
  B: { _id: 'B', elementType: 'BOARD', content: { title: 'Projekt' } },
  n2: { _id: 'n2', elementType: 'CARD', location: canvas('B', 40, 2), content: { textContent: doc('rechts') } },
  n1: { _id: 'n1', elementType: 'CARD', location: canvas('B', 0, 2), content: { textContent: doc('links'), color: 'yellow' } },
  col: { _id: 'col', elementType: 'COLUMN', location: canvas('B', 0, 30), content: { title: 'Ideen', width: 40 } },
  c2: { _id: 'c2', elementType: 'CARD', location: inbox('col', 1), content: { textContent: doc('zweite') } },
  c1: { _id: 'c1', elementType: 'CARD', location: inbox('col', 0), content: { textContent: doc('erste') } },
  sub: { _id: 'sub', elementType: 'BOARD', location: inbox('col', 2), content: { title: 'Unterboard in Spalte' } },
  tl: { _id: 'tl', elementType: 'TASK_LIST', location: canvas('B', 80, 2), content: { title: 'To-do' } },
  t1: { _id: 't1', elementType: 'TASK', location: inbox('tl', 0), content: { textContent: doc('erledigt'), isComplete: true } },
  t2: { _id: 't2', elementType: 'TASK', location: inbox('tl', 1), content: { textContent: doc('offen') } },
  link: { _id: 'link', elementType: 'LINK', location: canvas('B', 120, 2), content: { link: { url: 'https://example.com', title: 'Beispiel' } } },
  img: { _id: 'img', elementType: 'IMAGE', location: canvas('B', 160, 2), content: { image: { original: 'https://media.milanote.com/p/x.png' }, width: 50, height: 30, caption: doc('Foto') } },
  board2: { _id: 'board2', elementType: 'BOARD', location: canvas('B', 0, 60), content: { title: 'Direktes Unterboard' } },
  gone: { _id: 'gone', elementType: 'CARD', location: { parentId: 'B-trash', section: 'TRASH', position: {} }, content: { textContent: doc('weg') } },
};

describe('normalizeBoard', () => {
  const view = normalizeBoard('B', elements, ORIGIN);

  it('liefert Board-Kopf und Unterboards (auch in Spalten)', () => {
    expect(view.board).toEqual({ id: 'B', title: 'Projekt', url: `${ORIGIN}/B` });
    // Fläche vor Listeneinträgen
    expect(view.childBoards).toEqual([
      { id: 'board2', title: 'Direktes Unterboard' },
      { id: 'sub', title: 'Unterboard in Spalte' },
    ]);
    expect(view.truncated).toBe(false);
  });

  it('sortiert die Fläche nach y, dann x, und blendet den Papierkorb aus', () => {
    expect(view.elements.map((e) => e.id)).toEqual(['n1', 'n2', 'tl', 'link', 'img', 'col', 'board2']);
    expect(JSON.stringify(view)).not.toContain('weg');
  });

  it('gibt Typ, Text, Position und Größe aus', () => {
    expect(view.elements[0]).toEqual({ id: 'n1', type: 'CARD', position: { x: 0, y: 2 }, size: { width: 34, height: null, estimated: true }, text: 'links', color: 'yellow' });
    const img = view.elements.find((e) => e.id === 'img');
    expect(img).toMatchObject({ imageUrl: 'https://media.milanote.com/p/x.png', caption: 'Foto', size: { width: 50, height: 30, estimated: false } });
    expect(view.elements.find((e) => e.id === 'link')).toMatchObject({ title: 'Beispiel', url: 'https://example.com' });
  });

  it('hängt Spalten- und Listenkinder in Reihenfolge an', () => {
    const col = view.elements.find((e) => e.id === 'col');
    expect(col?.children?.map((c) => [c.id, c.index])).toEqual([['c1', 0], ['c2', 1], ['sub', 2]]);
    expect(col?.size).toEqual({ width: 40, height: null, estimated: false });
    const tl = view.elements.find((e) => e.id === 'tl');
    expect(tl?.children?.map((t) => [t.text, t.done])).toEqual([['erledigt', true], ['offen', false]]);
  });

  it('zählt Typen und schneidet bei maxElements ab', () => {
    expect(view.counts).toMatchObject({ CARD: 4, TASK: 2, COLUMN: 1, BOARD: 2 });
    const small = normalizeBoard('B', elements, ORIGIN, 3);
    expect(small.truncated).toBe(true);
    expect(small.childBoards).toHaveLength(2);
  });
});

describe('normalizeElement', () => {
  it('kennt Alias und Datei', () => {
    expect(normalizeElement({ _id: 'a', elementType: 'ALIAS', location: canvas('B', 1, 1), content: { linkTo: 'X1' } })).toMatchObject({ linkTo: 'X1', size: { width: null } });
    expect(normalizeElement({ _id: 'f', elementType: 'FILE', location: inbox('col', 0), content: { file: { url: 'https://media.milanote.com/f.pdf' }, title: 'f.pdf' } })).toMatchObject({ index: 0, url: 'https://media.milanote.com/f.pdf', title: 'f.pdf' });
  });
});

describe('holderBoard', () => {
  it('folgt der Elternkette bis zu einem angefragten Board', () => {
    expect(holderBoard(elements.sub!, elements, new Set(['B']))).toBe('B');
    expect(holderBoard(elements.sub!, elements, new Set(['X']))).toBeUndefined();
  });
});

describe('toSearchResult', () => {
  it('bildet die Antwort der Suche ab', () => {
    expect(
      toSearchResult({
        _id: 'B',
        board: { _id: 'B', elementType: 'BOARD', content: { title: 'Projekt' }, meta: { modifiedTime: 5 } },
        ancestors: [{ title: 'Eltern' }, { title: 'Home' }],
        innerHits: [{ _id: 'n1', elementType: 'CARD', content: ['ein [hit]Treffer[/hit]', 'noch einer'] }],
      }),
    ).toEqual({
      boardId: 'B',
      title: 'Projekt',
      path: ['Home', 'Eltern'],
      modifiedTime: 5,
      matches: [{ elementId: 'n1', type: 'CARD', snippet: 'ein **Treffer** … noch einer' }],
    });
  });

  it('übersteht fremde Formen', () => {
    expect(toSearchResult({})).toEqual({ boardId: '', title: null, path: [], modifiedTime: undefined, matches: [] });
  });
});
