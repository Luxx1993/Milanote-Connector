import { Writer, type WriteBackend, type WriteUser } from '../../src/writer.ts';
import { IdGenerator } from '../../src/protocol/ids.ts';
import { PLATFORM, type Action } from '../../src/protocol/actions.ts';
import { boardAbove, type Elements } from '../../src/domain/hierarchy.ts';
import { MilanoteError } from '../../src/errors.ts';
import { parseBoardRef } from '../../src/milanote.ts';
import type { RawElement } from '../../src/domain/board.ts';

export const USER: WriteUser = { id: 'u1', rootBoardId: 'HOMEHOMEHOME1', quickNotesRootId: 'QNOTESROOT001' };
export const HOME = 'HOMEHOMEHOME1';
export const BOARD = 'BOARDBOARD0001';
export const COL = 'COLUMNCOLUMN01';

export const canvas = (parentId: string, x: number, y: number, score = 65536) => ({ parentId, section: 'CANVAS', position: { x, y, score } });
export const inbox = (parentId: string, index: number) => ({ parentId, section: 'INBOX', position: { index, score: index * 65536 } });
export const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

/** Milanote im Speicher: nimmt Aktionen an und bildet sie in `elements` ab. */
export class FakeBackend implements WriteBackend {
  origin = 'https://app.milanote.com';
  ids = new IdGenerator();
  actions: Action[] = [];
  posts: { path: string; body: unknown }[] = [];
  /** ok: speichern; drop: bestätigen, aber verwerfen; noack-store: speichern, aber Verbindung weg; noack-lose: nichts speichern, Verbindung weg; reject: ablehnen */
  mode: 'ok' | 'drop' | 'noack-store' | 'noack-lose' | 'reject' = 'ok';
  rejectFrom = 0;
  /** apply: Änderungen übernehmen; ignore: bestätigen, aber nicht übernehmen */
  updates: 'apply' | 'ignore' = 'apply';
  previewResponse: unknown = { elementType: 'LINK', mediaType: 'NO_MEDIA', link: { url: 'https://example.com', title: 'Beispiel' }, provider: { name: 'example' }, description: 'Beschreibung' };
  elements: Elements = {
    [HOME]: { _id: HOME, elementType: 'BOARD', content: { title: 'Home' } },
    [BOARD]: { _id: BOARD, elementType: 'BOARD', location: canvas(HOME, 0, 0), content: { title: 'Test' } },
    EXISTINGNOTE1: { _id: 'EXISTINGNOTE1', elementType: 'CARD', location: canvas(BOARD, 0, 4, 100), content: { textContent: doc('alt') }, meta: { versionId: 'abc-1' } },
    [COL]: { _id: COL, elementType: 'COLUMN', location: canvas(BOARD, 0, 30, 200), content: { title: 'Spalte' } },
    INCOLUMNNOTE1: { _id: 'INCOLUMNNOTE1', elementType: 'CARD', location: inbox(COL, 0), content: { textContent: doc('erste') } },
    HOMENOTEHOME1: { _id: 'HOMENOTEHOME1', elementType: 'CARD', location: canvas(HOME, 0, 0), content: { textContent: doc('im Home') } },
    SUBBOARD00001: { _id: 'SUBBOARD00001', elementType: 'BOARD', location: canvas(BOARD, 100, 0, 300), content: { title: 'Unterboard' } },
    SUBNOTE000001: { _id: 'SUBNOTE000001', elementType: 'CARD', location: canvas('SUBBOARD00001', 0, 4, 100), content: { textContent: doc('im Unterboard') } },
    NESTEDBOARD01: { _id: 'NESTEDBOARD01', elementType: 'BOARD', location: canvas('SUBBOARD00001', 50, 0, 200), content: { title: 'Verschachtelt' } },
    TASKLIST00001: { _id: 'TASKLIST00001', elementType: 'TASK_LIST', location: canvas(BOARD, 60, 4, 400), content: { title: 'Liste A', showTitle: true } },
    TASKONE000001: { _id: 'TASKONE000001', elementType: 'TASK', location: inbox('TASKLIST00001', 0), content: { textContent: doc('Aufgabe eins') } },
    TASKTWO000001: { _id: 'TASKTWO000001', elementType: 'TASK', location: inbox('TASKLIST00001', 1), content: { textContent: doc('Aufgabe zwei') } },
    TASKLIST00002: { _id: 'TASKLIST00002', elementType: 'TASK_LIST', location: canvas(BOARD, 60, 40, 500), content: { title: null, showTitle: false } },
    LINKONE000001: { _id: 'LINKONE000001', elementType: 'LINK', location: canvas(BOARD, 110, 40, 600), content: { link: { url: 'https://example.com' } } },
  };

  async whoami(): Promise<WriteUser> {
    return USER;
  }
  parseRef(ref: string): string {
    return parseBoardRef(ref);
  }
  actionContext(user: WriteUser) {
    return { userId: user.id, ids: this.ids, platform: PLATFORM };
  }
  async getBoard(boardId: string) {
    const board = this.elements[boardId];
    if (!board) throw new MilanoteError('not_found', `Board ${boardId} nicht ladbar`);
    const elements: Elements = {};
    for (const el of Object.values(this.elements)) if (el._id === boardId || boardAbove(this.elements, el._id) === boardId) elements[el._id] = el;
    return { board, elements };
  }
  async loadWithAncestors(ids: string[]): Promise<Elements> {
    const out: Elements = {};
    for (const id of ids) {
      let current: string | undefined = id;
      for (let hops = 0; current && hops < 30; hops += 1) {
        const el: RawElement | undefined = this.elements[current];
        if (!el) break;
        out[current] = el;
        current = el.location?.parentId?.replace(/-trash$/, '');
      }
    }
    return out;
  }
  async postJson<T>(path: string, body: unknown): Promise<T> {
    this.posts.push({ path, body });
    if (this.previewResponse instanceof Error) throw this.previewResponse;
    return this.previewResponse as T;
  }
  async sendAction(action: Action): Promise<void> {
    this.actions.push(action);
    if (this.mode === 'reject' && this.actions.length > this.rejectFrom) throw new MilanoteError('rejected', `Milanote hat ${action.type} abgelehnt: [{"status":403}]`);
    if (this.mode === 'noack-lose') throw new MilanoteError('connection', 'Zeitüberschreitung');
    if (this.mode === 'drop') return;
    this.apply(action);
    if (this.mode === 'noack-store') throw new MilanoteError('connection', 'Zeitüberschreitung');
  }

  private apply(action: Action): void {
    if (action.type === 'ELEMENT_CREATE') {
      const id = action.id as string;
      this.elements[id] = { _id: id, elementType: action.elementType as string, location: action.location as RawElement['location'], content: action.content as Record<string, unknown>, meta: action.meta as Record<string, unknown> };
    } else if (action.type === 'ELEMENT_UPDATE' && this.updates === 'apply') {
      for (const u of action.updates as { id: string; changes: Record<string, unknown>; meta: { versionId: string } }[]) {
        const el = this.elements[u.id];
        if (el) {
          el.content = { ...el.content, ...u.changes };
          el.meta = { ...el.meta, versionId: u.meta.versionId };
        }
      }
    } else if (action.type === 'ELEMENT_MOVE_MULTI') {
      for (const move of action.moves as { id: string; location: RawElement['location'] }[]) {
        const el = this.elements[move.id];
        if (el) el.location = move.location;
      }
    }
  }
}

