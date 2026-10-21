// Schreib-Operationen (Phase 3): Board, Notiz, Link, To-do-Liste, Spalte, Papierkorb.
//
// Regeln, die hier zentral gelten (die Tools müssen sie nicht kennen):
//  - Schreibvorgänge laufen strikt nacheinander; Positionen werden dabei jedes Mal frisch aus dem Board berechnet.
//  - Nach jedem Schreiben prüft ein REST-Abgleich, ob die Elemente wirklich gespeichert sind (Ack 200 reicht laut
//    milanote-skill nicht). Ein neues Board wird erst als bereit gemeldet, wenn es lesbar ist und eine Wartezeit
//    verstrichen ist; project-creator beobachtete, dass Kinder sonst verworfen werden.
//  - Fehlt nur das Ack (Verbindung weg), wird nicht blind wiederholt, sondern nachgesehen, ob das Element da ist.
//  - Das Home-Board ist gesperrt, solange es nicht ausdrücklich freigegeben wurde.
//  - Entfernen heißt immer „in den Papierkorb“. ELEMENT_DELETE wird nirgends gesendet.

import { randomInt } from 'node:crypto';
import { MilanoteError } from './errors.ts';
import { ackStatus, elementCreate, elementSetType, elementUpdate, elementsToTrash, type Action, type ActionContext, type CanvasPosition, type ElementType, type InboxPosition } from './protocol/actions.ts';
import { isHidden, type RawElement } from './domain/board.ts';
import { boardAbove, canvasChildrenOf, nextInboxPosition, parentInfo, type Elements, type ParentInfo } from './domain/hierarchy.ts';
import { nextCanvasPosition } from './domain/placement.ts';
import { textToDoc } from './domain/richtext.ts';

export interface WriteUser {
  id: string;
  rootBoardId: string;
  quickNotesRootId?: string;
}

/** Was der Writer vom Client braucht. `MilanoteClient` implementiert das; Tests nutzen eine Attrappe. */
export interface WriteBackend {
  whoami(): Promise<WriteUser>;
  getBoard(boardId: string): Promise<{ board: RawElement; elements: Elements }>;
  loadWithAncestors(ids: string[]): Promise<Elements>;
  sendAction(action: Action): Promise<void>;
  postJson<T>(path: string, body: unknown): Promise<T>;
  actionContext(user: WriteUser): ActionContext;
  parseRef(ref: string): string;
  origin: string;
}

export interface WriterOptions {
  /** Schreiben ins Home-Board erlauben (Standard: gesperrt). */
  allowHome?: boolean;
  /** Wartezeit nach Anlegen eines Boards, bevor Kinder hineingeschrieben werden. */
  boardSettleMs?: number;
  verifyAttempts?: number;
  verifyDelayMs?: number;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface Placed {
  section: 'CANVAS' | 'INBOX';
  /** Rastereinheiten (1 ≈ 9 px); nur auf der Fläche. */
  position?: { x: number; y: number };
  /** Platz in der Liste; nur in Spalten und To-do-Listen. */
  index?: number;
}

export interface WriteMeta {
  id: string;
  type: string;
  parentId: string;
  boardId: string;
  boardUrl: string;
  /** Alle angelegten Elemente sind per REST lesbar. */
  persisted: boolean;
  warnings: string[];
}

export type TaskInput = string | { text: string; done?: boolean };

interface Target {
  parent: ParentInfo;
  elements: Elements;
}

interface Sent {
  id: string;
  parentId: string;
  acked: boolean;
}

export type Coordinates = { x?: number; y?: number };

const PALETTES = [
  ['#5b8def', '#8b7fd6', '#b57ad0', '#d4709a', '#f0706a', '#f0a45d', '#f0cb7a'],
  ['#3fae9f', '#6fb58f', '#d9d5b9', '#e6bf55', '#f09c4f', '#dd6e56', '#e0603f'],
  ['#8aa8b3', '#9cb9c8', '#b5ced5', '#c8d8d4', '#d29492', '#dc767c', '#ec5a55'],
  ['#e5694c', '#d99a5f', '#cfab9a', '#c9c3bd', '#9ec5dc', '#86b6d3', '#7096be'],
  ['#689ab6', '#7db3d1', '#5bb0aa', '#a9d3d0', '#d690ae', '#c27a9f', '#b085ab'],
];

export class Writer {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly born = new Map<string, number>();
  private readonly o: Required<Omit<WriterOptions, 'log'>> & Pick<WriterOptions, 'log'>;

