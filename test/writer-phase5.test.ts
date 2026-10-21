import { beforeEach, describe, expect, it } from 'vitest';
import { Writer } from '../src/writer.ts';
import { docToText } from '../src/domain/richtext.ts';
import { MilanoteError } from '../src/errors.ts';
import { planCompose } from '../src/layout/compose.ts';
import { DEFAULT_METRICS } from '../src/layout/metrics.ts';
import { BOARD, COL, FakeBackend, HOME, USER } from './helpers/fake-backend.ts';

let be: FakeBackend;
let sleeps: number[];

function writer(options: ConstructorParameters<typeof Writer>[1] = {}): Writer {
  return new Writer(be, { boardSettleMs: 1_500, verifyDelayMs: 1, sleep: async (ms) => void sleeps.push(ms), ...options });
}

const types = () => be.actions.map((a) => a.type);
const NOTE = 'EXISTINGNOTE1';
const SUB = 'SUBBOARD00001';

beforeEach(() => {
  be = new FakeBackend();
  sleeps = [];
});

describe('moveElement', () => {
  it('verschiebt auf dem Board an x/y, nach oben in der Z-Reihenfolge', async () => {
    const result = await writer().moveElement({ element: NOTE, x: 200, y: 50 });
    expect(result).toMatchObject({ id: NOTE, type: 'CARD', persisted: true, boardId: BOARD, from: { parentId: BOARD, section: 'CANVAS', x: 0, y: 4 }, to: { parentId: BOARD, section: 'CANVAS', x: 200, y: 50 } });
    const action = be.actions[0]!;
    expect(action).toMatchObject({ type: 'ELEMENT_MOVE_MULTI', moveOperation: 'DROP', channels: [BOARD] });
    const move = (action.moves as { location: { position: { score: number } }; from: unknown }[])[0]!;
    expect(move.location.position.score).toBeGreaterThan(600);
    expect(move.from).toEqual({ parentId: BOARD, section: 'CANVAS', position: { x: 0, y: 4, score: 100 } });
    expect(be.elements[NOTE]!.location?.position).toMatchObject({ x: 200, y: 50 });
  });

  it('verlangt x und y, wenn das Element auf demselben Board bleibt', async () => {
    await expect(writer().moveElement({ element: NOTE })).rejects.toThrow(/x und y an/);
    await expect(writer().moveElement({ element: NOTE, x: 5 })).rejects.toThrow(/nur zusammen/);
  });

  it('verschiebt auf ein anderes Board, automatisch rechts neben den Inhalt', async () => {
    const result = await writer().moveElement({ element: NOTE, parent: SUB });
    expect(result).toMatchObject({ persisted: true, boardId: SUB, to: { parentId: SUB, section: 'CANVAS', x: 88, y: 0 } });
    expect(be.actions[0]).toMatchObject({ moveOperation: 'DROP', channels: [BOARD, SUB] });
  });

  it('legt in Spalten und Listen ans Ende und kennt dort keine Koordinaten', async () => {
    const intoColumn = await writer().moveElement({ element: NOTE, parent: COL });
    expect(intoColumn.to).toEqual({ parentId: COL, section: 'INBOX', index: 1 });
    const task = await writer().moveElement({ element: 'TASKONE000001', parent: 'TASKLIST00002' });
    expect(task.to).toEqual({ parentId: 'TASKLIST00002', section: 'INBOX', index: 0 });
    await expect(writer().moveElement({ element: 'SUBNOTE000001', parent: COL, x: 1, y: 1 })).rejects.toThrow(/keine x\/y/);
  });

  it('holt Elemente aus Spalten nur mit Ziel zurück auf die Fläche', async () => {
    await expect(writer().moveElement({ element: 'INCOLUMNNOTE1', x: 1, y: 1 })).rejects.toThrow(/Gib ein Ziel an/);
    const back = await writer().moveElement({ element: 'INCOLUMNNOTE1', parent: BOARD, x: 300, y: 10 });
    expect(back.to).toEqual({ parentId: BOARD, section: 'CANVAS', x: 300, y: 10 });
  });

  it('hält die Regeln für Ziele ein', async () => {
    await expect(writer().moveElement({ element: COL, parent: COL })).rejects.toThrow(/in sich selbst/);
    await expect(writer().moveElement({ element: SUB, parent: 'SUBNOTE000001' })).rejects.toThrow(/nur auf ein Board, in eine Spalte/);
    await expect(writer().moveElement({ element: 'TASKONE000001', parent: BOARD, x: 1, y: 1 })).rejects.toThrow(/Aufgaben/);
    await expect(writer().moveElement({ element: NOTE, parent: 'TASKLIST00001' })).rejects.toThrow(/nur Aufgaben/);
    await expect(writer().moveElement({ element: COL, parent: 'TASKLIST00001' })).rejects.toThrow(/nur Aufgaben/);
    await expect(writer().moveElement({ element: SUB, parent: COL })).rejects.toThrow(/Boards können nur auf ein anderes Board/);
    await expect(writer().moveElement({ element: SUB, parent: 'NESTEDBOARD01', x: 1, y: 1 })).rejects.toThrow(/Nachfahren/);
    await expect(writer().moveElement({ element: BOARD, parent: SUB, x: 1, y: 1 })).rejects.toThrow(/Home-Board ist gesperrt/);
    expect(be.actions).toEqual([]);
    await expect(writer().moveElement({ element: COL, parent: SUB, x: 1, y: 1 })).resolves.toBeDefined();
    expect(types().filter((t) => t === 'ELEMENT_MOVE_MULTI')).toHaveLength(1);
  });

  it('sperrt Home und Wurzel-Boards und lehnt Unbekanntes ab', async () => {
    await expect(writer().moveElement({ element: HOME, x: 1, y: 1 })).rejects.toThrow(/Wurzel-Board/);
    await expect(writer().moveElement({ element: 'HOMENOTEHOME1', x: 1, y: 1 })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().moveElement({ element: NOTE, parent: HOME })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().moveElement({ element: 'DOESNOTEXIST01', x: 1, y: 1 })).rejects.toMatchObject({ code: 'not_found' });
    expect(be.actions).toEqual([]);
  });

  it('sendet nichts, wenn das Element schon dort liegt', async () => {
    const result = await writer().moveElement({ element: NOTE, x: 0, y: 4 });
    expect(result.persisted).toBe(true);
    expect(result.warnings.join()).toMatch(/liegt schon dort/);
    expect(be.actions).toEqual([]);
  });

  it('warnt bei vermutlicher Überlappung, ohne zu blockieren', async () => {
    const result = await writer().moveElement({ element: NOTE, x: 2, y: 32 });
    expect(result.persisted).toBe(true);
    expect(result.warnings[0]).toMatch(new RegExp(`überlappt.*${COL}`));
    const clear = await writer().moveElement({ element: NOTE, x: 500, y: 500 });
    expect(clear.warnings).toEqual([]);
  });

  it('meldet verworfene und unbestätigte Verschiebungen', async () => {
    be.mode = 'drop';
    const dropped = await writer().moveElement({ element: NOTE, x: 9, y: 9 });
    expect(dropped.persisted).toBe(false);
    expect(dropped.warnings.join()).toMatch(/bestätigt.*nicht zu sehen/);
    be.mode = 'noack-lose';
    await expect(writer().moveElement({ element: NOTE, x: 10, y: 10 })).rejects.toMatchObject({ code: 'connection' });
    be.mode = 'noack-store';
    const late = await writer().moveElement({ element: NOTE, x: 11, y: 11 });
    expect(late.persisted).toBe(true);
    expect(late.warnings.join()).toMatch(/Keine Bestätigung/);
  });

  it('verschiebt Spalten samt Inhalt als ein Element', async () => {
    await writer().moveElement({ element: COL, parent: SUB, x: 0, y: 40 });
    expect((be.actions[0]!.moves as unknown[]).length).toBe(1);
    expect(be.elements.INCOLUMNNOTE1!.location?.parentId).toBe(COL);
  });
});

