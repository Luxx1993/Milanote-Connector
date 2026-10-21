// Größenmodell: wie viel Platz braucht eine Karte? Milanote speichert Höhen nicht (automatische Höhe), und die
// Quellen widersprechen sich bei der Einheit (docs/phase5.md). Die Standardwerte sind deshalb bewusst großzügig:
// lieber zu viel Abstand als überlappende Karten. Mit `npm run spike -- measure` lassen sie sich am eigenen Board
// nachmessen und über MILANOTE_METRICS_FILE überschreiben.

import { readFileSync } from 'node:fs';
import type { Box } from './geometry.ts';

export interface Metrics {
  /** Breiten in Rastereinheiten */
  noteWidth: number;
  columnWidth: number;
  taskListWidth: number;
  linkWidth: number;
  imageWidth: number;
  boardWidth: number;
  /** Zeichen je Zeile in einer Karte (kleiner = vorsichtiger) */
  charsPerLine: number;
  /** Höhe einer Textzeile */
  lineHeight: number;
  /** Innenabstand oben + unten einer Karte */
  padding: number;
  paragraphGap: number;
  /** Höhe einer Aufgabe mit einer Zeile */
  taskHeight: number;
  /** Kopfzeile einer Spalte / eines Listentitels */
  headerHeight: number;
  linkHeight: number;
  imageHeight: number;
  boardHeight: number;
  /** Abstand zwischen Karten in einer Spalte */
  itemGap: number;
  /** Abstand zwischen Elementen auf der Fläche */
  gap: number;
  /** Faktor auf alle geschätzten Höhen */
  heightScale: number;
}

export const DEFAULT_METRICS: Metrics = {
  noteWidth: 40,
  columnWidth: 40,
  taskListWidth: 40,
  linkWidth: 40,
  imageWidth: 40,
  boardWidth: 34,
  charsPerLine: 32,
  lineHeight: 3,
  padding: 5,
  paragraphGap: 2,
  taskHeight: 5,
  headerHeight: 7,
  linkHeight: 36,
  imageHeight: 30,
  boardHeight: 24,
  itemGap: 3,
  gap: 4,
  heightScale: 1,
};

export function loadMetrics(file = process.env.MILANOTE_METRICS_FILE): Metrics {
  if (!file) return DEFAULT_METRICS;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`MILANOTE_METRICS_FILE ${file} nicht lesbar: ${error instanceof Error ? error.message : String(error)}`);
  }
  return mergeMetrics(raw);
}

export function mergeMetrics(raw: unknown): Metrics {
  const out: Metrics = { ...DEFAULT_METRICS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_METRICS) as (keyof Metrics)[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- Schätzungen

/** Anzahl gerenderter Zeilen für Markdown-Text bei `cpl` Zeichen je Zeile, gewichtet nach Zeilentyp. */
export function textLines(text: string, cpl: number): { lines: number; paragraphs: number } {
  const blocks = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  let lines = 0;
  for (const block of blocks) {
    for (const raw of block.split('\n')) {
      const heading = /^#{1,3}\s+/.test(raw);
      const listed = /^\s*([-*+]|\d+[.)])\s+/.test(raw);
      const clean = raw
        .replace(/^#{1,3}\s+/, '')
        .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
        .replace(/^>\s?/, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_~`]/g, '');
      const width = Math.max(8, listed ? cpl - 4 : heading ? Math.floor(cpl * 0.7) : cpl);
      lines += Math.max(1, Math.ceil(clean.length / width)) * (heading ? 1.6 : 1);
    }
  }
  return { lines: Math.max(lines, 1), paragraphs: Math.max(blocks.length, 1) };
}

export function noteBox(text: string, m: Metrics): Box {
  const { lines, paragraphs } = textLines(text, m.charsPerLine);
  return { w: m.noteWidth, h: Math.ceil((m.padding + lines * m.lineHeight + (paragraphs - 1) * m.paragraphGap) * m.heightScale) };
}

export function linkBox(caption: string | undefined, m: Metrics): Box {
  const extra = caption?.trim() ? textLines(caption, m.charsPerLine).lines * m.lineHeight : 0;
  return { w: m.linkWidth, h: Math.ceil((m.linkHeight + extra) * m.heightScale) };
}

export function todoBox(title: string | undefined, tasks: { text: string }[], m: Metrics): Box {
  const rows = tasks.reduce((sum, t) => sum + Math.max(m.taskHeight, Math.ceil(t.text.length / (m.charsPerLine - 4)) * m.lineHeight + 2), 0);
  const head = title?.trim() ? m.headerHeight : 0;
  return { w: m.taskListWidth, h: Math.ceil((m.padding + head + rows) * m.heightScale) };
}

/** Überschriftskarte für Gruppen auf der freien Fläche (`## Titel`). */
export function headerBox(title: string, m: Metrics): Box {
  return noteBox(`## ${title}`, m);
}

/** Spalte samt Inhalt: Kopf + gestapelte Karten. */
export function columnBox(children: Box[], m: Metrics): Box {
  const body = children.reduce((sum, c) => sum + c.h + m.itemGap, 0);
  return { w: m.columnWidth, h: Math.ceil(m.headerHeight * m.heightScale + body + m.padding) };
}