  constructor(
    private readonly be: WriteBackend,
    options: WriterOptions = {},
  ) {
    this.o = {
      allowHome: false,
      boardSettleMs: 1_500,
      verifyAttempts: 6,
      verifyDelayMs: 500,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      ...options,
    };
  }

  // ------------------------------------------------------------------ öffentliche Operationen

  createBoard(input: { parent: string; title: string } & Coordinates): Promise<WriteMeta & { url: string; title: string; position: { x: number; y: number } }> {
    return this.exclusive(async () => {
      const title = requireText(input.title, 'Titel', 200);
      const t = await this.target(input.parent, false);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const position = this.canvasPosition(t, input);
      const id = ctx.ids.elementId();
      const content = { title, icon: null, color: null, secondaryColor: null, defaultColorPalette: PALETTES[randomInt(PALETTES.length)] };
      const warnings: string[] = [];
      const sent = [await this.create(ctx, t, id, 'BOARD', 'CANVAS', position, content)];
      const persisted = await this.finish(t, sent, warnings);
      if (persisted) await this.waitUntilReady(id, warnings);
      return { ...this.meta(id, 'BOARD', t, persisted, warnings), url: this.url(id), title, position: { x: position.x, y: position.y } };
    });
  }

  addNote(input: { parent: string; text: string } & Coordinates): Promise<WriteMeta & Placed> {
    return this.exclusive(async () => {
      const text = requireText(input.text, 'Text', 20_000);
      const t = await this.target(input.parent, true);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const place = this.placement(t, input);
      const id = ctx.ids.elementId();
      const content = { textContent: textToDoc(text, () => ctx.ids.blockKey()) };
      const warnings: string[] = [];
      const sent = [await this.create(ctx, t, id, 'CARD', place.section, place.raw, content)];
      const persisted = await this.finish(t, sent, warnings);
      return { ...this.meta(id, 'CARD', t, persisted, warnings), ...place.shown };
    });
  }

  addLink(input: { parent: string; url: string; caption?: string } & Coordinates): Promise<WriteMeta & Placed & { url: string; linkTitle?: string; previewApplied: boolean }> {
    return this.exclusive(async () => {
      const url = requireHttpUrl(input.url);
      const t = await this.target(input.parent, true);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const place = this.placement(t, input);
      const id = ctx.ids.elementId();
      const warnings: string[] = [];
      const sent = [await this.create(ctx, t, id, 'LINK', place.section, place.raw, { url })];
      let persisted = await this.finish(t, sent, warnings);

      let previewApplied = false;
      let linkTitle: string | undefined;
      if (persisted) {
        const preview = await this.preview(user.id, url, id, warnings);
        const captionDoc = input.caption?.trim() ? textToDoc(input.caption, () => ctx.ids.blockKey()) : undefined;
        if (preview) {
          const changes: Record<string, unknown> = {};
          for (const key of ['image', 'mediaType', 'link', 'provider', 'media']) if (preview[key] !== undefined) changes[key] = preview[key];
          const description = typeof preview.description === 'string' && preview.description ? textToDoc(preview.description, () => ctx.ids.blockKey()) : undefined;
          const caption = captionDoc ?? description;
          if (caption) Object.assign(changes, { caption, showCaption: true });
          else changes.showCaption = false;
          const elementType = typeof preview.elementType === 'string' ? preview.elementType : 'LINK';
          previewApplied = await this.tryAction(elementSetType(ctx, { id, elementType, boardId: t.parent.boardId, changes }), 'Link-Vorschau konnte nicht angewendet werden', warnings);
          const link = preview.link as { title?: unknown } | undefined;
          if (previewApplied && typeof link?.title === 'string') linkTitle = link.title;
        } else if (captionDoc) {
          await this.tryAction(
            elementUpdate(ctx, { id, elementType: 'LINK', boardId: t.parent.boardId, previousVersionId: ctx.ids.createVersionId(), changes: { caption: captionDoc, showCaption: true } }),
            'Beschriftung konnte nicht gesetzt werden',
            warnings,
          );
        }
      } else persisted = false;
      return { ...this.meta(id, 'LINK', t, persisted, warnings), ...place.shown, url, linkTitle, previewApplied };
    });
  }

