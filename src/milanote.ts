// Fassade über Session (CDP + Brückentab) und Protokoll (REST + Socket.IO).
// Tools und CLI sprechen nur mit dieser Klasse.

import { CdpConnection, browserWsUrl } from './session/cdp.ts';
import { MILANOTE_ORIGIN, PageBridge } from './session/bridge.ts';
import { SocketClient, SocketError } from './protocol/socket.ts';
import { IdGenerator } from './protocol/ids.ts';
import { PLATFORM, ackStatus, elementCreate, type Action, type ActionContext, type CanvasPosition } from './protocol/actions.ts';
import { textToDoc } from './domain/richtext.ts';
import { nextCanvasPosition, type CanvasChild } from './domain/placement.ts';
import { holderBoard, isHidden, normalizeBoard, titleOf, type BoardView, type RawElement } from './domain/board.ts';
import { MilanoteError } from './errors.ts';

export type { BoardView, RawElement } from './domain/board.ts';

export interface MilanoteUser {
  id: string;
  displayName: string;
  rootBoardId: string;
  quickNotesRootId?: string;
}

export interface BoardTreeNode {
  id: string;
  title: string | null;
  children: BoardTreeNode[];
  /** Dieses Board wurde wegen Tiefe oder Gesamtgrenze nicht geladen; es kann weitere Unterboards haben. */
  more?: boolean;
  error?: string;
}

export interface SearchResult {
  boardId: string;
  title: string | null;
  path: string[];
  modifiedTime?: number;
  matches: { elementId?: string; type?: string; snippet: string }[];
}

export interface ConnectOptions {
  port?: number;
  log?: (message: string) => void;
}

export interface CreateNoteInput {
  boardId: string;
  text: string;
  x?: number;
  y?: number;
  /** Schreiben ins Home-Board ist ohne ausdrückliche Freigabe gesperrt. */
  allowHome?: boolean;
}

export interface CreatedElement {
  id: string;
  boardId: string;
  position: CanvasPosition;
  /** Milanote hat die Aktion mit Status 200 bestätigt. */
  acknowledged: boolean;
  /** Das Element ist danach per REST lesbar (unter dem richtigen Board, nicht im Papierkorb). */
  persisted: boolean;
  boardUrl: string;
}

const ELEMENT_ID = /^[0-9A-Za-z]{10,20}$/;

/** Akzeptiert eine Board-ID oder eine Milanote-URL (https://app.milanote.com/<id>/…). */
export function parseBoardRef(input: string): string {
  const trimmed = input.trim();
  let candidate = trimmed;
  if (/^https?:\/\//.test(trimmed)) {
    const url = new URL(trimmed);
    if (url.hostname !== 'app.milanote.com') throw new MilanoteError('args', `Keine Milanote-URL: ${trimmed}`);
    candidate = url.pathname.split('/').filter(Boolean)[0] ?? '';
  }
  if (!ELEMENT_ID.test(candidate)) throw new MilanoteError('args', `Ungültige Board-ID: ${input}`);
  return candidate;
}

export class MilanoteClient {
  private readonly ids = new IdGenerator();
  private user: MilanoteUser | undefined;
  private socketClient: SocketClient | undefined;

  private constructor(
    private readonly cdp: CdpConnection,
    private readonly bridge: PageBridge,
    private readonly log: (message: string) => void,
  ) {}

