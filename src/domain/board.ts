// Rohdaten aus /api/boards in eine handliche Form bringen: Elemente mit Typ, Text, Position und Größe,
// Spalten und To-do-Listen mit ihren Kindern in Listenreihenfolge, Papierkorb ausgeblendet.

import { docToText } from './richtext.ts';
import { CARD_WIDTH } from './placement.ts';

export interface RawElement {
  _id: string;
  elementType: string;
  location?: { parentId?: string; section?: string; position?: Record<string, number> };
  content?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface BoardElement {
  id: string;
  type: string;
  /** Freie Position auf der Fläche (Rastereinheiten, 1 ≈ 9 px). */
  position?: { x: number; y: number };
  /** Platz in einer Liste (Spalte, To-do-Liste, „Unsorted“). */
  index?: number;
  /** Breite/Höhe in Rastereinheiten; `estimated`, wenn Milanote keinen Wert speichert. */
  size: { width: number | null; height: number | null; estimated: boolean };
  title?: string;
  text?: string;
  caption?: string;
  url?: string;
  imageUrl?: string;
  done?: boolean;
  color?: string;
  /** Ziel eines Alias (verknüpftes Board). */
  linkTo?: string;
  children?: BoardElement[];
}

export interface BoardView {
  board: { id: string; title: string | null; url: string };
  elements: BoardElement[];
  /** Direkte Unterboards (auch solche in Spalten). */
  childBoards: { id: string; title: string | null }[];
  counts: Record<string, number>;
  /** true, wenn wegen `maxElements` nicht alles ausgegeben wurde. */
  truncated: boolean;
}

const HIDDEN_SECTIONS = new Set(['TRASH', 'DELETED']);
// Typen, deren Breite ohne gespeicherten Wert der Standardkarte entspricht.
const CARD_LIKE = new Set(['CARD', 'COLUMN', 'TASK_LIST', 'LINK', 'DOCUMENT', 'FILE']);
const MAX_TEXT = 4_000;

export function isHidden(el: RawElement): boolean {
  const section = el.location?.section ?? '';
  return HIDDEN_SECTIONS.has(section) || (el.location?.parentId ?? '').endsWith('-trash');
}

export function titleOf(el: RawElement): string | null {
  const c = el.content ?? {};
  if (el.elementType === 'LINK') {
    const link = c.link as { title?: unknown } | undefined;
    if (typeof link?.title === 'string' && link.title) return link.title;
  }
  for (const key of ['title', 'originalTitle', 'name']) if (typeof c[key] === 'string' && c[key]) return c[key] as string;
  return null;
}

export function normalizeElement(el: RawElement): BoardElement {
  const c = el.content ?? {};
  const pos = el.location?.position ?? {};
  const out = { id: el._id, type: el.elementType } as BoardElement;
  if (el.location?.section === 'CANVAS') out.position = { x: num(pos.x), y: num(pos.y) };
  else if (typeof pos.index === 'number') out.index = pos.index;
  out.size = sizeOf(el);

  const title = titleOf(el);
  if (title) out.title = title;
  const text = clip(docToText(c.textContent));
  if (text) out.text = text;
  const caption = clip(docToText(c.caption));
  if (caption) out.caption = caption;
  if (typeof c.color === 'string' && c.color) out.color = c.color;

  if (el.elementType === 'TASK') out.done = Boolean(c.isComplete);
  if (el.elementType === 'ALIAS' && typeof c.linkTo === 'string') out.linkTo = c.linkTo;
  if (el.elementType === 'LINK') {
    const link = c.link as { url?: unknown } | undefined;
    const provider = c.provider as { url?: unknown } | undefined;
    const url = [link?.url, c.url, provider?.url].find((u) => typeof u === 'string' && u);
    if (typeof url === 'string') out.url = url;
  }
  const image = c.image as Record<string, unknown> | undefined;
  const imageUrl = image && [image.original, image.regular, image.large].find((u) => typeof u === 'string' && u);
  if (typeof imageUrl === 'string') out.imageUrl = imageUrl;
  const file = c.file as { url?: unknown } | undefined;
  if (el.elementType === 'FILE' && typeof file?.url === 'string') out.url = file.url;
  return out;
}

/** Baut die Ansicht eines Boards aus dem `elements`-Objekt von /api/boards. */
export function normalizeBoard(boardId: string, elements: Record<string, RawElement>, origin: string, maxElements = 500): BoardView {
  const board = elements[boardId];
  const byParent = new Map<string, RawElement[]>();
  for (const el of Object.values(elements)) {
    if (el._id === boardId || isHidden(el) || el.elementType === 'SKELETON') continue;
    const parent = el.location?.parentId;
    if (!parent) continue;
    byParent.set(parent, [...(byParent.get(parent) ?? []), el]);
  }

  let emitted = 0;
  let truncated = false;
  const counts: Record<string, number> = {};
  // Unabhängig von `maxElements`: alle Unterboards, auch solche in Spalten.
  const own = new Set([boardId]);
  const childBoards = Object.values(elements)
    .filter((el) => el.elementType === 'BOARD' && el._id !== boardId && !isHidden(el) && holderBoard(el, elements, own) === boardId)
    .sort(order)
    .map((el) => ({ id: el._id, title: titleOf(el) }));

  const build = (parentId: string, depth: number): BoardElement[] => {
    const kids = (byParent.get(parentId) ?? []).sort(order);
    const out: BoardElement[] = [];
    for (const kid of kids) {
      counts[kid.elementType] = (counts[kid.elementType] ?? 0) + 1;
      if (emitted >= maxElements) {
        truncated = true;
        continue;
      }
      emitted += 1;
      const node = normalizeElement(kid);
      // Unterboards bringen ihre Inhalte hier nicht mit (eigener Aufruf); Spalten und Listen schon.
      if (kid.elementType !== 'BOARD' && depth < 8) {
        const children = build(kid._id, depth + 1);
        if (children.length) node.children = children;
      }
      out.push(node);
    }
    return out;
  };

  const top = build(boardId, 0);
  return {
    board: { id: boardId, title: board ? titleOf(board) : null, url: `${origin}/${boardId}` },
    elements: top,
    childBoards,
    counts,
    truncated,
  };
}

/** Zu welchem der angefragten Boards gehört ein Element? (Elternkette hoch bis zu einem Board.) */
export function holderBoard(el: RawElement, elements: Record<string, RawElement>, boardIds: Set<string>): string | undefined {
  let parent = el.location?.parentId;
  for (let hops = 0; parent && hops < 20; hops += 1) {
    if (boardIds.has(parent)) return parent;
    parent = elements[parent]?.location?.parentId;
  }
  return undefined;
}

function order(a: RawElement, b: RawElement): number {
  const pa = a.location?.position ?? {};
  const pb = b.location?.position ?? {};
  if (a.location?.section === 'CANVAS' && b.location?.section === 'CANVAS') return num(pa.y) - num(pb.y) || num(pa.x) - num(pb.x);
  if (a.location?.section !== b.location?.section) return a.location?.section === 'CANVAS' ? -1 : 1;
  return num(pa.index ?? pa.score) - num(pb.index ?? pb.score);
}

function sizeOf(el: RawElement): BoardElement['size'] {
  const c = el.content ?? {};
  const width = positive(c.width);
  const height = positive(c.height);
  if (width !== null) return { width, height, estimated: false };
  return { width: CARD_LIKE.has(el.elementType) ? CARD_WIDTH : null, height, estimated: true };
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT)} …[gekürzt]` : trimmed;
}