  addTodoList(input: { parent: string; title?: string; tasks: TaskInput[] } & Coordinates): Promise<WriteMeta & Placed & { title?: string; tasks: { id: string; text: string; done: boolean }[] }> {
    return this.exclusive(async () => {
      const tasks = input.tasks.map((task) => (typeof task === 'string' ? { text: task, done: false } : { text: task.text, done: Boolean(task.done) })).map((task) => ({ ...task, text: requireText(task.text, 'Aufgabe', 500) }));
      if (!tasks.length) throw new MilanoteError('args', 'Eine To-do-Liste braucht mindestens eine Aufgabe');
      if (tasks.length > 50) throw new MilanoteError('args', 'Höchstens 50 Aufgaben pro Liste');
      const title = input.title?.trim() || undefined;
      const t = await this.target(input.parent, true);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const place = this.placement(t, input);
      const listId = ctx.ids.elementId();
      const warnings: string[] = [];
      const sent: Sent[] = [];
      const created: { id: string; text: string; done: boolean }[] = [];
      try {
        sent.push(await this.create(ctx, t, listId, 'TASK_LIST', place.section, place.raw, { title: title ?? null, showTitle: Boolean(title) }));
        for (const [index, task] of tasks.entries()) {
          const id = ctx.ids.elementId();
          const content: Record<string, unknown> = { textContent: textToDoc(task.text, () => ctx.ids.blockKey()) };
          if (task.done) content.isComplete = true;
          sent.push(await this.createChild(ctx, t, listId, id, 'TASK', { index, score: index * 65_536 }, content));
          created.push({ id, ...task });
        }
      } catch (error) {
        throw partial(error, sent);
      }
      const persisted = await this.finish(t, sent, warnings);
      return { ...this.meta(listId, 'TASK_LIST', t, persisted, warnings), ...place.shown, title, tasks: created };
    });
  }

  addColumn(input: { parent: string; title: string; notes?: string[] } & Coordinates): Promise<WriteMeta & Placed & { title: string; notes: { id: string }[] }> {
    return this.exclusive(async () => {
      const title = requireText(input.title, 'Titel', 200);
      const notes = (input.notes ?? []).map((n) => requireText(n, 'Notiz', 20_000));
      if (notes.length > 30) throw new MilanoteError('args', 'Höchstens 30 Notizen pro Spalte in einem Aufruf');
      const t = await this.target(input.parent, false);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const position = this.canvasPosition(t, input);
      const columnId = ctx.ids.elementId();
      const warnings: string[] = [];
      const sent: Sent[] = [];
      const created: { id: string }[] = [];
      try {
        sent.push(await this.create(ctx, t, columnId, 'COLUMN', 'CANVAS', position, { title }));
        for (const [index, text] of notes.entries()) {
          const id = ctx.ids.elementId();
          sent.push(await this.createChild(ctx, t, columnId, id, 'CARD', { index, score: index * 65_536 }, { textContent: textToDoc(text, () => ctx.ids.blockKey()) }));
          created.push({ id });
        }
      } catch (error) {
        throw partial(error, sent);
      }
      const persisted = await this.finish(t, sent, warnings);
      return { ...this.meta(columnId, 'COLUMN', t, persisted, warnings), section: 'CANVAS', position: { x: position.x, y: position.y }, title, notes: created };
    });
  }