describe('updateElement', () => {
  it('ändert Notiztext mit Markdown und der bisherigen Version', async () => {
    const result = await writer().updateElement({ element: NOTE, text: '## Neu\n\n- a\n- b' });
    expect(result).toMatchObject({ id: NOTE, type: 'CARD', updated: ['text'], persisted: true, warnings: [] });
    const update = (be.actions[0]!.updates as { id: string; changes: { textContent: unknown }; meta: { modifiedVersionId: string; versionId: string } }[])[0]!;
    expect(update.id).toBe(NOTE);
    expect(docToText(update.changes.textContent)).toBe('## Neu\n\n- a\n- b');
    expect(update.meta.modifiedVersionId).toBe('abc-1');
    expect(update.meta.versionId).not.toBe('abc-1');
    expect(be.actions[0]).toMatchObject({ type: 'ELEMENT_UPDATE', channels: [BOARD, NOTE] });
  });

  it('kennt je Typ die passenden Felder', async () => {
    await writer().updateElement({ element: 'TASKONE000001', done: true, text: 'Erledigt' });
    expect(be.elements.TASKONE000001!.content).toMatchObject({ isComplete: true });
    await writer().updateElement({ element: COL, title: 'Neue Spalte' });
    expect(be.elements[COL]!.content).toMatchObject({ title: 'Neue Spalte' });
    await writer().updateElement({ element: SUB, title: 'Umbenannt' });
    expect(be.elements[SUB]!.content).toMatchObject({ title: 'Umbenannt' });
    await writer().updateElement({ element: 'TASKLIST00001', title: '' });
    expect(be.elements.TASKLIST00001!.content).toMatchObject({ title: null, showTitle: false });
    await writer().updateElement({ element: 'TASKLIST00002', title: 'Mit Titel' });
    expect(be.elements.TASKLIST00002!.content).toMatchObject({ title: 'Mit Titel', showTitle: true });
  });

  it('setzt und entfernt Beschriftungen', async () => {
    await writer().updateElement({ element: 'LINKONE000001', caption: 'Notiz zum Link' });
    expect(be.elements.LINKONE000001!.content).toMatchObject({ showCaption: true });
    expect(docToText(be.elements.LINKONE000001!.content?.caption)).toBe('Notiz zum Link');
    const cleared = await writer().updateElement({ element: 'LINKONE000001', caption: '' });
    expect(cleared.persisted).toBe(true);
    expect(be.elements.LINKONE000001!.content).toMatchObject({ caption: null, showCaption: false });
  });

  it('lehnt Unpassendes ab, bevor etwas gesendet wird', async () => {
    await expect(writer().updateElement({ element: NOTE })).rejects.toThrow(/Nichts zu ändern/);
    await expect(writer().updateElement({ element: NOTE, done: true })).rejects.toThrow(/CARD kennt "done" nicht; möglich sind: text/);
    await expect(writer().updateElement({ element: COL, text: 'x' })).rejects.toThrow(/COLUMN kennt "text"/);
    await expect(writer().updateElement({ element: COL, title: '  ' })).rejects.toMatchObject({ code: 'args' });
    await expect(writer().updateElement({ element: NOTE, text: ' ' })).rejects.toMatchObject({ code: 'args' });
    await expect(writer().updateElement({ element: 'HOMENOTEHOME1', text: 'x' })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().updateElement({ element: HOME, title: 'x' })).rejects.toThrow(/Wurzel-Board/);
    await expect(writer().updateElement({ element: 'DOESNOTEXIST01', text: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect(be.actions).toEqual([]);
  });

  it('verweigert Elemente im Papierkorb', async () => {
    await writer().trash({ elements: [NOTE] });
    await expect(writer().updateElement({ element: NOTE, text: 'x' })).rejects.toThrow(/Papierkorb/);
  });

  it('meldet Änderungen, die Milanote bestätigt, aber nicht übernimmt', async () => {
    be.updates = 'ignore';
    const result = await writer().updateElement({ element: NOTE, text: 'wird ignoriert' });
    expect(result.persisted).toBe(false);
    expect(result.warnings[0]).toMatch(/nicht zu sehen/);
  });

  it('fängt fehlende Bestätigung ab', async () => {
    be.mode = 'noack-lose';
    await expect(writer().updateElement({ element: NOTE, text: 'x' })).rejects.toMatchObject({ code: 'connection' });
  });
});

describe('resizeElement', () => {
  it('setzt die Breite und gleicht ab', async () => {
    const result = await writer().resizeElement({ element: COL, width: 60 });
    expect(result).toMatchObject({ id: COL, type: 'COLUMN', width: 60, persisted: true });
    expect(be.actions[0]).toMatchObject({ type: 'ELEMENT_UPDATE', updates: [{ id: COL, changes: { width: 60 } }] });
  });

  it('prüft Typ und Bereich', async () => {
    await expect(writer().resizeElement({ element: SUB, width: 50 })).rejects.toThrow(/BOARD lässt sich nicht ändern/);
    await expect(writer().resizeElement({ element: 'TASKONE000001', width: 50 })).rejects.toThrow(/TASK lässt sich nicht ändern/);
    await expect(writer().resizeElement({ element: COL, width: 5 })).rejects.toThrow(/zwischen 10 und 400/);
    await expect(writer().resizeElement({ element: COL, width: Number.NaN })).rejects.toThrow(/zwischen 10 und 400/);
    expect(be.actions).toEqual([]);
  });

  it('meldet, wenn Milanote den Wert nicht übernimmt', async () => {
    be.updates = 'ignore';
    expect((await writer().resizeElement({ element: COL, width: 60 })).persisted).toBe(false);
  });
});

const SPEC = {
  layout: 'columns' as const,
  groups: [
    { title: 'Ideen', items: ['Erste Idee', '**Zweite** Idee', { type: 'link' as const, url: 'https://example.com/x', caption: 'Mehr' }] },
    { title: 'Aufgaben', items: [{ type: 'todo' as const, title: 'Heute', tasks: ['eins', { text: 'zwei', done: true }] }, 'Notiz'] },
  ],
};

describe('composeBoard', () => {
  it('legt Spalten samt Inhalt an, rechts neben dem vorhandenen Inhalt', async () => {
    const plan = planCompose(SPEC, DEFAULT_METRICS);
    const result = await writer().composeBoard({ parent: BOARD, spec: SPEC });
    expect(result).toMatchObject({ boardId: BOARD, layout: 'columns', count: plan.count, persisted: true, warnings: [] });
    expect(result.origin).toEqual({ x: 154, y: 0 });
    expect(result.created).toHaveLength(plan.count);
    expect(result.groups).toEqual([{ index: 0, title: 'Ideen', elements: 4 }, { index: 1, title: 'Aufgaben', elements: 5 }]);

    const creates = be.actions.filter((a) => a.type === 'ELEMENT_CREATE');
    expect(creates).toHaveLength(plan.count);
    const columns = creates.filter((a) => a.elementType === 'COLUMN');
    expect(columns).toHaveLength(2);
    // Spalten stehen auf der Fläche an Ursprung + relativer Position
    const firstColumn = plan.steps.find((s) => s.key === 'g0')!.rel!;
    expect(columns[0]!.location).toMatchObject({ parentId: BOARD, section: 'CANVAS', position: { x: 154 + firstColumn.x, y: 0 + firstColumn.y } });
    // Kinder hängen in ihren Spalten bzw. Listen, in Reihenfolge
    const colId = result.created.find((c) => c.key === 'g0')!.id;
    const kids = creates.filter((a) => (a.location as { parentId: string }).parentId === colId);
    expect(kids.map((k) => k.elementType)).toEqual(['CARD', 'CARD', 'LINK']);
    expect(kids.map((k) => (k.location as { position: { index: number } }).position.index)).toEqual([0, 1, 2]);
    const listId = result.created.find((c) => c.key === 'g1.i0')!.id;
    const tasks = creates.filter((a) => (a.location as { parentId: string }).parentId === listId);
    expect(tasks.map((t) => t.elementType)).toEqual(['TASK', 'TASK']);
    expect(tasks[1]!.content).toMatchObject({ isComplete: true });
    // Link bekommt seine Vorschau
    expect(types().filter((t) => t === 'ELEMENT_SET_TYPE')).toHaveLength(1);
    expect(be.posts).toHaveLength(1);
  });

  it('legt mit title zuerst ein Unterboard an, wartet und schreibt dann hinein', async () => {
    const result = await writer().composeBoard({ parent: BOARD, title: 'Mein Projekt', spec: SPEC });
    expect(result.newBoard).toMatchObject({ title: 'Mein Projekt' });
    expect(result.persisted).toBe(true);
    expect(result.boardId).toBe(result.newBoard!.id);
    expect(result.origin).toEqual({ x: 4, y: 4 });
    expect(be.actions[0]).toMatchObject({ elementType: 'BOARD', markAsFetched: false, content: { title: 'Mein Projekt' } });
    expect(sleeps).toContain(1_500);
    const firstChild = be.actions[1]!;
    expect((firstChild.location as { parentId: string }).parentId).toBe(result.newBoard!.id);
    expect(firstChild.channels).toEqual([result.newBoard!.id]);
  });

  it('nimmt x und y als Ursprung', async () => {
    const result = await writer().composeBoard({ parent: BOARD, spec: SPEC, x: 400, y: 100 });
    expect(result.origin).toEqual({ x: 400, y: 100 });
    await expect(writer().composeBoard({ parent: BOARD, spec: SPEC, x: 4 })).rejects.toThrow(/nur zusammen/);
  });

  it.each(['grid', 'masonry', 'timeline', 'radial'] as const)('legt das Layout %s an', async (layout) => {
    const spec = { layout, center: 'Thema', groups: SPEC.groups };
    const result = await writer().composeBoard({ parent: BOARD, spec });
    expect(result.persisted).toBe(true);
    const creates = be.actions.filter((a) => a.type === 'ELEMENT_CREATE');
    expect(creates).toHaveLength(result.count);
    // auf der Fläche liegen keine Spalten, nur Karten, Links und Listen
    expect(creates.some((a) => a.elementType === 'COLUMN')).toBe(false);
    expect(creates.some((a) => a.elementType === 'CARD' && JSON.stringify(a.content).includes('Ideen'))).toBe(true);
  });

  it('prüft den Auftrag, bevor etwas gesendet wird', async () => {
    await expect(writer().composeBoard({ parent: BOARD, spec: { layout: 'columns', groups: [{ items: ['x'] }] } })).rejects.toThrow(/Titel/);
    await expect(writer().composeBoard({ parent: BOARD, spec: { layout: 'radial', groups: [{ title: 'a', items: ['x'] }] } })).rejects.toThrow(/center/);
    await expect(writer().composeBoard({ parent: HOME, spec: SPEC })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().composeBoard({ parent: COL, spec: SPEC })).rejects.toMatchObject({ code: 'args' });
    expect(be.actions).toEqual([]);
  });

  it('nennt bei einer Ablehnung mitten drin die schon angelegten Elemente', async () => {
    be.mode = 'reject';
    be.rejectFrom = 3;
    const error = await writer().composeBoard({ parent: BOARD, spec: SPEC }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MilanoteError);
    expect((error as MilanoteError).message).toMatch(/Bereits angelegt und noch vorhanden: \S+, \S+, \S+/);
  });

  it('meldet verworfene Elemente', async () => {
    be.mode = 'drop';
    const result = await writer().composeBoard({ parent: BOARD, spec: SPEC });
    expect(result.persisted).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(be.posts).toHaveLength(0);
  });

  it('bricht ab, wenn das neue Board nicht gespeichert wurde', async () => {
    be.mode = 'drop';
    const result = await writer().composeBoard({ parent: BOARD, title: 'Weg', spec: SPEC });
    expect(result.persisted).toBe(false);
    expect(result.count).toBe(0);
    expect(types()).toEqual(['ELEMENT_CREATE']);
  });

  it('läuft nicht gleichzeitig mit anderen Schreibvorgängen', async () => {
    const w = writer();
    const [composed, note] = await Promise.all([w.composeBoard({ parent: BOARD, spec: SPEC }), w.addNote({ parent: BOARD, text: 'danach' })]);
    expect(composed.persisted && note.persisted).toBe(true);
    const lastCompose = be.actions.findLastIndex((a) => (a.location as { parentId?: string } | undefined)?.parentId !== BOARD ? false : a.elementType === 'COLUMN');
    const noteIndex = be.actions.findIndex((a) => a.elementType === 'CARD' && JSON.stringify(a.content).includes('danach'));
    expect(noteIndex).toBeGreaterThan(lastCompose);
    // die Notiz landet rechts vom gerade angelegten Block, nicht darauf
    expect((note.position?.x ?? 0)).toBeGreaterThanOrEqual(composed.origin.x + composed.size.w - 1);
  });
});

describe('Sicherheit (Phase 5)', () => {
  it('sendet weiterhin nur Anlegen, Typwechsel, Ändern und Verschieben', async () => {
    const w = writer();
    await w.composeBoard({ parent: BOARD, title: 'X', spec: SPEC });
    await w.moveElement({ element: NOTE, x: 1, y: 1 });
    await w.updateElement({ element: NOTE, text: 'neu' });
    await w.resizeElement({ element: COL, width: 50 });
    await w.trash({ elements: [NOTE] });
    expect(new Set(types())).toEqual(new Set(['ELEMENT_CREATE', 'ELEMENT_SET_TYPE', 'ELEMENT_UPDATE', 'ELEMENT_MOVE_MULTI']));
    expect(USER.rootBoardId).toBe(HOME);
  });
});
