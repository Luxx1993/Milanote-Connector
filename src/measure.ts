// Messen am echten Board: Wie groß sind Karten im sichtbaren Milanote-Tab, gemessen in Rastereinheiten?
// Liefert die Einheit (Pixel je Einheit), Breiten und Höhen je Typ, die Einheit von content.width und einen Vorschlag
// für MILANOTE_METRICS_FILE. Nur lesend; die Auswertung ist rein und getestet, das Einsammeln im Tab nicht (docs/phase5.md).

import { DEFAULT_METRICS, type Metrics } from './layout/metrics.ts';

export interface Sample {
  id: string;
  type: string;
  /** Position laut Milanote (Rastereinheiten) */
  x: number;
  y: number;
  /** Gemessenes Rechteck im Tab (Pixel) */
  px: { x: number; y: number; w: number; h: number };
  /** content.width laut Milanote, falls gespeichert */
  storedWidth?: number;
  /** Geschätzte Höhe aus dem Größenmodell (Einheiten) */
  estimatedHeight?: number;
}

export interface Stat {
  n: number;
  min: number;
  median: number;
  max: number;
}

export interface MeasureReport {
  measured: number;
  /** Pixel je Rastereinheit (Regression über Position) */
  unitPx?: { x: number; y: number; fitX: number; fitY: number };
  perType: Record<string, { width: Stat; height: Stat }>;
  /** Pixel je Einheit von content.width (1 = content.width ist in Pixeln, ≈ unitPx = Rastereinheiten) */
  storedWidthPxPer?: Stat;
  /** gemessene Höhe / geschätzte Höhe */
  heightRatio?: Stat;
  suggestedMetrics: Partial<Metrics>;
  notes: string[];
}

export function stat(values: number[]): Stat {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { n: 0, min: 0, median: 0, max: 0 };
  const mid = Math.floor(v.length / 2);
  return { n: v.length, min: round(v[0] as number), median: round(v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2), max: round(v[v.length - 1] as number) };
}

/** Kleinste Quadrate: px = a + b * unit. Gibt Steigung und Güte (R²) zurück. */
export function fitLine(points: { unit: number; px: number }[]): { slope: number; r2: number } | undefined {
  const n = points.length;
  if (n < 3 || new Set(points.map((p) => p.unit)).size < 2) return undefined;
  const mx = points.reduce((s, p) => s + p.unit, 0) / n;
  const my = points.reduce((s, p) => s + p.px, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.unit - mx) ** 2, 0);
  const sxy = points.reduce((s, p) => s + (p.unit - mx) * (p.px - my), 0);
  const syy = points.reduce((s, p) => s + (p.px - my) ** 2, 0);
  if (sxx === 0 || syy === 0) return undefined;
  return { slope: sxy / sxx, r2: (sxy * sxy) / (sxx * syy) };
}

export function analyze(samples: Sample[]): MeasureReport {
  const notes: string[] = [];
  const canvas = samples.filter((s) => Number.isFinite(s.x) && Number.isFinite(s.y));
  const fx = fitLine(canvas.map((s) => ({ unit: s.x, px: s.px.x })));
  const fy = fitLine(canvas.map((s) => ({ unit: s.y, px: s.px.y })));
  let unitPx: MeasureReport['unitPx'];
  if (fx && fy && fx.r2 > 0.98 && fy.r2 > 0.98) {
    unitPx = { x: round(fx.slope), y: round(fy.slope), fitX: round(fx.r2, 3), fitY: round(fy.r2, 3) };
    if (Math.abs(fx.slope - fy.slope) / fx.slope > 0.05) notes.push('Die Einheit ist in x und y verschieden (>5 %); die Messung ist unsicher.');
  } else {
    notes.push('Die Einheit (Pixel je Rastereinheit) ließ sich nicht sicher bestimmen: zu wenige Elemente mit verschiedenen Positionen oder die Positionen passen nicht zu den gemessenen Rechtecken (anderer Zoom, Elemente in Spalten?).');
  }
  const scale = unitPx ? (unitPx.x + unitPx.y) / 2 : undefined;

  const perType: MeasureReport['perType'] = {};
  const byType = new Map<string, Sample[]>();
  for (const s of samples) byType.set(s.type, [...(byType.get(s.type) ?? []), s]);
  if (scale) {
    for (const [type, list] of byType) perType[type] = { width: stat(list.map((s) => s.px.w / scale)), height: stat(list.map((s) => s.px.h / scale)) };
  }

  const stored = samples.filter((s) => s.storedWidth);
  const storedWidthPxPer = stored.length ? stat(stored.map((s) => s.px.w / (s.storedWidth as number))) : undefined;
  if (storedWidthPxPer && scale) {
    const ratio = storedWidthPxPer.median / scale;
    notes.push(
      Math.abs(ratio - 1) < 0.15
        ? 'content.width ist in Rastereinheiten (wie die Positionen).'
        : Math.abs(storedWidthPxPer.median - 1) < 0.15
          ? 'content.width ist in Pixeln, nicht in Rastereinheiten. resize_element und size.width in get_board sind dann falsch skaliert.'
          : `content.width entspricht ${storedWidthPxPer.median} px je Wert (Einheit ${scale} px); weder Rastereinheiten noch Pixel.`,
    );
  }

  const withEstimate = samples.filter((s) => s.estimatedHeight && (s.type === 'CARD' || s.type === 'TASK'));
  const heightRatio = scale && withEstimate.length ? stat(withEstimate.map((s) => s.px.h / scale / (s.estimatedHeight as number))) : undefined;

  const suggested: Partial<Metrics> = {};
  const widthOf = (type: string) => (perType[type]?.width.n ? Math.ceil(perType[type].width.median) : undefined);
  const set = (key: keyof Metrics, value: number | undefined) => {
    if (value && value > 0) suggested[key] = value;
  };
  set('noteWidth', widthOf('CARD'));
  set('columnWidth', widthOf('COLUMN'));
  set('taskListWidth', widthOf('TASK_LIST'));
  set('linkWidth', widthOf('LINK'));
  set('imageWidth', widthOf('IMAGE'));
  set('boardWidth', widthOf('BOARD'));
  if (heightRatio && heightRatio.n >= 3) {
    // Etwas über dem Median, damit die Schätzung eher zu groß als zu klein bleibt.
    const factor = Math.min(2, Math.max(0.5, round(Math.max(heightRatio.median, (heightRatio.median + heightRatio.max) / 2) * 1.05, 2)));
    suggested.heightScale = round(DEFAULT_METRICS.heightScale * factor, 2);
  }
  if (!samples.length) notes.push('Im Tab wurde kein Element gefunden. Ist das Board offen und sichtbar? Die Element-IDs müssen im DOM vorkommen (id-Attribut endet auf die Element-ID).');
  return { measured: samples.length, unitPx, perType, storedWidthPxPer, heightRatio, suggestedMetrics: suggested, notes };
}

function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Läuft im Tab: sucht zu jeder ID das DOM-Element und liefert sein Rechteck in Pixeln. */
export const COLLECT_SCRIPT = (ids: string[]): string => `(() => {
  const ids = ${JSON.stringify(ids)};
  return ids.map((id) => {
    const el = document.querySelector('[id$="' + id + '"]') || document.querySelector('[data-id="' + id + '"]') || document.querySelector('[data-element-id="' + id + '"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, x: r.left, y: r.top, w: r.width, h: r.height };
  });
})()`;
