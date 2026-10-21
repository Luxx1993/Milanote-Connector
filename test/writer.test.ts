import { beforeEach, describe, expect, it } from 'vitest';
import { Writer } from '../src/writer.ts';
import { docToText } from '../src/domain/richtext.ts';
import { MilanoteError } from '../src/errors.ts';
import { BOARD, COL, FakeBackend, HOME, USER, canvas } from './helpers/fake-backend.ts';

let be: FakeBackend;
let sleeps: number[];

function writer(options: ConstructorParameters<typeof Writer>[1] = {}): Writer {
  return new Writer(be, { boardSettleMs: 1_500, verifyDelayMs: 1, sleep: async (ms) => void sleeps.push(ms), ...options });
}

const types = () => be.actions.map((a) => a.type);

beforeEach(() => {
  be = new FakeBackend();
  sleeps = [];
});

describe('addNote', () => {
  it('legt eine Notiz rechts neben den vorhandenen Inhalt, mit Markdown', async () => {
    const result = await writer().addNote({ parent: BOARD, text: '# Titel\n\n- eins\n- zwei' });
    expect(result).toMatchObject({ type: 'CARD', parentId: BOARD, boardId: BOARD, section: 'CANVAS', persisted: true, warnings: [] });
    expect(result.position).toEqual({ x: 154, y: 0 });
    const action = be.actions[0]!;
    expect(action).toMatchObject({ type: 'ELEMENT_CREATE', elementType: 'CARD', channels: [BOARD], location: { parentId: BOARD, section: 'CANVAS', position: { x: 154, y: 0 } } });
    expect((action.location as { position: { score: number } }).position.score).toBeGreaterThan(200);
    expect(docToText((action.content as { textContent: unknown }).textContent)).toBe('# Titel\n\n- eins\n- zwei');
    expect(types()).toEqual(['ELEMENT_CREATE']);
  });

  it('gibt parallelen Aufrufen verschiedene Positionen', async () => {
    const w = writer();
    const results = await Promise.all([w.addNote({ parent: BOARD, text: 'a' }), w.addNote({ parent: BOARD, text: 'b' }), w.addNote({ parent: BOARD, text: 'c' })]);
    const xs = results.map((r) => r.position?.x);
    expect(new Set(xs).size).toBe(3);
    expect(xs).toEqual([...xs].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it('hängt in einer Spalte ans Ende der Liste und kennt dort keine Koordinaten', async () => {
    const result = await writer().addNote({ parent: COL, text: 'zweite' });
    expect(result).toMatchObject({ section: 'INBOX', index: 1, parentId: COL, boardId: BOARD, persisted: true });
    expect(be.actions[0]).toMatchObject({ location: { parentId: COL, section: 'INBOX', position: { index: 1 } }, channels: [BOARD] });
    await expect(writer().addNote({ parent: COL, text: 'x', x: 1, y: 1 })).rejects.toMatchObject({ code: 'args' });
  });

  it('verlangt x und y nur zusammen und prüft den Text', async () => {
    await expect(writer().addNote({ parent: BOARD, text: 'x', x: 5 })).rejects.toThrow(/nur zusammen/);
    await expect(writer().addNote({ parent: BOARD, text: '   ' })).rejects.toMatchObject({ code: 'args' });
    await expect(writer().addNote({ parent: BOARD, text: 'a'.repeat(20_001) })).rejects.toThrow(/zu lang/);
    expect(be.actions).toEqual([]);
  });

  it('nimmt gewünschte Koordinaten', async () => {
    const result = await writer().addNote({ parent: BOARD, text: 'hier', x: 100, y: 20 });
    expect(result.position).toEqual({ x: 100, y: 20 });
  });

  it('sperrt das Home-Board (auch über Spalten und Elemente darin) bis zur Freigabe', async () => {
    await expect(writer().addNote({ parent: HOME, text: 'x' })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().addNote({ parent: 'HOMENOTEHOME1', text: 'x' })).rejects.toMatchObject({ code: 'args' });
    expect(be.actions).toEqual([]);
    const free = await writer({ allowHome: true }).addNote({ parent: HOME, text: 'frei' });
    expect(free.persisted).toBe(true);
  });

  it('lehnt unbekannte und ungeeignete Ziele ab', async () => {
    await expect(writer().addNote({ parent: 'DOESNOTEXIST01', text: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(writer().addNote({ parent: 'EXISTINGNOTE1', text: 'x' })).rejects.toThrow(/ist ein CARD/);
    await expect(writer().addNote({ parent: 'nicht gültig', text: 'x' })).rejects.toThrow(/Ungültige Board-ID/);
  });
});

describe('createBoard', () => {
  it('legt ein Board mit Palette an, markiert es nicht als geladen und wartet danach', async () => {
    const result = await writer().createBoard({ parent: BOARD, title: 'Neues Board' });
    expect(result).toMatchObject({ type: 'BOARD', title: 'Neues Board', parentId: BOARD, persisted: true });
    expect(result.url).toBe(`https://app.milanote.com/${result.id}`);
    const action = be.actions[0]!;
    expect(action).toMatchObject({ elementType: 'BOARD', markAsFetched: false });
    const content = action.content as { title: string; icon: null; defaultColorPalette: string[] };
    expect(content.title).toBe('Neues Board');
    expect(content.defaultColorPalette).toHaveLength(7);
    expect(content.defaultColorPalette.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true);
    expect(sleeps).toContain(1_500);
  });

  it('wartet nicht, wenn das Board nicht gespeichert wurde', async () => {
    be.mode = 'drop';
    const result = await writer().createBoard({ parent: BOARD, title: 'Weg' });
    expect(result.persisted).toBe(false);
    expect(sleeps).not.toContain(1_500);
  });

  it('erlaubt Boards nur auf Boards, nicht in Spalten', async () => {
    await expect(writer().createBoard({ parent: COL, title: 'x' })).rejects.toMatchObject({ code: 'args' });
  });
});

describe('addLink', () => {
  it('wendet die Link-Vorschau mit ELEMENT_SET_TYPE an', async () => {
    const result = await writer().addLink({ parent: BOARD, url: 'https://example.com' });
    expect(result).toMatchObject({ type: 'LINK', url: 'https://example.com/', previewApplied: true, linkTitle: 'Beispiel', persisted: true, warnings: [] });
    expect(types()).toEqual(['ELEMENT_CREATE', 'ELEMENT_SET_TYPE']);
    expect(be.actions[0]).toMatchObject({ elementType: 'LINK', content: { url: 'https://example.com/' } });
    expect(be.actions[1]).toMatchObject({ id: result.id, elementType: 'LINK', changes: { mediaType: 'NO_MEDIA', showCaption: true } });
    expect(be.posts[0]).toMatchObject({ path: '/media-service/api/link', body: { url: 'https://example.com/', elementId: result.id, environmentFolder: 'p', userId: 'u1' } });
  });

  it('nimmt eine eigene Beschriftung statt der Beschreibung', async () => {
    await writer().addLink({ parent: BOARD, url: 'https://example.com', caption: 'Meine Notiz' });
    const changes = be.actions[1]!.changes as { caption: unknown };
    expect(docToText(changes.caption)).toBe('Meine Notiz');
  });

  it('legt den Link ohne Vorschau an, wenn der Media-Service ausfällt, und setzt die Beschriftung per Update', async () => {
    be.previewResponse = new MilanoteError('http', 'HTTP 500');
    const result = await writer().addLink({ parent: BOARD, url: 'https://example.com', caption: 'Text' });
    expect(result).toMatchObject({ persisted: true, previewApplied: false });
    expect(result.warnings[0]).toMatch(/Link-Vorschau nicht verfügbar/);
    expect(types()).toEqual(['ELEMENT_CREATE', 'ELEMENT_UPDATE']);
    expect(be.actions[1]).toMatchObject({ updates: [{ id: result.id, changes: { showCaption: true }, meta: { modifiedVersionId: expect.stringMatching(/-1$/) } }] });
  });

  it('wandelt Bild-URLs um, wenn Milanote das meldet', async () => {
    be.previewResponse = { elementType: 'IMAGE', image: { original: 'https://media.milanote.com/x.png' }, mediaType: 'IMAGE' };
    await writer().addLink({ parent: BOARD, url: 'https://example.com/x.png' });
    expect(be.actions[1]).toMatchObject({ type: 'ELEMENT_SET_TYPE', elementType: 'IMAGE', changes: { image: { original: 'https://media.milanote.com/x.png' }, showCaption: false } });
  });

  it('akzeptiert nur http(s)', async () => {
    await expect(writer().addLink({ parent: BOARD, url: 'javascript:alert(1)' })).rejects.toThrow(/http/);
    await expect(writer().addLink({ parent: BOARD, url: 'kein link' })).rejects.toThrow(/Keine gültige URL/);
    await expect(writer().addLink({ parent: BOARD, url: 'file:///etc/passwd' })).rejects.toMatchObject({ code: 'args' });
  });
});

describe('addTodoList', () => {
  it('legt Liste und Aufgaben in Reihenfolge an', async () => {
    const result = await writer().addTodoList({ parent: BOARD, title: 'Aufgaben', tasks: ['eins', { text: 'zwei', done: true }, 'drei'] });
    expect(result).toMatchObject({ type: 'TASK_LIST', title: 'Aufgaben', persisted: true });
    expect(result.tasks.map((t) => [t.text, t.done])).toEqual([['eins', false], ['zwei', true], ['drei', false]]);
    expect(types()).toEqual(['ELEMENT_CREATE', 'ELEMENT_CREATE', 'ELEMENT_CREATE', 'ELEMENT_CREATE']);
    const [list, ...tasks] = be.actions;
    expect(list).toMatchObject({ elementType: 'TASK_LIST', content: { title: 'Aufgaben', showTitle: true }, location: { parentId: BOARD, section: 'CANVAS' } });
    expect(tasks.map((t) => (t.location as { parentId: string; position: { index: number } }).position.index)).toEqual([0, 1, 2]);
    expect(tasks.every((t) => (t.location as { parentId: string }).parentId === result.id && t.channels instanceof Array && (t.channels as string[])[0] === BOARD)).toBe(true);
    expect(tasks[1]!.content).toMatchObject({ isComplete: true });
    expect(tasks[0]!.content).not.toHaveProperty('isComplete');
  });

  it('funktioniert in einer Spalte und ohne Titel', async () => {
    const result = await writer().addTodoList({ parent: COL, tasks: ['x'] });
    expect(result).toMatchObject({ section: 'INBOX', index: 1, persisted: true });
    expect(be.actions[0]).toMatchObject({ content: { title: null, showTitle: false } });
  });

  it('prüft die Aufgaben', async () => {
    await expect(writer().addTodoList({ parent: BOARD, tasks: [] })).rejects.toMatchObject({ code: 'args' });
    await expect(writer().addTodoList({ parent: BOARD, tasks: ['  '] })).rejects.toMatchObject({ code: 'args' });
    await expect(writer().addTodoList({ parent: BOARD, tasks: Array.from({ length: 51 }, () => 'x') })).rejects.toThrow(/50/);
  });

  it('nennt bei einer Ablehnung mitten drin, was schon angelegt ist', async () => {
    be.mode = 'reject';
    be.rejectFrom = 2;
    const error = await writer().addTodoList({ parent: BOARD, tasks: ['a', 'b', 'c'] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MilanoteError);
    expect((error as MilanoteError).code).toBe('rejected');
    expect((error as MilanoteError).message).toMatch(/Bereits angelegt und noch vorhanden: \S+, \S+/);
  });
});

describe('addColumn', () => {
  it('legt eine Spalte mit Notizen an', async () => {
    const result = await writer().addColumn({ parent: BOARD, title: 'Ideen', notes: ['**eins**', 'zwei'] });
    expect(result).toMatchObject({ type: 'COLUMN', title: 'Ideen', persisted: true });
    expect(result.notes).toHaveLength(2);
    const [column, ...notes] = be.actions;
    expect(column).toMatchObject({ elementType: 'COLUMN', content: { title: 'Ideen' }, location: { section: 'CANVAS' } });
    expect(notes.map((n) => n.location)).toEqual([
      { parentId: result.id, section: 'INBOX', position: { index: 0, score: 0 } },
      { parentId: result.id, section: 'INBOX', position: { index: 1, score: 65536 } },
    ]);
    expect(notes.every((n) => n.elementType === 'CARD')).toBe(true);
  });

  it('erlaubt Spalten nicht in Spalten', async () => {
    await expect(writer().addColumn({ parent: COL, title: 'x' })).rejects.toMatchObject({ code: 'args' });
  });
});

describe('Abgleich nach dem Schreiben', () => {
  it('meldet verworfene Elemente als nicht gespeichert, ohne zu werfen', async () => {
    be.mode = 'drop';
    const result = await writer().addNote({ parent: BOARD, text: 'weg' });
    expect(result.persisted).toBe(false);
    expect(result.warnings[0]).toMatch(/bestätigt.*nicht zu sehen/);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('wartet bei jungen Boards doppelt so lange auf das Element', async () => {
    const w = writer();
    const board = await w.createBoard({ parent: BOARD, title: 'Jung' });
    be.mode = 'drop';
    sleeps.length = 0;
    await w.addNote({ parent: board.id, text: 'ins neue Board' });
    const young = sleeps.length;
    sleeps.length = 0;
    await w.addNote({ parent: BOARD, text: 'ins alte Board' });
    expect(young).toBe(11);
    expect(sleeps.length).toBe(5);
  });

  it('akzeptiert fehlende Bestätigung, wenn das Element da ist, und warnt', async () => {
    be.mode = 'noack-store';
    const result = await writer().addNote({ parent: BOARD, text: 'da' });
    expect(result.persisted).toBe(true);
    expect(result.warnings[0]).toMatch(/Keine Bestätigung.*vorhanden/);
  });

  it('wirft, wenn Bestätigung fehlt und das Element nicht zu finden ist', async () => {
    be.mode = 'noack-lose';
    await expect(writer().addNote({ parent: BOARD, text: 'weg' })).rejects.toMatchObject({ code: 'connection' });
  });

  it('reicht Ablehnungen durch', async () => {
    be.mode = 'reject';
    await expect(writer().addNote({ parent: BOARD, text: 'x' })).rejects.toMatchObject({ code: 'rejected' });
  });
});

describe('trash', () => {
  it('verschiebt in den Papierkorb des Boards und merkt sich den Ursprung', async () => {
    const result = await writer().trash({ elements: ['EXISTINGNOTE1'] });
    expect(result).toMatchObject({ persisted: true, trashed: [{ id: 'EXISTINGNOTE1', type: 'CARD', boardId: BOARD }], skipped: [] });
    const action = be.actions[0]!;
    expect(action).toMatchObject({
      type: 'ELEMENT_MOVE_MULTI',
      moveOperation: 'TRASH',
      channels: [BOARD, `${BOARD}-trash`],
      moves: [{ id: 'EXISTINGNOTE1', location: { parentId: `${BOARD}-trash`, section: 'TRASH', position: { restoreLocation: canvas(BOARD, 0, 4, 100) } }, from: canvas(BOARD, 0, 4, 100) }],
    });
    expect(be.elements.EXISTINGNOTE1!.location?.section).toBe('TRASH');
  });

  it('legt ein Board in den Papierkorb seines Eltern-Boards', async () => {
    const result = await writer().trash({ elements: [`https://app.milanote.com/${COL}/spalte`] });
    expect(result.trashed).toEqual([{ id: COL, type: 'COLUMN', boardId: BOARD }]);
  });

  it('fasst mehrere Elemente je Board zusammen und überspringt Kinder eines mitverschobenen Elements', async () => {
    const result = await writer().trash({ elements: ['EXISTINGNOTE1', COL, 'INCOLUMNNOTE1', 'EXISTINGNOTE1'] });
    expect(be.actions).toHaveLength(1);
    expect(result.trashed.map((t) => t.id).sort()).toEqual([COL, 'EXISTINGNOTE1'].sort());
    expect(result.skipped).toEqual([{ id: 'INCOLUMNNOTE1', reason: 'wandert mit seinem Eltern-Element in den Papierkorb' }]);
  });

  it('verweigert Wurzel-Boards und Home-Inhalte, ohne etwas zu verschieben', async () => {
    await expect(writer().trash({ elements: ['EXISTINGNOTE1', HOME] })).rejects.toThrow(/Wurzel-Board/);
    await expect(writer().trash({ elements: ['EXISTINGNOTE1', USER.quickNotesRootId!] })).rejects.toThrow(/Wurzel-Board/);
    await expect(writer().trash({ elements: ['EXISTINGNOTE1', 'HOMENOTEHOME1'] })).rejects.toThrow(/Home-Board ist gesperrt/);
    await expect(writer().trash({ elements: ['EXISTINGNOTE1', 'DOESNOTEXIST01'] })).rejects.toMatchObject({ code: 'not_found' });
    expect(be.actions).toEqual([]);
  });

  it('meldet Verschobenes, das noch sichtbar ist', async () => {
    be.mode = 'drop';
    const result = await writer().trash({ elements: ['EXISTINGNOTE1'] });
    expect(result.persisted).toBe(false);
    expect(result.trashed).toEqual([]);
    expect(result.warnings[0]).toMatch(/noch im Board sichtbar/);
  });

  it('überspringt, was schon im Papierkorb liegt, und begrenzt die Anzahl', async () => {
    await writer().trash({ elements: ['EXISTINGNOTE1'] });
    be.actions.length = 0;
    const again = await writer().trash({ elements: ['EXISTINGNOTE1'] });
    expect(again.skipped).toEqual([{ id: 'EXISTINGNOTE1', reason: 'liegt schon im Papierkorb' }]);
    expect(be.actions).toEqual([]);
    await expect(writer().trash({ elements: Array.from({ length: 21 }, (_, i) => `ELEMENTNUMBER${String(i).padStart(2, '0')}`) })).rejects.toThrow(/Höchstens 20/);
  });
});

describe('Sicherheit', () => {
  it('sendet nie ELEMENT_DELETE', async () => {
    const w = writer();
    await w.addNote({ parent: BOARD, text: 'a' });
    await w.addColumn({ parent: BOARD, title: 'c', notes: ['n'] });
    await w.addTodoList({ parent: BOARD, tasks: ['t'] });
    await w.addLink({ parent: BOARD, url: 'https://example.com' });
    await w.trash({ elements: ['EXISTINGNOTE1'] });
    expect(types()).not.toContain('ELEMENT_DELETE');
    expect(new Set(types())).toEqual(new Set(['ELEMENT_CREATE', 'ELEMENT_SET_TYPE', 'ELEMENT_MOVE_MULTI']));
  });
});
