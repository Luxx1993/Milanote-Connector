// Layout-Strategien. Reine Funktionen: Größen rein, Koordinaten raus (ganze Rastereinheiten, ab 0/0).
// Grundregel: Der Code entscheidet, wo etwas liegt; Claude entscheidet nur, was zusammengehört.
// Jede Strategie liefert überlappungsfreie Ergebnisse; `layout()` prüft das zusätzlich und wirft bei einem Fehler,
// statt ein kaputtes Layout auszugeben.

import { boundsOf, collides, findCollisions, translate, type Box, type KeyedRect, type Rect } from './geometry.ts';

export type Strategy = 'columns' | 'grid' | 'masonry' | 'timeline' | 'radial';
export const STRATEGIES: readonly Strategy[] = ['columns', 'grid', 'masonry', 'timeline', 'radial'];

export interface LayoutNode {
  key: string;
  box: Box;
}

export interface LayoutGroup {
  key: string;
  /** Überschriftskarte (bei „columns“ nicht benutzt) */
  header?: LayoutNode;
  items: LayoutNode[];
}

export interface LayoutOptions {
  strategy: Strategy;
  /** Abstand zwischen Elementen */
  gap: number;
  /** Maximale Breite eines Blocks aus Gruppen, bevor in die nächste Reihe umgebrochen wird */
  maxWidth?: number;
  /** Spalten je Gruppe (grid, masonry) bzw. Spalten je Reihe (columns) */
  columns?: number;
  /** Mittelpunktkarte (nur radial) */
  center?: LayoutNode;
}

export interface LayoutResult {
  rects: KeyedRect[];
  bounds: Rect;
}

export const DEFAULT_MAX_WIDTH = 300;

/** Berechnet das Layout; Koordinaten beginnen bei 0/0. */
export function layout(groups: LayoutGroup[], options: LayoutOptions): LayoutResult {
  const gap = Math.max(1, Math.round(options.gap));
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
  let rects: KeyedRect[];
  switch (options.strategy) {
    case 'columns':
      rects = layoutColumns(groups, gap, options.columns ?? 4, maxWidth);
      break;
    case 'grid':
      rects = packRegions(groups.map((g) => gridRegion(g, gap, options.columns ?? 3)), gap, maxWidth);
      break;
    case 'masonry':
      rects = packRegions(groups.map((g) => masonryRegion(g, gap, options.columns ?? 3)), gap, maxWidth);
      break;
    case 'timeline':
      rects = packRegions(groups.map((g) => timelineRegion(g, gap, maxWidth)), gap, maxWidth, 1);
      break;
    case 'radial':
      if (!options.center) throw new Error('Radial braucht eine Mittelpunktkarte');
      rects = layoutRadial(options.center, groups, gap);
      break;
  }
  const b = boundsOf(rects);
  rects = translate(rects, -b.x, -b.y);
  const clash = findCollisions(rects, 1);
  if (clash.length) throw new Error(`Layout-Fehler (${options.strategy}): ${clash.length} Überlappung(en), z. B. ${clash[0]?.join(' / ')}`);
  return { rects, bounds: boundsOf(rects) };
}

// ---------------------------------------------------------------------------------------------- Bausteine

interface Block {
  key: string;
  w: number;
  h: number;
}

/** Regalpackung: von links nach rechts, bei Platzmangel (oder `perRow`) in die nächste Reihe. */
export function packBlocks(blocks: Block[], opts: { maxWidth: number; gap: number; perRow?: number }): KeyedRect[] {
  const out: KeyedRect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let inRow = 0;
  for (const b of blocks) {
    if (inRow > 0 && (x + b.w > opts.maxWidth || (opts.perRow !== undefined && inRow >= opts.perRow))) {
      x = 0;
      y += rowHeight + opts.gap;
      rowHeight = 0;
      inRow = 0;
    }
    out.push({ key: b.key, x, y, w: b.w, h: b.h });
    x += b.w + opts.gap;
    rowHeight = Math.max(rowHeight, b.h);
    inRow += 1;
  }
  return out;
}

/** Eine Gruppe als eigenes Stück Fläche: relative Rechtecke plus Gesamtgröße. */
interface Region {
  rects: KeyedRect[];
  box: Box;
}

/** Packt Regionen nebeneinander (mit doppeltem Abstand) und gibt alle Rechtecke in absoluten Koordinaten zurück. */
function packRegions(regions: Region[], gap: number, maxWidth: number, perRow?: number): KeyedRect[] {
  const spots = packBlocks(
    regions.map((r, i) => ({ key: String(i), ...r.box })),
    { maxWidth, gap: gap * 2, perRow },
  );
  return regions.flatMap((region, i) => {
    const spot = spots[i] as KeyedRect;
    return translate(region.rects, spot.x, spot.y);
  });
}

function withHeader(group: LayoutGroup): { rects: KeyedRect[]; top: number; width: number } {
  if (!group.header) return { rects: [], top: 0, width: 0 };
  const { key, box } = group.header;
  return { rects: [{ key, x: 0, y: 0, w: box.w, h: box.h }], top: box.h, width: box.w };
}

// ---------------------------------------------------------------------------------------------- columns

/**
 * Gruppen sind Spalten (Milanote-COLUMN): nur die Spalten werden platziert, ihr Inhalt liegt in der Liste.
 * Jede Gruppe trägt dafür genau einen Knoten in `items`: die Gesamtgröße der Spalte.
 */
