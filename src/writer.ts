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
import { elementCreate, elementSetType, elementUpdate, elementsMove, elementsToTrash, type Action, type ActionContext, type CanvasPosition, type ElementType, type InboxPosition, type Place } from './protocol/actions.ts';
import { isHidden, type RawElement } from './domain/board.ts';
import { boardAbove, canvasChildrenOf, childrenIn, dropTarget, nextInboxPosition, parentInfo, type DropTarget, type Elements, type ParentInfo } from './domain/hierarchy.ts';
import { SCORE_STEP, nextCanvasPosition } from './domain/placement.ts';
import { docToText, textToDoc } from './domain/richtext.ts';
import { planCompose, type ComposeSpec, type Step, type TaskInput } from './layout/compose.ts';
import { estimateBox } from './layout/estimate.ts';
import { collides } from './layout/geometry.ts';
import { DEFAULT_METRICS, type Metrics } from './layout/metrics.ts';

export type { TaskInput };

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
  /** Größenmodell für Layout und Überlappungswarnungen */
  metrics?: Metrics;
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
      metrics: DEFAULT_METRICS,
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
      const position = this.canvasPosition(t, input);
      const warnings: string[] = [];
      const made = await this.makeBoard(t, title, position, warnings);
      return { ...this.meta(made.id, 'BOARD', t, made.persisted, warnings), url: this.url(made.id), title, position: { x: position.x, y: position.y } };
    });
  }

  /** Legt ein Board an und wartet, bis es bereit ist. Nicht exklusiv: nur aus exklusiven Abläufen aufrufen. */
  private async makeBoard(t: Target, title: string, position: CanvasPosition, warnings: string[]): Promise<{ id: string; persisted: boolean }> {
    const user = await this.be.whoami();
    const ctx = this.be.actionContext(user);
    const id = ctx.ids.elementId();
    const content = { title, icon: null, color: null, secondaryColor: null, defaultColorPalette: PALETTES[randomInt(PALETTES.length)] };
    const sent = [await this.create(ctx, t, id, 'BOARD', 'CANVAS', position, content)];
    const persisted = await this.finish(t, sent, warnings);
    if (persisted) await this.waitUntilReady(id, warnings);
    return { id, persisted };
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
      const persisted = await this.finish(t, sent, warnings);
      let previewApplied = false;
      let linkTitle: string | undefined;
      if (persisted) ({ previewApplied, linkTitle } = await this.decorateLink(ctx, user.id, t.parent.boardId, id, url, input.caption, warnings));
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

  // ------------------------------------------------------------------ Verschieben, Ändern, Größe

  /**
   * Verschiebt ein Element: auf eine Position desselben oder eines anderen Boards, in eine Spalte (ans Ende)
   * oder eine Aufgabe in eine andere To-do-Liste. Umsortieren innerhalb einer Liste gibt es nicht.
   */
  moveElement(input: { element: string; parent?: string } & Coordinates): Promise<MoveResult> {
    return this.exclusive(async () => {
      const user = await this.be.whoami();
      const id = this.be.parseRef(input.element);
      this.refuseRoots(user, id);
      if ((input.x === undefined) !== (input.y === undefined)) throw new MilanoteError('args', 'x und y nur zusammen angeben (oder beide weglassen)');
      const targetRef = input.parent ? this.be.parseRef(input.parent) : undefined;
      const loaded = await this.be.loadWithAncestors(targetRef ? [id, targetRef] : [id]);
      const el = this.visibleElement(loaded, id);
      const sourceBoard = boardAbove(loaded, id);
      const loc = el.location;
      if (!sourceBoard || !loc?.parentId || !loc.section) throw new MilanoteError('not_found', `Zu ${id} wurde kein Board gefunden`);
      if (sourceBoard === user.rootBoardId && !this.o.allowHome) throw this.homeLocked('Das Element liegt im Home-Board.');
      const from: Place = { parentId: loc.parentId, section: loc.section, position: loc.position };

      let drop: DropTarget;
      if (targetRef) drop = dropTarget(loaded, id, targetRef);
      else if (loc.section === 'CANVAS' && loaded[loc.parentId]?.elementType === 'BOARD') drop = { parentId: loc.parentId, type: 'BOARD', boardId: loc.parentId };
      else throw new MilanoteError('args', 'Das Element liegt in einer Spalte oder Liste. Gib ein Ziel an (parent), z. B. das Board, um es auf die Fläche zu holen.');
      if (drop.boardId === user.rootBoardId && !this.o.allowHome) throw this.homeLocked('Das Ziel liegt im Home-Board.');

      const { elements } = await this.be.getBoard(drop.boardId);
      const others: Elements = { ...elements };
      delete others[id];
      let to: Place;
      if (drop.type === 'BOARD') {
        const onSameCanvas = drop.parentId === from.parentId && from.section === 'CANVAS';
        if (onSameCanvas && input.x === undefined) throw new MilanoteError('args', 'Gib x und y an, um das Element auf dem Board zu verschieben');
        const siblings = this.canvasKids(others, drop.parentId);
        const top = siblings.reduce((max, c) => Math.max(max, c.score), 0) + SCORE_STEP;
        const position = input.x !== undefined && input.y !== undefined ? { x: Math.round(input.x), y: Math.round(input.y), score: top } : nextCanvasPosition(siblings);
        to = { parentId: drop.parentId, section: 'CANVAS', position };
      } else {
        if (input.x !== undefined) throw new MilanoteError('args', 'In Spalten und Listen gibt es keine x/y-Koordinaten; das Element kommt ans Ende');
        to = { parentId: drop.parentId, section: 'INBOX', position: nextInboxPosition(others, drop.parentId) };
      }

      const warnings: string[] = [];
      const type = el.elementType;
      if (to.section === 'CANVAS') warnings.push(...this.overlapWarnings(el, to.position as CanvasPosition, { ...loaded, ...others }, drop.parentId));
      const base = { id, type, from: placeView(from), to: placeView(to), boardId: drop.boardId, boardUrl: this.url(drop.boardId) };
      if (samePlace(from, to)) return { ...base, persisted: true, warnings: [...warnings, 'Das Element liegt schon dort; es wurde nichts gesendet.'] };

      const ctx = this.be.actionContext(user);
      const acked = await this.submit(elementsMove(ctx, { operation: 'DROP', sourceBoardId: sourceBoard, destinationBoardId: drop.boardId, items: [{ id, elementType: type, from, to }] }));
      const persisted = await this.pollElement(id, (e) => atPlace(e, to));
      this.explain(acked, persisted, id, 'Verschieben', warnings);
      return { ...base, persisted, warnings };
    });
  }

  /** Ändert Text, Titel, Erledigt-Status oder Beschriftung eines Elements (je nach Typ). */
  updateElement(input: { element: string; text?: string; title?: string; done?: boolean; caption?: string }): Promise<{ id: string; type: string; updated: string[]; boardUrl: string; persisted: boolean; warnings: string[] }> {
    return this.exclusive(async () => {
      const user = await this.be.whoami();
      const id = this.be.parseRef(input.element);
      this.refuseRoots(user, id);
      const loaded = await this.be.loadWithAncestors([id]);
      const el = this.visibleElement(loaded, id);
      const board = boardAbove(loaded, id);
      if (!board) throw new MilanoteError('not_found', `Zu ${id} wurde kein Board gefunden`);
      if (board === user.rootBoardId && !this.o.allowHome) throw this.homeLocked('Das Element liegt im Home-Board.');
      const type = el.elementType;
      const ctx = this.be.actionContext(user);
      const given = (['text', 'title', 'done', 'caption'] as const).filter((f) => input[f] !== undefined);
      if (!given.length) throw new MilanoteError('args', 'Nichts zu ändern: text, title, done oder caption angeben');
      const allowed = UPDATABLE[type] ?? [];
      for (const field of given) {
        if (!allowed.includes(field)) throw new MilanoteError('args', `Ein ${type} kennt "${field}" nicht${allowed.length ? `; möglich sind: ${allowed.join(', ')}` : ' und lässt sich so nicht ändern'}`);
      }

      const changes: Record<string, unknown> = {};
      const checks: ((e: RawElement) => boolean)[] = [];
      const key = () => ctx.ids.blockKey();
      if (input.text !== undefined) {
        const doc = textToDoc(requireText(input.text, 'Text', 20_000), key);
        changes.textContent = doc;
        checks.push((e) => docToText(e.content?.textContent) === docToText(doc));
      }
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (type !== 'TASK_LIST') requireText(title, 'Titel', 200);
        if (title.length > 200) throw new MilanoteError('args', 'Titel ist zu lang (höchstens 200 Zeichen)');
        changes.title = title || null;
        if (type === 'TASK_LIST') changes.showTitle = Boolean(title);
        checks.push((e) => (e.content?.title ?? '') === title);
      }
      if (input.done !== undefined) {
        changes.isComplete = input.done;
        checks.push((e) => Boolean(e.content?.isComplete) === input.done);
      }
      if (input.caption !== undefined) {
        const caption = input.caption.trim();
        if (caption) {
          const doc = textToDoc(requireText(caption, 'Beschriftung', 2_000), key);
          Object.assign(changes, { caption: doc, showCaption: true });
          checks.push((e) => docToText(e.content?.caption) === docToText(doc));
        } else {
          Object.assign(changes, { caption: null, showCaption: false });
          checks.push((e) => !docToText(e.content?.caption));
        }
      }

      const previous = typeof el.meta?.versionId === 'string' ? el.meta.versionId : null;
      const warnings: string[] = [];
      const acked = await this.submit(elementUpdate(ctx, { id, elementType: type, boardId: board, previousVersionId: previous, changes }));
      const persisted = await this.pollElement(id, (e) => checks.every((c) => c(e)));
      this.explain(acked, persisted, id, 'Ändern', warnings);
      return { id, type, updated: given, boardUrl: this.url(board), persisted, warnings };
    });
  }

  /**
   * Setzt die Breite eines Elements (content.width). Die Einheit von content.width ist nicht bestätigt (siehe
   * docs/phase5.md); der Abgleich zeigt, ob Milanote den Wert übernimmt.
   */
  resizeElement(input: { element: string; width: number }): Promise<{ id: string; type: string; width: number; boardUrl: string; persisted: boolean; warnings: string[] }> {
    return this.exclusive(async () => {
      const user = await this.be.whoami();
      const id = this.be.parseRef(input.element);
      this.refuseRoots(user, id);
      const width = Math.round(input.width);
      if (!Number.isFinite(width) || width < 10 || width > 400) throw new MilanoteError('args', 'width muss zwischen 10 und 400 liegen');
      const loaded = await this.be.loadWithAncestors([id]);
      const el = this.visibleElement(loaded, id);
      if (!RESIZABLE.has(el.elementType)) throw new MilanoteError('args', `Die Breite eines ${el.elementType} lässt sich nicht ändern; möglich: ${[...RESIZABLE].join(', ')}`);
      const board = boardAbove(loaded, id);
      if (!board) throw new MilanoteError('not_found', `Zu ${id} wurde kein Board gefunden`);
      if (board === user.rootBoardId && !this.o.allowHome) throw this.homeLocked('Das Element liegt im Home-Board.');
      const ctx = this.be.actionContext(user);
      const previous = typeof el.meta?.versionId === 'string' ? el.meta.versionId : null;
      const warnings: string[] = [];
      const acked = await this.submit(elementUpdate(ctx, { id, elementType: el.elementType, boardId: board, previousVersionId: previous, changes: { width } }));
      const persisted = await this.pollElement(id, (e) => Number(e.content?.width) === width);
      this.explain(acked, persisted, id, 'Größe ändern', warnings);
      return { id, type: el.elementType, width, boardUrl: this.url(board), persisted, warnings };
    });
  }

  // ------------------------------------------------------------------ compose_board

  /**
   * Legt Gruppen und Inhalte in einem Rutsch an und ordnet sie nach einer Strategie an. Claude sagt, was zusammengehört;
   * die Layout-Engine bestimmt, wo es liegt. Mit `title` entsteht dafür zuerst ein neues Unterboard, sonst landet der
   * Block rechts neben dem vorhandenen Inhalt (oder bei x/y).
   */
  composeBoard(input: { parent: string; title?: string; spec: ComposeSpec } & Coordinates): Promise<ComposeResult> {
    return this.exclusive(async () => {
      const m = this.o.metrics;
      // Erst prüfen und planen, dann das Netz benutzen: ein ungültiger Auftrag ändert nichts.
      const plan = planCompose(input.spec, m);
      const title = input.title?.trim() ? requireText(input.title, 'Titel', 200) : undefined;
      let t = await this.target(input.parent, false);
      const user = await this.be.whoami();
      const ctx = this.be.actionContext(user);
      const warnings: string[] = [];

      if ((input.x === undefined) !== (input.y === undefined)) throw new MilanoteError('args', 'x und y nur zusammen angeben (oder beide weglassen)');
      let origin: { x: number; y: number };
      let newBoard: { id: string; url: string; title: string } | undefined;
      if (title) {
        const made = await this.makeBoard(t, title, this.canvasPosition(t, input), warnings);
        if (!made.persisted) return { ...this.emptyCompose(t, input.spec.layout), persisted: false, warnings };
        newBoard = { id: made.id, url: this.url(made.id), title };
        t = await this.target(made.id, false);
        origin = { x: 4, y: 4 };
      } else if (input.x !== undefined && input.y !== undefined) {
        origin = { x: Math.round(input.x), y: Math.round(input.y) };
      } else {
        const free = nextCanvasPosition(this.canvasKids(t.elements, t.parent.boardId));
        origin = { x: free.x, y: free.y };
      }

      const top = this.canvasKids(t.elements, t.parent.boardId).reduce((max, c) => Math.max(max, c.score), 0);
      let z = top;
      const ids = new Map<string, string>();
      const sent: Sent[] = [];
      try {
        for (const step of plan.steps) {
          const id = ctx.ids.elementId();
          ids.set(step.key, id);
          const parentId = step.parentKey ? (ids.get(step.parentKey) as string) : t.parent.parentId;
          const position = step.rel && step.section === 'CANVAS' ? { x: origin.x + step.rel.x, y: origin.y + step.rel.y, score: (z += SCORE_STEP) } : { index: step.index ?? 0, score: (step.index ?? 0) * SCORE_STEP };
          sent.push(await this.createChild(ctx, t, parentId, id, step.type, position, this.contentOf(step, ctx), step.section));
        }
      } catch (error) {
        throw partial(error, sent);
      }
      const persisted = await this.finish(t, sent, warnings);

      if (persisted) {
        for (const step of plan.steps.filter((s) => s.kind === 'link')) {
          await this.decorateLink(ctx, user.id, t.parent.boardId, ids.get(step.key) as string, step.url as string, step.caption, warnings);
        }
      }

      const created = plan.steps.map((step) => ({ key: step.key, id: ids.get(step.key) as string, type: step.type, group: step.group }));
      return {
        boardId: t.parent.boardId,
        boardUrl: this.url(t.parent.boardId),
        newBoard,
        layout: input.spec.layout,
        origin,
        size: { w: plan.bounds.w, h: plan.bounds.h },
        count: plan.count,
        groups: input.spec.groups.map((g, gi) => ({ index: gi, title: g.title, elements: plan.steps.filter((s) => s.group === gi).length })),
        created,
        persisted,
        warnings,
      };
    });
  }

  private emptyCompose(t: Target, layout: string): Omit<ComposeResult, 'persisted' | 'warnings'> {
    return { boardId: t.parent.boardId, boardUrl: this.url(t.parent.boardId), layout, origin: { x: 0, y: 0 }, size: { w: 0, h: 0 }, count: 0, groups: [], created: [] };
  }

  private contentOf(step: Step, ctx: ActionContext): Record<string, unknown> {
    const doc = (text: string) => textToDoc(text, () => ctx.ids.blockKey());
    switch (step.kind) {
      case 'column':
        return { title: step.title ?? null };
      case 'header':
      case 'center':
      case 'note':
        return { textContent: doc(step.text ?? '') };
      case 'link':
        return { url: step.url };
      case 'todo':
        return { title: step.title ?? null, showTitle: Boolean(step.title) };
      case 'task':
        return { textContent: doc(step.text ?? ''), ...(step.done ? { isComplete: true } : {}) };
    }
  }

  // ------------------------------------------------------------------ Hilfen für Verschieben und Ändern

  private refuseRoots(user: WriteUser, id: string): void {
    if (id === user.rootBoardId || id === user.quickNotesRootId) throw new MilanoteError('args', `${id} ist ein Wurzel-Board (Home bzw. Schnellnotizen) und lässt sich so nicht ändern.`);
  }

  private visibleElement(elements: Elements, id: string): RawElement {
    const el = elements[id];
    if (!el || el.elementType === 'SKELETON') throw new MilanoteError('not_found', `Element ${id} nicht gefunden oder kein Zugriff`);
    if (isHidden(el)) throw new MilanoteError('args', `Element ${id} liegt im Papierkorb. Stelle es in Milanote zuerst wieder her.`);
    return el;
  }

  private async pollElement(id: string, check: (el: RawElement) => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < this.o.verifyAttempts; attempt += 1) {
      if (attempt > 0) await this.o.sleep(this.o.verifyDelayMs);
      try {
        const el = (await this.be.loadWithAncestors([id]))[id];
        if (el && check(el)) return true;
      } catch {
        /* nächster Versuch */
      }
    }
    return false;
  }

  /** Einheitliche Auswertung von Ack und Abgleich für Ein-Element-Operationen. */
  private explain(acked: boolean, persisted: boolean, id: string, what: string, warnings: string[]): void {
    if (!acked && !persisted) throw new MilanoteError('connection', `${what}: Milanote hat nicht bestätigt, und die Änderung an ${id} ist nicht zu sehen. Vermutlich ist nichts passiert; bitte mit get_board prüfen und erneut versuchen.`);
    if (!acked) warnings.push('Keine Bestätigung von Milanote (Verbindung unterbrochen), die Änderung ist aber angekommen.');
    if (acked && !persisted) warnings.push(`Milanote hat "${what}" bestätigt, die Änderung an ${id} ist per REST aber nicht zu sehen (möglicherweise verworfen oder in anderer Form erwartet). Prüfe mit get_board, bevor du es erneut versuchst.`);
  }

  /** Warnt, wenn das Element an der Zielposition vermutlich andere überdeckt (Größen sind geschätzt). */
  private overlapWarnings(el: RawElement, position: CanvasPosition, elements: Elements, boardId: string): string[] {
    const m = this.o.metrics;
    const box = estimateBox(el, elements, m);
    const mine = { x: position.x, y: position.y, ...box };
    const hits = childrenIn(elements, boardId, 'CANVAS')
      .filter((sib) => sib._id !== el._id && sib.location?.position)
      .filter((sib) => {
        const p = sib.location?.position as Record<string, number>;
        return collides(mine, { x: p.x ?? 0, y: p.y ?? 0, ...estimateBox(sib, elements, m) }, 1);
      })
      .map((sib) => sib._id);
    return hits.length ? [`Das Element überlappt an dieser Position vermutlich ${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ` und ${hits.length - 3} weitere` : ''} (Größen geschätzt, siehe docs/phase5.md).`] : [];
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

  /** Kinder eines Boards auf der Fläche, mit Breiten aus dem Größenmodell (gleiche Annahmen wie das Layout). */
  private canvasKids(elements: Elements, boardId: string) {
    return canvasChildrenOf(elements, boardId, (el) => estimateBox(el, elements, this.o.metrics).w);
  }

  private canvasPosition(t: Target, c: Coordinates): CanvasPosition {
    if ((c.x === undefined) !== (c.y === undefined)) throw new MilanoteError('args', 'x und y nur zusammen angeben (oder beide weglassen)');
    if (t.parent.type !== 'BOARD') throw new MilanoteError('args', 'Dieses Element kann nur direkt auf einem Board liegen, nicht in einer Spalte');
    return nextCanvasPosition(this.canvasKids(t.elements, t.parent.boardId), c);
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

  /** Holt die Link-Vorschau und wendet sie an; ohne Vorschau bleibt der Link, eine Beschriftung kommt per Update. */
  private async decorateLink(ctx: ActionContext, userId: string, boardId: string, id: string, url: string, caption: string | undefined, warnings: string[]): Promise<{ previewApplied: boolean; linkTitle?: string }> {
    const preview = await this.preview(userId, url, id, warnings);
    const captionDoc = caption?.trim() ? textToDoc(caption, () => ctx.ids.blockKey()) : undefined;
    if (!preview) {
      if (captionDoc) {
        await this.tryAction(
          elementUpdate(ctx, { id, elementType: 'LINK', boardId, previousVersionId: ctx.ids.createVersionId(), changes: { caption: captionDoc, showCaption: true } }),
          'Beschriftung konnte nicht gesetzt werden',
          warnings,
        );
      }
      return { previewApplied: false };
    }
    const changes: Record<string, unknown> = {};
    for (const key of ['image', 'mediaType', 'link', 'provider', 'media']) if (preview[key] !== undefined) changes[key] = preview[key];
    const description = typeof preview.description === 'string' && preview.description ? textToDoc(preview.description, () => ctx.ids.blockKey()) : undefined;
    const shown = captionDoc ?? description;
    if (shown) Object.assign(changes, { caption: shown, showCaption: true });
    else changes.showCaption = false;
    const elementType = typeof preview.elementType === 'string' ? preview.elementType : 'LINK';
    const previewApplied = await this.tryAction(elementSetType(ctx, { id, elementType, boardId, changes }), 'Link-Vorschau konnte nicht angewendet werden', warnings);
    const link = preview.link as { title?: unknown } | undefined;
    return { previewApplied, linkTitle: previewApplied && typeof link?.title === 'string' ? link.title : undefined };
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

export interface MoveResult {
  id: string;
  type: string;
  from: PlaceView;
  to: PlaceView;
  boardId: string;
  boardUrl: string;
  persisted: boolean;
  warnings: string[];
}

export interface PlaceView {
  parentId: string;
  section: string;
  x?: number;
  y?: number;
  index?: number;
}

export interface ComposeResult {
  boardId: string;
  boardUrl: string;
  newBoard?: { id: string; url: string; title: string };
  layout: string;
  /** Linke obere Ecke des Blocks auf dem Board (Rastereinheiten) */
  origin: { x: number; y: number };
  /** Größe des Blocks (Rastereinheiten, geschätzt) */
  size: { w: number; h: number };
  count: number;
  groups: { index: number; title?: string; elements: number }[];
  created: { key: string; id: string; type: string; group: number | null }[];
  persisted: boolean;
  warnings: string[];
}

/** Welche Felder `update_element` je Elementtyp ändern darf. */
const UPDATABLE: Record<string, readonly string[]> = {
  CARD: ['text'],
  TASK: ['text', 'done'],
  BOARD: ['title'],
  COLUMN: ['title'],
  TASK_LIST: ['title'],
  LINK: ['caption'],
  IMAGE: ['caption'],
  FILE: ['caption'],
};

const RESIZABLE = new Set(['CARD', 'COLUMN', 'TASK_LIST', 'LINK', 'IMAGE', 'FILE', 'DOCUMENT']);

function placeView(place: Place): PlaceView {
  const p = (place.position ?? {}) as Record<string, number>;
  return place.section === 'CANVAS' ? { parentId: place.parentId, section: place.section, x: p.x, y: p.y } : { parentId: place.parentId, section: place.section, index: p.index };
}

function samePlace(a: Place, b: Place): boolean {
  if (a.parentId !== b.parentId || a.section !== b.section) return false;
  const pa = (a.position ?? {}) as Record<string, number>;
  const pb = (b.position ?? {}) as Record<string, number>;
  return a.section === 'CANVAS' ? pa.x === pb.x && pa.y === pb.y : pa.index === pb.index;
}

function atPlace(el: RawElement, to: Place): boolean {
  return samePlace({ parentId: el.location?.parentId ?? '', section: el.location?.section ?? '', position: el.location?.position }, to);
}
