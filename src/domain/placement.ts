// Einfache Platzierung auf der Board-Fläche: neue Elemente rechts neben den vorhandenen Inhalt.
// Einheiten sind Milanote-Rastereinheiten (1 Einheit ≈ 9 px, Standardkarte 34 Einheiten breit).
// Die eigentliche Layout-Engine kommt in Phase 5.

import type { CanvasPosition } from '../protocol/actions.ts';

export const GRID_PX = 9;
export const CARD_WIDTH = 34;
export const GAP = 4;
export const SCORE_STEP = 65_536;

export interface CanvasChild {
  x: number;
  y: number;
  score: number;
  width?: number;
}

export function nextCanvasPosition(children: CanvasChild[], wanted?: { x?: number; y?: number }): CanvasPosition {
  const score = children.reduce((max, c) => Math.max(max, c.score), 0) + SCORE_STEP;
  if (wanted?.x !== undefined && wanted?.y !== undefined) return { x: Math.round(wanted.x), y: Math.round(wanted.y), score };
  if (children.length === 0) return { x: 0, y: 2, score };
  const right = Math.max(...children.map((c) => c.x + (c.width && Number.isFinite(c.width) ? c.width : CARD_WIDTH)));
  const top = Math.min(...children.map((c) => c.y));
  return { x: right + GAP, y: wanted?.y !== undefined ? Math.round(wanted.y) : top, score };
}