  /**
   * Verschiebt Elemente in den Papierkorb ihres Boards. Wiederherstellen geht in Milanote
   * (Papierkorb des Boards). Gesperrt: die Wurzel-Boards (Home, Schnellnotizen) und, solange Home nicht
   * freigegeben ist, alles, was direkt im Home-Board liegt.
   */
  trash(input: { elements: string[] }): Promise<{ trashed: { id: string; type: string; boardId: string }[]; skipped: { id: string; reason: string }[]; persisted: boolean; warnings: string[] }> {
    return this.exclusive(async () => {
      const refs = [...new Set(input.elements.map((ref) => this.be.parseRef(ref)))];
      if (!refs.length) throw new MilanoteError('args', 'Keine Elemente angegeben');
      if (refs.length > 20) throw new MilanoteError('args', 'Höchstens 20 Elemente pro Aufruf');
      const user = await this.be.whoami();
      const elements = await this.be.loadWithAncestors(refs);
      const skipped: { id: string; reason: string }[] = [];
      const byBoard = new Map<string, { id: string; elementType: string; from: { parentId: string; section: string; position: unknown } }[]>();

      for (const id of refs) {
        if (id === user.rootBoardId || id === user.quickNotesRootId) throw new MilanoteError('args', `${id} ist ein Wurzel-Board (Home bzw. Schnellnotizen) und kann nicht in den Papierkorb. Es wurde nichts verschoben.`);
        const el = elements[id];
        if (!el || el.elementType === 'SKELETON') throw new MilanoteError('not_found', `Element ${id} nicht gefunden oder kein Zugriff. Es wurde nichts verschoben.`);
        if (isHidden(el)) {
          skipped.push({ id, reason: 'liegt schon im Papierkorb' });
          continue;
        }
        // Ist ein Vorfahre ebenfalls in der Liste, wandert das Element mit ihm.
        if (this.hasAncestorIn(elements, id, new Set(refs))) {
          skipped.push({ id, reason: 'wandert mit seinem Eltern-Element in den Papierkorb' });
          continue;
        }
        const boardId = boardAbove(elements, id);
        if (!boardId || !el.location?.parentId || !el.location.section) throw new MilanoteError('not_found', `Zu ${id} wurde kein Board gefunden. Es wurde nichts verschoben.`);
        if (boardId === user.rootBoardId && !this.o.allowHome) throw this.homeLocked('Das Element liegt direkt im Home-Board.');
        const list = byBoard.get(boardId) ?? [];
        list.push({ id, elementType: el.elementType, from: { parentId: el.location.parentId, section: el.location.section, position: el.location.position } });
        byBoard.set(boardId, list);
      }

      const ctx = this.be.actionContext(user);
      const warnings: string[] = [];
      const trashed: { id: string; type: string; boardId: string }[] = [];
      let allGone = true;
      for (const [boardId, items] of byBoard) {
        let acked = true;
        try {
          await this.be.sendAction(elementsToTrash(ctx, boardId, items));
        } catch (error) {
          if (!(error instanceof MilanoteError) || error.code !== 'connection') throw error;
          acked = false;
          warnings.push(`Keine Bestätigung von Milanote (${error.message})`);
        }
        const stillThere = await this.stillVisible(boardId, items.map((i) => i.id));
        if (stillThere.size && !acked) throw new MilanoteError('connection', `Milanote hat den Papierkorb-Befehl nicht bestätigt, und ${[...stillThere].join(', ')} liegt noch im Board. Bitte mit get_board prüfen und erneut versuchen.`);
        if (stillThere.size) {
          allGone = false;
          warnings.push(`Milanote hat bestätigt, aber ${[...stillThere].join(', ')} ist noch im Board sichtbar. Prüfe mit get_board, bevor du es erneut versuchst.`);
        }
        for (const item of items) if (!stillThere.has(item.id)) trashed.push({ id: item.id, type: item.elementType, boardId });
      }
      return { trashed, skipped, persisted: allGone, warnings };
    });
  }

  // ------------------------------------------------------------------ Bausteine

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async target(ref: string, allowColumn: boolean): Promise<Target> {
    const user = await this.be.whoami();
    const id = this.be.parseRef(ref);
    const withAncestors = await this.be.loadWithAncestors([id]);
    const parent = parentInfo(withAncestors, id, allowColumn);
    if (parent.boardId === user.rootBoardId && !this.o.allowHome) throw this.homeLocked(parent.type === 'BOARD' ? 'Das Ziel ist das Home-Board.' : 'Die Spalte liegt im Home-Board.');
    // Frische Inhalte des Boards für Positionen (enthält auch die Kinder von Spalten).
    const { elements } = await this.be.getBoard(parent.boardId);
    return { parent, elements: { ...withAncestors, ...elements } };
  }

  private homeLocked(detail: string): MilanoteError {
    return new MilanoteError('args', `${detail} Schreiben ins Home-Board ist gesperrt, damit es aufgeräumt bleibt. Bitte ein Unterboard als Ziel angeben (oder MILANOTE_ALLOW_HOME=1 setzen).`);
  }