function layoutColumns(groups: LayoutGroup[], gap: number, perRow: number, maxWidth: number): KeyedRect[] {
  const blocks = groups.map((g) => {
    // Die „Items“ einer Spalte sind hier schon zur Gesamtgröße der Spalte zusammengefasst: ein Knoten je Gruppe.
    const node = g.items[0] ?? g.header;
    if (!node) throw new Error(`Spalte ${g.key} ohne Größe`);
    return { key: node.key, w: node.box.w, h: node.box.h };
  });
  return packBlocks(blocks, { maxWidth: Math.max(maxWidth, 1), gap, perRow: Math.max(1, perRow) });
}

// ---------------------------------------------------------------------------------------------- grid

function gridRegion(group: LayoutGroup, gap: number, columns: number): Region {
  const head = withHeader(group);
  const cols = Math.max(1, Math.min(columns, group.items.length || 1));
  const cellW = Math.max(0, ...group.items.map((i) => i.box.w));
  const rects = [...head.rects];
  let y = head.top ? head.top + gap : 0;
  for (let start = 0; start < group.items.length; start += cols) {
    const row = group.items.slice(start, start + cols);
    row.forEach((item, c) => rects.push({ key: item.key, x: c * (cellW + gap), y, w: item.box.w, h: item.box.h }));
    y += Math.max(...row.map((i) => i.box.h)) + gap;
  }
  const bottom = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0;
  return { rects, box: { w: Math.max(head.width, group.items.length ? cols * cellW + (cols - 1) * gap : 0), h: bottom } };
}

// ---------------------------------------------------------------------------------------------- masonry

function masonryRegion(group: LayoutGroup, gap: number, columns: number): Region {
  const head = withHeader(group);
  const cols = Math.max(1, Math.min(columns, group.items.length || 1));
  const colW = Math.max(0, ...group.items.map((i) => i.box.w));
  const heights = Array.from({ length: cols }, () => (head.top ? head.top + gap : 0));
  const rects = [...head.rects];
  for (const item of group.items) {
    // Reihenfolge bleibt erhalten: immer in die kürzeste Spalte (links gewinnt bei Gleichstand).
    let c = 0;
    for (let i = 1; i < cols; i += 1) if ((heights[i] as number) < (heights[c] as number)) c = i;
    rects.push({ key: item.key, x: c * (colW + gap), y: heights[c] as number, w: item.box.w, h: item.box.h });
    heights[c] = (heights[c] as number) + item.box.h + gap;
  }
  const bottom = rects.length ? Math.max(...rects.map((r) => r.y + r.h)) : 0;
  return { rects, box: { w: Math.max(head.width, group.items.length ? cols * colW + (cols - 1) * gap : 0), h: bottom } };
}

// ---------------------------------------------------------------------------------------------- timeline

/** Eine Bahn je Gruppe: Überschrift links, Einträge in Reihenfolge nach rechts, bei Bedarf in einer neuen Zeile. */
function timelineRegion(group: LayoutGroup, gap: number, maxWidth: number): Region {
  const head = withHeader(group);
  const startX = head.width ? head.width + gap : 0;
  const rects = [...head.rects];
  let x = startX;
  let y = 0;
  let rowHeight = 0;
  for (const item of group.items) {
    if (x > startX && x + item.box.w > maxWidth) {
      x = startX;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    rects.push({ key: item.key, x, y, w: item.box.w, h: item.box.h });
    x += item.box.w + gap;
    rowHeight = Math.max(rowHeight, item.box.h);
  }
  const b = boundsOf(rects);
  return { rects, box: { w: b.w, h: b.h } };
}

// ---------------------------------------------------------------------------------------------- radial

/**
 * Mindmap: Mittelpunkt in der Mitte, Gruppen strahlen gleichmäßig verteilt nach außen (erste Gruppe oben,
 * im Uhrzeigersinn). Jede Karte wird so weit nach außen geschoben, bis sie niemanden berührt.
 */
function layoutRadial(center: LayoutNode, groups: LayoutGroup[], gap: number): KeyedRect[] {
  const placed: KeyedRect[] = [{ key: center.key, x: -Math.round(center.box.w / 2), y: -Math.round(center.box.h / 2), w: center.box.w, h: center.box.h }];
  groups.forEach((group, i) => {
    const theta = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(groups.length, 1);
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    const chain = [...(group.header ? [group.header] : []), ...group.items];
    let radius = 0;
    chain.forEach((node, j) => {
      // Einträge hinter der Überschrift wechseln die Seite, damit die Zweige breiter als lang werden.
      const lateral = j === 0 ? 0 : (j % 2 === 1 ? 1 : -1) * Math.round(node.box.w * 0.55);
      for (let r = Math.max(radius, 4), guard = 0; guard < 5_000; r += 2, guard += 1) {
        const cx = dx * r - dy * lateral;
        const cy = dy * r + dx * lateral;
        const rect: KeyedRect = { key: node.key, x: Math.round(cx - node.box.w / 2), y: Math.round(cy - node.box.h / 2), w: node.box.w, h: node.box.h };
        if (!placed.some((p) => collides(p, rect, gap))) {
          placed.push(rect);
          radius = r + 1;
          return;
        }
      }
      throw new Error(`Radial: kein freier Platz für ${node.key}`);
    });
  });
  return placed;
}
