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

/**
 * Kinder auf der Fläche mit Position und Breite. Ohne gespeicherte Breite fragt `widthOf` (Größenmodell) nach einer
 * Schätzung; fehlt auch die, rechnet die Platzierung mit der Standardkartenbreite.
 */
export function canvasChildrenOf(elements: Elements, boardId: string, widthOf?: (el: RawElement) => number | undefined): CanvasChild[] {
  return childrenIn(elements, boardId, 'CANVAS').map((el) => {
    const p = el.location?.position ?? {};
    const stored = Number(el.content?.width);
    const width = Number.isFinite(stored) && stored > 0 ? stored : widthOf?.(el);
    return { x: p.x ?? 0, y: p.y ?? 0, score: p.score ?? 0, width };
  });
}

/** Nächster Platz am Ende einer Liste (Spalte, To-do-Liste). */
export function nextInboxPosition(elements: Elements, parentId: string): InboxPosition {
  const taken = childrenIn(elements, parentId, 'INBOX').map((el) => el.location?.position?.index ?? -1);
  const index = taken.length ? Math.max(...taken) + 1 : 0;
  return { index, score: index * SCORE_STEP };
}

export interface DropTarget {
  parentId: string;
  type: 'BOARD' | 'COLUMN' | 'TASK_LIST';
  /** Board, auf dessen Kanal geschrieben wird */
  boardId: string;
}

/**
 * Prüft, ob `elementId` dorthin verschoben werden darf (Regeln wie in milanote-plus-plus):
 * Boards nur auf Boards, Spalten nur auf Boards, Aufgaben nur in To-do-Listen und umgekehrt,
 * nie in sich selbst oder einen Nachfahren.
 */
export function dropTarget(elements: Elements, elementId: string, targetId: string): DropTarget {
  const el = elements[elementId];
  const target = elements[targetId];
  if (!el) throw new MilanoteError('not_found', `Element ${elementId} nicht gefunden oder kein Zugriff`);
  if (!target || target.elementType === 'SKELETON') throw new MilanoteError('not_found', `Ziel ${targetId} nicht gefunden oder kein Zugriff`);
  if (isHidden(target)) throw new MilanoteError('args', `Ziel ${targetId} liegt im Papierkorb`);
  const type = target.elementType;
  if (type !== 'BOARD' && type !== 'COLUMN' && type !== 'TASK_LIST') {
    throw new MilanoteError('args', `Ziel ${targetId} ist ein ${type}; verschoben werden kann nur auf ein Board, in eine Spalte oder in eine To-do-Liste`);
  }
  if (targetId === elementId || isAncestor(elements, elementId, targetId)) throw new MilanoteError('args', 'Ein Element kann nicht in sich selbst oder in einen eigenen Nachfahren verschoben werden');
  if (el.elementType === 'TASK' && type !== 'TASK_LIST') throw new MilanoteError('args', 'Aufgaben können nur in eine To-do-Liste verschoben werden');
  if (type === 'TASK_LIST' && el.elementType !== 'TASK') throw new MilanoteError('args', `In eine To-do-Liste passen nur Aufgaben, kein ${el.elementType}`);
  if (type === 'COLUMN' && el.elementType === 'COLUMN') throw new MilanoteError('args', 'Spalten können nicht in Spalten liegen');
  if (el.elementType === 'COLUMN' && type !== 'BOARD') throw new MilanoteError('args', 'Spalten können nur auf ein Board verschoben werden');
  if (el.elementType === 'BOARD' && type !== 'BOARD') throw new MilanoteError('args', 'Boards können nur auf ein anderes Board verschoben werden');
  const boardId = type === 'BOARD' ? targetId : boardAbove(elements, targetId);
  if (!boardId) throw new MilanoteError('not_found', `Zu ${targetId} wurde kein Board gefunden`);
  return { parentId: targetId, type, boardId };
}

/** Liegt `maybeAncestor` irgendwo oberhalb von `id`? */
export function isAncestor(elements: Elements, maybeAncestor: string, id: string): boolean {
  let parent = elements[id]?.location?.parentId;
  for (let hops = 0; parent && hops < 30; hops += 1) {
    if (parent === maybeAncestor) return true;
    parent = elements[parent]?.location?.parentId;
  }
  return false;
}