  private canvasPosition(t: Target, c: Coordinates): CanvasPosition {
    if ((c.x === undefined) !== (c.y === undefined)) throw new MilanoteError('args', 'x und y nur zusammen angeben (oder beide weglassen)');
    if (t.parent.type !== 'BOARD') throw new MilanoteError('args', 'Dieses Element kann nur direkt auf einem Board liegen, nicht in einer Spalte');
    return nextCanvasPosition(canvasChildrenOf(t.elements, t.parent.boardId), c);
  }

  private placement(t: Target, c: Coordinates): { section: 'CANVAS' | 'INBOX'; raw: CanvasPosition | InboxPosition; shown: Placed } {
    if (t.parent.type === 'COLUMN') {
      if (c.x !== undefined || c.y !== undefined) throw new MilanoteError('args', 'In einer Spalte gibt es keine x/y-Koordinaten; neue Elemente kommen ans Ende der Spalte');
      const raw = nextInboxPosition(t.elements, t.parent.parentId);
      return { section: 'INBOX', raw, shown: { section: 'INBOX', index: raw.index } };
    }
    const raw = this.canvasPosition(t, c);
    return { section: 'CANVAS', raw, shown: { section: 'CANVAS', position: { x: raw.x, y: raw.y } } };
  }

  private create(ctx: ActionContext, t: Target, id: string, type: ElementType, section: 'CANVAS' | 'INBOX', position: CanvasPosition | InboxPosition, content: Record<string, unknown>): Promise<Sent> {
    return this.createChild(ctx, t, t.parent.parentId, id, type, position, content, section);
  }

  private async createChild(
    ctx: ActionContext,
    t: Target,
    parentId: string,
    id: string,
    type: ElementType,
    position: CanvasPosition | InboxPosition,
    content: Record<string, unknown>,
    section: 'CANVAS' | 'INBOX' = 'INBOX',
  ): Promise<Sent> {
    const action = elementCreate(ctx, { id, elementType: type, boardId: t.parent.boardId, location: { parentId, section, position }, content });
    return { id, parentId, acked: await this.submit(action) };
  }

  /** Sendet eine Aktion. `false` heißt: keine Bestätigung wegen Verbindungsproblem (Zustand unklar). */
  private async submit(action: Action): Promise<boolean> {
    try {
      await this.be.sendAction(action);
      return true;
    } catch (error) {
      if (error instanceof MilanoteError && error.code === 'connection') {
        this.o.log?.(`Keine Bestätigung für ${action.type}: ${error.message}`);
        return false;
      }
      throw error;
    }
  }

