// Aufbau der Socket-Aktionen (Umschlag und ELEMENT_CREATE) als reine Funktionen.
// Form laut milanote-plus-plus (docs/protocol.md 4.5); in Phase 0 nicht am eigenen Konto verifiziert.

import type { IdGenerator } from './ids.ts';

export type Section = 'CANVAS' | 'INBOX';
export type CanvasPosition = { x: number; y: number; score: number };
export type InboxPosition = { index: number; score: number };
export type ElementType = 'BOARD' | 'CARD' | 'COLUMN' | 'TASK_LIST' | 'TASK' | 'LINK' | 'IMAGE' | 'FILE';

export interface ElementLocation {
  parentId: string;
  section: Section;
  position: CanvasPosition | InboxPosition;
}

export interface ActionContext {
  userId: string;
  ids: IdGenerator;
  platform: string;
  now?: () => number;
}

export type Action = Record<string, unknown> & { type: string };

export const PLATFORM = 'Milanote-Connector';

/** Gemeinsamer Umschlag jeder Aktion. `channels` bestimmt, welche offenen Clients sie live sehen. */
export function envelope(ctx: ActionContext, action: Action): Action {
  const now = (ctx.now ?? Date.now)();
  return {
    sync: true,
    timestamp: now,
    user: { _id: ctx.userId, clientId: ctx.ids.clientId, clientTick: ctx.ids.clientTick },
    tokens: [],
    deviceId: ctx.ids.deviceId,
    sessionId: ctx.ids.sessionId,
    ...action,
  };
}

export interface CreateSpec {
  id: string;
  elementType: ElementType;
  boardId: string;
  location: ElementLocation;
  content: Record<string, unknown>;
}

export function elementCreate(ctx: ActionContext, spec: CreateSpec): Action {
  const now = (ctx.now ?? Date.now)();
  return envelope(ctx, {
    type: 'ELEMENT_CREATE',
    id: spec.id,
    elementType: spec.elementType,
    location: spec.location,
    content: spec.content,
    meta: {
      creator: ctx.userId,
      modifiedBy: ctx.userId,
      createdTime: now,
      modifiedTime: now,
      platform: ctx.platform,
      locationSectionModifiedTime: now,
      versionId: ctx.ids.createVersionId(),
    },
    creationSource: 'TOOLBAR',
    // Boards, die danach befüllt werden, nicht als "fertig geladen" markieren, sonst zeigen offene
    // Tabs sie leer an (milanote-plus-plus).
    markAsFetched: spec.elementType !== 'BOARD',
    timestamp: now,
    activity: { track: false, boardId: spec.boardId },
    channels: [spec.boardId],
  });
}

export interface UpdateSpec {
  id: string;
  elementType: string;
  boardId: string;
  /** `meta.versionId` des Elements vor der Änderung (Milanote prüft die Reihenfolge der Versionen). */
  previousVersionId: string | null;
  changes: Record<string, unknown>;
}

export function elementUpdate(ctx: ActionContext, spec: UpdateSpec): Action {
  return envelope(ctx, {
    type: 'ELEMENT_UPDATE',
    updates: [{ id: spec.id, changes: spec.changes, meta: { modifiedVersionId: spec.previousVersionId, versionId: ctx.ids.nextVersionId() } }],
    recalculateChannels: false,
    activity: { track: false, boardId: spec.boardId, elementTypes: { [spec.id]: spec.elementType } },
    channels: [...new Set([spec.boardId, spec.id])],
  });
}

/** Wandelt ein Element um, z. B. LINK -> IMAGE nach der Link-Vorschau. */
export function elementSetType(ctx: ActionContext, spec: { id: string; elementType: string; boardId: string; changes: Record<string, unknown> }): Action {
  return envelope(ctx, {
    type: 'ELEMENT_SET_TYPE',
    id: spec.id,
    elementType: spec.elementType,
    changes: spec.changes,
    activity: { track: false, boardId: spec.boardId },
    channels: [spec.boardId],
  });
}

export interface Place {
  parentId: string;
  section: string;
  position: unknown;
}

export interface MoveItem {
  id: string;
  elementType: string;
  from: Place;
  to: Place;
}

/**
 * Verschiebt Elemente (ELEMENT_MOVE_MULTI, Form laut milanote-plus-plus). `operation` ist `DROP` für normales
 * Verschieben und `TRASH` für den Papierkorb. milanote-skill nennt die Aktion `ELEMENT_MOVE` mit `location` auf
 * oberster Ebene; welche Form gilt, klärt der Abnahmetest (docs/protocol.md 5c).
 */
export function elementsMove(ctx: ActionContext, spec: { operation: 'DROP' | 'TRASH'; sourceBoardId: string; destinationBoardId: string; items: MoveItem[] }): Action {
  return envelope(ctx, {
    type: 'ELEMENT_MOVE_MULTI',
    moves: spec.items.map((item) => ({ id: item.id, location: item.to, from: item.from })),
    moveOperation: spec.operation,
    monitoring: { operation: spec.operation },
    activity: {
      track: false,
      sourceBoardId: spec.sourceBoardId,
      isSourceShared: false,
      destinationBoardId: spec.destinationBoardId,
      isDestinationShared: false,
      elementTypes: Object.fromEntries(spec.items.map((item) => [item.id, item.elementType])),
    },
    channels: [...new Set([spec.sourceBoardId, spec.destinationBoardId])],
  });
}

export interface TrashItem {
  id: string;
  elementType: string;
  /** Ursprünglicher Ort, wird für „Wiederherstellen“ gespeichert. */
  from: Place;
}

/**
 * Verschiebt Elemente in den Papierkorb ihres Boards (`<boardId>-trash`). Das ist die einzige
 * Art zu entfernen; ELEMENT_DELETE (endgültig) wird nirgends gesendet.
 */
export function elementsToTrash(ctx: ActionContext, boardId: string, items: TrashItem[]): Action {
  const now = (ctx.now ?? Date.now)();
  const trash = `${boardId}-trash`;
  return elementsMove(ctx, {
    operation: 'TRASH',
    sourceBoardId: boardId,
    destinationBoardId: trash,
    items: items.map((item) => ({
      id: item.id,
      elementType: item.elementType,
      from: item.from,
      to: { parentId: trash, section: 'TRASH', position: { addedDate: now, restoreLocation: item.from } },
    })),
  });
}

/** Ack-Antwort prüfen: Milanote antwortet mit `[{status: 200}]`. */
export function ackStatus(args: unknown[]): number | undefined {
  const first = args[0];
  if (first && typeof first === 'object' && 'status' in first) {
    const status = (first as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