  static async connect(options: ConnectOptions = {}): Promise<MilanoteClient> {
    const log = options.log ?? (() => undefined);
    let cdp: CdpConnection;
    try {
      cdp = await CdpConnection.connect(await browserWsUrl(options.port ?? 9222));
    } catch (error) {
      throw new MilanoteError('browser', error instanceof Error ? error.message : String(error));
    }
    try {
      const bridge = await PageBridge.open(cdp);
      const client = new MilanoteClient(cdp, bridge, log);
      await client.whoami();
      return client;
    } catch (error) {
      cdp.close();
      if (error instanceof MilanoteError) throw error;
      throw new MilanoteError('browser', `Brückentab nicht nutzbar: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  close(): void {
    this.socketClient?.close();
    this.cdp.close();
  }

  async whoami(): Promise<MilanoteUser> {
    if (this.user) return this.user;
    const data = await this.rest<{ user?: Record<string, unknown> }>('GET', '/api/users/me');
    const u = data.user;
    if (!u || typeof u._id !== 'string') throw new MilanoteError('http', 'Unerwartete Antwort von /api/users/me');
    const name = (u.name as { displayName?: string } | undefined)?.displayName;
    this.user = {
      id: u._id,
      displayName: typeof name === 'string' ? name : '',
      rootBoardId: String(u.rootBoardId ?? ''),
      quickNotesRootId: typeof u.quickNotesRootId === 'string' ? u.quickNotesRootId : undefined,
    };
    return this.user;
  }

  /** Board mit Unterbaum (ohne Inhalte der Unterboards). */
  async getBoard(boardId: string): Promise<{ board: RawElement; elements: Record<string, RawElement> }> {
    const query = new URLSearchParams({ excludeSelf: 'false', loadAncestors: 'false', ids: boardId });
    const data = await this.rest<{ elements?: Record<string, RawElement>; errors?: Record<string, unknown> }>('GET', `/api/boards?${query}`);
    if (data.errors?.[boardId]) throw new MilanoteError('not_found', `Board ${boardId} nicht ladbar: ${JSON.stringify(data.errors[boardId]).slice(0, 200)}`);
    const elements = data.elements ?? {};
    const board = elements[boardId];
    if (!board) throw new MilanoteError('not_found', `Board ${boardId} nicht gefunden oder kein Zugriff`);
    if (board.elementType === 'SKELETON') throw new MilanoteError('auth', `Kein Zugriff auf Board ${boardId} (nur Platzhalter geliefert)`);
    return { board, elements };
  }

  /** Mehrere Boards in einer Anfrage; Rückgabe ist das zusammengeführte `elements`-Objekt. */
  async getBoards(boardIds: string[]): Promise<{ elements: Record<string, RawElement>; errors: Record<string, unknown> }> {
    const query = new URLSearchParams({ excludeSelf: 'false', loadAncestors: 'false', ids: boardIds.join(',') });
    const data = await this.rest<{ elements?: Record<string, RawElement>; errors?: Record<string, unknown> }>('GET', `/api/boards?${query}`);
    return { elements: data.elements ?? {}, errors: data.errors ?? {} };
  }

  /** Board-Inhalt als Baum (Spalten/Listen mit Kindern), Papierkorb ausgeblendet. */
  async readBoard(boardRef: string, maxElements = 500): Promise<BoardView> {
    const boardId = parseBoardRef(boardRef);
    const { elements } = await this.getBoard(boardId);
    return normalizeBoard(boardId, elements, MILANOTE_ORIGIN, maxElements);
  }

  /** Direkte Unterboards eines Boards (Standard: Home-Board). */
  async listBoards(parentRef?: string): Promise<{ parent: { id: string; title: string | null }; boards: { id: string; title: string | null; url: string }[] }> {
    const parentId = parentRef ? parseBoardRef(parentRef) : (await this.whoami()).rootBoardId;
    const view = await this.readBoard(parentId, 0);
    return {
      parent: { id: parentId, title: view.board.title },
      boards: view.childBoards.map((b) => ({ ...b, url: `${MILANOTE_ORIGIN}/${b.id}` })),
    };
  }

  /** Board-Hierarchie ebenenweise, je Ebene gebündelte Anfragen. */
  async getBoardTree(rootRef?: string, maxDepth = 3, maxBoards = 150): Promise<{ root: BoardTreeNode; boardsLoaded: number; complete: boolean }> {
    const rootId = rootRef ? parseBoardRef(rootRef) : (await this.whoami()).rootBoardId;
    const root: BoardTreeNode = { id: rootId, title: null, children: [] };
    const nodes = new Map<string, BoardTreeNode>([[rootId, root]]);
    let level: BoardTreeNode[] = [root];
    let loaded = 0;
    let complete = true;

    for (let depth = 0; level.length; depth += 1) {
      const next: BoardTreeNode[] = [];
      for (let i = 0; i < level.length; i += 20) {
        const batch = level.slice(i, i + 20);
        const ids = new Set(batch.map((n) => n.id));
        const { elements, errors } = await this.getBoards([...ids]);
        loaded += batch.length;
        for (const node of batch) {
          const own = elements[node.id];
          if (errors[node.id] || !own) node.error = 'nicht ladbar';
          else node.title = titleOf(own);
        }
        for (const el of Object.values(elements)) {
          if (el.elementType !== 'BOARD' || ids.has(el._id) || isHidden(el) || nodes.has(el._id)) continue;
          const holder = holderBoard(el, elements, ids);
          const parent = holder ? nodes.get(holder) : undefined;
          if (!parent) continue;
          const child: BoardTreeNode = { id: el._id, title: titleOf(el), children: [] };
          parent.children.push(child);
          nodes.set(child.id, child);
          if (depth + 1 < maxDepth && loaded + next.length < maxBoards) next.push(child);
          else {
            child.more = true;
            complete = false;
          }
        }
      }
      level = next;
    }
    return { root, boardsLoaded: loaded, complete };
  }

  async search(query: string, offset = 0, sort: 'viewed' | 'modified' = 'viewed'): Promise<{ total: number; offset: number; results: SearchResult[] }> {
    if (!query.trim()) throw new MilanoteError('args', 'Suchbegriff ist leer');
    const params = new URLSearchParams({ query, offset: String(offset), sort, locale: 'en-US' });
    const raw = await this.rest<{ total?: number; offset?: number; results?: Record<string, unknown>[] }>('GET', `/api/boards/search?${params}`);
    return {
      total: typeof raw.total === 'number' ? raw.total : (raw.results?.length ?? 0),
      offset: typeof raw.offset === 'number' ? raw.offset : offset,
      results: (raw.results ?? []).map(toSearchResult),
    };
  }

  async getElement(id: string): Promise<RawElement | undefined> {
    const query = new URLSearchParams({ ids: id, loadAncestors: 'false' });
    const data = await this.rest<{ elements?: Record<string, RawElement> }>('GET', `/api/elements?${query}`);
    return data.elements?.[id];
  }

  async createNote(input: CreateNoteInput): Promise<CreatedElement> {
    const user = await this.whoami();
    const boardId = parseBoardRef(input.boardId);
    if (boardId === user.rootBoardId && !input.allowHome) {
      throw new MilanoteError('args', 'Das ist das Home-Board. Schreiben dorthin ist gesperrt; bitte ein Test- oder Unterboard angeben.');
    }
    if (!input.text.trim()) throw new MilanoteError('args', 'Der Notiztext ist leer');
    const { board, elements } = await this.getBoard(boardId);
    if (board.elementType !== 'BOARD') throw new MilanoteError('args', `${boardId} ist kein Board, sondern ${board.elementType}`);

    const position = nextCanvasPosition(canvasChildren(elements, boardId), { x: input.x, y: input.y });
    const id = this.ids.elementId();
    const action = elementCreate(this.context(user), {
      id,
      elementType: 'CARD',
      boardId,
      location: { parentId: boardId, section: 'CANVAS', position },
      content: { textContent: textToDoc(input.text, () => this.ids.blockKey()) },
    });
    await this.sendAction(action);
    const persisted = await this.waitForElement(id, boardId);
    return { id, boardId, position, acknowledged: true, persisted, boardUrl: `${MILANOTE_ORIGIN}/${boardId}` };
  }

  /** Testet nur den Socket-Handshake (ohne zu schreiben). */
  async checkSocket(): Promise<void> {
    await this.whoami();
    try {
      await this.socket().connect();
    } catch (error) {
      throw new MilanoteError('connection', error instanceof Error ? error.message : String(error));
    }
  }

  private async sendAction(action: Action): Promise<void> {
    let args: unknown[];
    try {
      args = await this.socket().emit('action', action);
    } catch (error) {
      if (error instanceof SocketError) throw new MilanoteError('connection', error.message);
      throw error;
    }
    const status = ackStatus(args);
    if (status !== 200) {
      throw new MilanoteError('rejected', `Milanote hat ${action.type} abgelehnt: ${JSON.stringify(args).slice(0, 300)}`);
    }
  }

  /** Prüft per REST, ob das Element gespeichert ist (Ack 200 allein reicht laut milanote-skill nicht). */
  private async waitForElement(id: string, parentId: string, attempts = 6, delayMs = 500): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      const element = await this.getElement(id).catch(() => undefined);
      const section = element?.location?.section;
      if (element && element.location?.parentId === parentId && section !== 'TRASH' && section !== 'DELETED') return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  private socket(): SocketClient {
    if (!this.socketClient) {
      const userId = this.user?.id;
      if (!userId) throw new MilanoteError('auth', 'Nutzer unbekannt; whoami zuerst');
      this.socketClient = new SocketClient((url) => this.bridge.openSocket(url), {
        url: `wss://app.milanote.com/socket.io/?userId=${encodeURIComponent(userId)}&EIO=4&transport=websocket`,
        log: this.log,
      });
    }
    return this.socketClient;
  }

  private context(user: MilanoteUser): ActionContext {
    return { userId: user.id, ids: this.ids, platform: PLATFORM };
  }

  private async rest<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const res = await this.bridge.http(method, path, body);
    if (res.waf && !retried) {
      this.log(`WAF-Challenge bei ${path}, erneuere Token`);
      await this.bridge.refreshWafToken().catch(() => false);
      return this.rest<T>(method, path, body, true);
    }
    if (res.status === 429 && !retried) {
      await new Promise((r) => setTimeout(r, 2_000));
      return this.rest<T>(method, path, body, true);
    }
    if (res.status === 401) {
      throw new MilanoteError('auth', 'Im Debug-Chrome ist niemand bei Milanote angemeldet. Bitte im Fenster von `npm run chrome` anmelden und erneut versuchen.');
    }
    if (res.tooLong) throw new MilanoteError('http', `Antwort von ${path} ist zu groß`);
    if (res.status < 200 || res.status >= 300) {
      throw new MilanoteError(res.status === 404 ? 'not_found' : 'http', `Milanote ${method} ${path.split('?')[0]}: HTTP ${res.status} ${res.text.slice(0, 200)}`);
    }
    try {
      return (res.text ? JSON.parse(res.text) : {}) as T;
    } catch {
      throw new MilanoteError('http', `Milanote ${method} ${path.split('?')[0]} lieferte kein JSON (HTTP ${res.status})`);
    }
  }
}

