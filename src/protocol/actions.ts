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

/** Ack-Antwort prüfen: Milanote antwortet mit `[{status: 200}]`. */
export function ackStatus(args: unknown[]): number | undefined {
  const first = args[0];
  if (first && typeof first === 'object' && 'status' in first) {
    const status = (first as { status: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}