  /** Für optionale Folgeschritte (Link-Vorschau): Fehler werden zu Warnungen. */
  private async tryAction(action: Action, message: string, warnings: string[]): Promise<boolean> {
    try {
      await this.be.sendAction(action);
      return true;
    } catch (error) {
      warnings.push(`${message}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async preview(userId: string, url: string, elementId: string, warnings: string[]): Promise<Record<string, unknown> | undefined> {
    try {
      const preview = await this.be.postJson<Record<string, unknown>>('/media-service/api/link', { url, elementId, environmentFolder: 'p', userId, locale: 'en' });
      if (preview && typeof preview === 'object' && !('error' in preview)) return preview;
      warnings.push('Milanote lieferte keine Link-Vorschau; der Link wurde ohne Vorschau angelegt.');
    } catch (error) {
      warnings.push(`Link-Vorschau nicht verfügbar (${error instanceof Error ? error.message : String(error)}); der Link wurde ohne Vorschau angelegt.`);
    }
    return undefined;
  }

  /** REST-Abgleich. Gibt zurück, ob alle gesendeten Elemente lesbar sind; wirft, wenn Unbestätigtes fehlt. */
  private async finish(t: Target, sent: Sent[], warnings: string[]): Promise<boolean> {
    const missing = await this.verify(t.parent.boardId, sent);
    const lostSilently = sent.filter((s) => !s.acked && missing.has(s.id));
    if (lostSilently.length) {
      throw new MilanoteError('connection', `Milanote hat nicht bestätigt, und ${lostSilently.map((s) => s.id).join(', ')} ist nicht zu finden. Vermutlich wurde nichts angelegt; bitte mit get_board prüfen und erneut versuchen.`);
    }
    for (const s of sent) {
      if (!s.acked && !missing.has(s.id)) warnings.push(`Keine Bestätigung von Milanote (Verbindung unterbrochen), ${s.id} ist aber vorhanden.`);
      if (s.acked && missing.has(s.id)) warnings.push(`Milanote hat ${s.id} bestätigt, das Element ist per REST aber nicht zu sehen (möglicherweise verworfen). Prüfe mit get_board, bevor du es erneut versuchst.`);
    }
    return missing.size === 0;
  }

  private async verify(boardId: string, sent: Sent[]): Promise<Set<string>> {
    const young = this.o.now() - (this.born.get(boardId) ?? 0) < 60_000;
    const attempts = this.o.verifyAttempts * (young ? 2 : 1);
    const missing = new Set(sent.map((s) => s.id));
    for (let attempt = 0; attempt < attempts && missing.size; attempt += 1) {
      if (attempt > 0) await this.o.sleep(this.o.verifyDelayMs);
      let elements: Elements;
      try {
        ({ elements } = await this.be.getBoard(boardId));
      } catch {
        continue;
      }
      for (const s of sent) {
        const el = elements[s.id];
        if (el && el.location?.parentId === s.parentId && !isHidden(el)) missing.delete(s.id);
      }
    }
    return missing;
  }

  private async stillVisible(boardId: string, ids: string[]): Promise<Set<string>> {
    const visible = new Set(ids);
    for (let attempt = 0; attempt < this.o.verifyAttempts && visible.size; attempt += 1) {
      if (attempt > 0) await this.o.sleep(this.o.verifyDelayMs);
      let elements: Elements;
      try {
        ({ elements } = await this.be.getBoard(boardId));
      } catch {
        continue;
      }
      for (const id of ids) {
        const el = elements[id];
        if (!el || isHidden(el)) visible.delete(id);
      }
    }
    return visible;
  }

  /** Neues Board: lesbar werden lassen und kurz warten, bevor jemand hineinschreibt. */
  private async waitUntilReady(boardId: string, warnings: string[]): Promise<void> {
    this.born.set(boardId, this.o.now());
    let readable = false;
    for (let attempt = 0; attempt < 20 && !readable; attempt += 1) {
      try {
        await this.be.getBoard(boardId);
        readable = true;
      } catch {
        await this.o.sleep(500);
      }
    }
    if (!readable) warnings.push('Das neue Board ist noch nicht lesbar; Inhalte darin könnten verworfen werden. Mit get_board prüfen.');
    await this.o.sleep(this.o.boardSettleMs);
  }

  private hasAncestorIn(elements: Elements, id: string, ids: Set<string>): boolean {
    let parent = elements[id]?.location?.parentId;
    for (let hops = 0; parent && hops < 30; hops += 1) {
      if (ids.has(parent)) return true;
      parent = elements[parent]?.location?.parentId;
    }
    return false;
  }

  private meta(id: string, type: string, t: Target, persisted: boolean, warnings: string[]): WriteMeta {
    return { id, type, parentId: t.parent.parentId, boardId: t.parent.boardId, boardUrl: this.url(t.parent.boardId), persisted, warnings };
  }

  private url(boardId: string): string {
    return `${this.be.origin}/${boardId}`;
  }
}

function partial(error: unknown, sent: Sent[]): Error {
  if (!(error instanceof MilanoteError) || !sent.length) return error instanceof Error ? error : new Error(String(error));
  return new MilanoteError(error.code, `${error.message} Bereits angelegt und noch vorhanden: ${sent.map((s) => s.id).join(', ')} (mit get_board prüfen; bei Bedarf in den Papierkorb legen).`);
}

function requireText(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new MilanoteError('args', `${label} ist leer`);
  if (value.length > max) throw new MilanoteError('args', `${label} ist zu lang (${value.length} von höchstens ${max} Zeichen)`);
  return value;
}

function requireHttpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new MilanoteError('args', `Keine gültige URL: ${value}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new MilanoteError('args', 'Nur http- und https-Links sind erlaubt');
  return url.toString();
}
