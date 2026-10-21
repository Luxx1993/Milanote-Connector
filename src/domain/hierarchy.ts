// Eltern-Auflösung für Schreibvorgänge: In welches Board gehört ein Element, und wohin kommt ein
// neues Kind (Fläche eines Boards oder Liste einer Spalte)? Reine Funktionen über das `elements`-Objekt
// von /api/boards bzw. /api/elements?loadAncestors=true.

import { isHidden, type RawElement } from './board.ts';
import type { CanvasChild } from './placement.ts';
import type { InboxPosition } from '../protocol/actions.ts';
import { SCORE_STEP } from './placement.ts';
import { MilanoteError } from '../errors.ts';

export type Elements = Record<string, RawElement>;

/** Das nächste BOARD oberhalb eines Elements (das Element selbst zählt nicht). */
export function boardAbove(elements: Elements, id: string): string | undefined {
  let parent = elements[id]?.location?.parentId;
  for (let hops = 0; parent && hops < 30; hops += 1) {
    const el = elements[parent];
    if (!el) return undefined;
    if (el.elementType === 'BOARD') return parent;
    parent = el.location?.parentId;
  }
  return undefined;
}

export interface ParentInfo {
  parentId: string;
  type: 'BOARD' | 'COLUMN';
  /** Board, auf dessen Kanal geschrieben wird (bei einem Board: das Board selbst). */
  boardId: string;
}

/** Prüft, ob ein Element als Eltern für Notizen, Links, Listen und Spalten taugt. */
export function parentInfo(elements: Elements, parentId: string, allowColumn = true): ParentInfo {
  const el = elements[parentId];
  if (!el || el.elementType === 'SKELETON') throw new MilanoteError('not_found', `Element ${parentId} nicht gefunden oder kein Zugriff`);
  if (isHidden(el)) throw new MilanoteError('args', `Element ${parentId} liegt im Papierkorb`);
  if (el.elementType === 'BOARD') return { parentId, type: 'BOARD', boardId: parentId };
  if (el.elementType === 'COLUMN' && allowColumn) {
    const boardId = boardAbove(elements, parentId);
    if (!boardId) throw new MilanoteError('not_found', `Zu Spalte ${parentId} wurde kein Board gefunden`);
    return { parentId, type: 'COLUMN', boardId };
  }
  throw new MilanoteError('args', `${parentId} ist ein ${el.elementType}; als Ziel ${allowColumn ? 'sind nur Board und Spalte' : 'ist nur ein Board'} erlaubt`);
}

/** Sichtbare Kinder eines Elements in einer Section. */
export function childrenIn(elements: Elements, parentId: string, section: 'CANVAS' | 'INBOX'): RawElement[] {
  return Object.values(elements).filter((el) => el.location?.parentId === parentId && el.location.section === section && !isHidden(el) && el.elementType !== 'SKELETON');
}

export function canvasChildrenOf(elements: Elements, boardId: string): CanvasChild[] {
  return childrenIn(elements, boardId, 'CANVAS').map((el) => {
    const p = el.location?.position ?? {};
    const width = Number(el.content?.width);
    return { x: p.x ?? 0, y: p.y ?? 0, score: p.score ?? 0, width: Number.isFinite(width) && width > 0 ? width : undefined };
  });
}

/** Nächster Platz am Ende einer Liste (Spalte, To-do-Liste). */
export function nextInboxPosition(elements: Elements, parentId: string): InboxPosition {
  const taken = childrenIn(elements, parentId, 'INBOX').map((el) => el.location?.position?.index ?? -1);
  const index = taken.length ? Math.max(...taken) + 1 : 0;
  return { index, score: index * SCORE_STEP };
}
