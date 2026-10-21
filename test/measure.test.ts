import { describe, expect, it } from 'vitest';
import { COLLECT_SCRIPT, analyze, fitLine, stat, type Sample } from '../src/measure.ts';
import { planCompose } from '../src/layout/compose.ts';
import { DEFAULT_METRICS } from '../src/layout/metrics.ts';
import { renderAscii } from '../src/layout/preview.ts';

/** Erzeugt Messwerte für ein Board mit `unitPx` Pixeln je Einheit und Versatz (ox, oy). */
function board(unitPx: number, storedWidthFactor?: number): Sample[] {
  const ox = 120;
  const oy = 80;
  const items: { id: string; type: string; x: number; y: number; wUnits: number; hUnits: number }[] = [
    { id: 'a', type: 'CARD', x: 0, y: 0, wUnits: 34, hUnits: 12 },
    { id: 'b', type: 'CARD', x: 40, y: 0, wUnits: 34, hUnits: 20 },
    { id: 'c', type: 'CARD', x: 80, y: 10, wUnits: 34, hUnits: 16 },
    { id: 'd', type: 'COLUMN', x: 0, y: 30, wUnits: 38, hUnits: 60 },
    { id: 'e', type: 'LINK', x: 50, y: 40, wUnits: 34, hUnits: 30 },
  ];
  return items.map((i) => ({
    id: i.id,
    type: i.type,
    x: i.x,
    y: i.y,
    px: { x: ox + i.x * unitPx, y: oy + i.y * unitPx, w: i.wUnits * unitPx, h: i.hUnits * unitPx },
    storedWidth: storedWidthFactor ? i.wUnits * unitPx * storedWidthFactor : undefined,
    estimatedHeight: i.type === 'CARD' ? 10 : undefined,
  }));
}

describe('analyze', () => {
  it('bestimmt die Einheit und rechnet Breiten und Höhen um', () => {
    const report = analyze(board(8));
    expect(report.measured).toBe(5);
    expect(report.unitPx).toMatchObject({ x: 8, y: 8 });
    expect(report.unitPx!.fitX).toBeGreaterThan(0.999);
    expect(report.perType.CARD!.width).toMatchObject({ n: 3, median: 34 });
    expect(report.perType.CARD!.height).toMatchObject({ min: 12, median: 16, max: 20 });
    expect(report.perType.COLUMN!.width.median).toBe(38);
    expect(report.suggestedMetrics).toMatchObject({ noteWidth: 34, columnWidth: 38, linkWidth: 34 });
  });

  it('ist unabhängig vom Zoom (gleiche Einheiten bei 5, 8 und 12 px)', () => {
    for (const px of [5, 8, 12]) {
      const r = analyze(board(px));
      expect(r.unitPx?.x).toBeCloseTo(px, 1);
      expect(r.perType.CARD!.width.median).toBe(34);
    }
  });

  it('erkennt, ob content.width in Einheiten oder Pixeln gespeichert ist', () => {
    // content.width = Breite in Einheiten → Pixel je Wert = unitPx
    const inUnits = analyze(board(8).map((s) => ({ ...s, storedWidth: s.px.w / 8 })));
    expect(inUnits.notes.join()).toMatch(/content\.width ist in Rastereinheiten/);
    // content.width = Breite in Pixeln → Pixel je Wert = 1
    const inPixels = analyze(board(8).map((s) => ({ ...s, storedWidth: s.px.w })));
    expect(inPixels.notes.join()).toMatch(/content\.width ist in Pixeln/);
  });

  it('schlägt einen Höhenfaktor vor, wenn die Schätzung abweicht', () => {
    const report = analyze(board(8));
    // gemessen 12/20/16 Einheiten gegen geschätzte 10 → Faktor deutlich über 1
    expect(report.heightRatio!.median).toBeCloseTo(1.6, 1);
    expect(report.suggestedMetrics.heightScale).toBeGreaterThan(1.5);
    expect(report.suggestedMetrics.heightScale).toBeLessThanOrEqual(2);
  });

  it('meldet ehrlich, wenn nichts oder zu wenig gemessen wurde', () => {
    expect(analyze([]).notes.join()).toMatch(/kein Element gefunden/);
    const few = analyze(board(8).slice(0, 2));
    expect(few.unitPx).toBeUndefined();
    expect(few.notes.join()).toMatch(/nicht sicher bestimmen/);
    expect(few.suggestedMetrics).toEqual({});
  });

  it('misstraut Positionen, die nicht zu den Rechtecken passen', () => {
    const noisy = board(8).map((s, i) => ({ ...s, px: { ...s.px, x: s.px.x + (i % 2 ? 300 : -250) } }));
    expect(analyze(noisy).unitPx).toBeUndefined();
  });
});

describe('Hilfen', () => {
  it('stat und fitLine', () => {
    expect(stat([3, 1, 2])).toEqual({ n: 3, min: 1, median: 2, max: 3 });
    expect(stat([1, 2, 3, 4]).median).toBe(2.5);
    expect(stat([])).toEqual({ n: 0, min: 0, median: 0, max: 0 });
    expect(fitLine([{ unit: 0, px: 10 }, { unit: 1, px: 18 }, { unit: 2, px: 26 }])).toMatchObject({ slope: 8, r2: 1 });
    expect(fitLine([{ unit: 1, px: 1 }, { unit: 1, px: 2 }, { unit: 1, px: 3 }])).toBeUndefined();
  });

  it('das Skript für den Tab enthält nur die IDs als Daten', () => {
    const script = COLLECT_SCRIPT(['abc123', 'x"y']);
    expect(script).toContain('["abc123","x\\"y"]');
    expect(script).toContain('getBoundingClientRect');
    expect(script).not.toMatch(/fetch|XMLHttpRequest|localStorage|cookie/);
  });
});

describe('renderAscii', () => {
  it('zeichnet jede Gruppe mit eigenem Buchstaben und hebt Überschriften hervor', () => {
    const plan = planCompose(
      { layout: 'grid', groups: [{ title: 'Eins', items: ['a', 'b'] }, { title: 'Zwei', items: ['c'] }] },
      DEFAULT_METRICS,
    );
    const art = renderAscii(plan);
    expect(art).toMatch(/A+/);
    expect(art).toMatch(/a+/);
    expect(art).toMatch(/B+/);
    expect(art).toMatch(/b+/);
    expect(art.split('\n').length).toBeGreaterThan(3);
  });

  it('bezeichnet den Mittelpunkt mit *', () => {
    const plan = planCompose({ layout: 'radial', center: 'Mitte', groups: [{ title: 'x', items: ['y'] }] }, DEFAULT_METRICS);
    expect(renderAscii(plan)).toContain('*');
  });
});