export function canvasChildren(elements: Record<string, RawElement>, boardId: string): CanvasChild[] {
  const out: CanvasChild[] = [];
  for (const el of Object.values(elements)) {
    if (el.location?.parentId !== boardId || el.location.section !== 'CANVAS') continue;
    const p = el.location.position ?? {};
    const width = Number(el.content?.width);
    out.push({ x: p.x ?? 0, y: p.y ?? 0, score: p.score ?? 0, width: Number.isFinite(width) && width > 0 ? width : undefined });
  }
  return out;
}

/** Form laut luscoma/milanote-mcp; unbekannte Felder werden ignoriert. */
export function toSearchResult(result: Record<string, unknown>): SearchResult {
  const board = (result.board ?? {}) as RawElement & { _id?: string };
  const ancestors = Array.isArray(result.ancestors) ? (result.ancestors as { content?: { title?: unknown }; title?: unknown }[]) : [];
  const hits = Array.isArray(result.innerHits) ? (result.innerHits as Record<string, unknown>[]) : [];
  const modified = result.modifiedTime ?? board.meta?.modifiedTime;
  return {
    boardId: String(result._id ?? board._id ?? ''),
    title: board._id ? titleOf(board) : typeof result.title === 'string' ? result.title : null,
    path: ancestors
      .slice()
      .reverse()
      .map((a) => a.title ?? a.content?.title)
      .filter((t): t is string => typeof t === 'string' && t !== ''),
    modifiedTime: typeof modified === 'number' ? modified : undefined,
    matches: hits.map((hit) => ({
      elementId: typeof hit._id === 'string' ? hit._id : undefined,
      type: typeof hit.elementType === 'string' ? hit.elementType : undefined,
      snippet: (Array.isArray(hit.content) ? hit.content : [hit.content])
        .filter((part): part is string => typeof part === 'string' && part !== '')
        .join(' … ')
        .replace(/\[hit\]|\[\/hit\]/g, '**'),
    })),
  };
}
