import { describe, expect, it } from 'vitest';
import { LIMITS, planCompose, type ComposeSpec, type Step } from '../../src/layout/compose.ts';
import { DEFAULT_METRICS, columnBox, mergeMetrics, noteBox, textLines } from '../../src/layout/metrics.ts';
import { boundsOf, collides, findCollisions, type KeyedRect, type Rect } from '../../src/layout/geometry.ts';
import { STRATEGIES, type Strategy } from '../../src/layout/strategies.ts';

const m = DEFAULT_METRICS;

/** „Reiseplanung“: 4 Themen, 16 Einträge verschiedener Art und Länge, dazu 10 Aufgaben. */
function sample(layout: Strategy): ComposeSpec {
  return {
    layout,
    center: 'Reise nach Lissabon',
    groups: [
      { title: 'Anreise', items: ['Flug **TP 123** um 8:15 ab Berlin', 'Transfer vom Flughafen: Metro Linie Rot bis Alameda, dann umsteigen. Alternativ Taxi (ca. 20 Euro, 25 Minuten).', { type: 'link', url: 'https://www.flytap.com', caption: 'Buchung' }, 'Koffer: Handgepäck reicht'] },
      { title: 'Unterkunft', items: ['Hotel im Alfama-Viertel', { type: 'link', url: 'https://example.com/hotel' }, '# Check-in\n\nab 15 Uhr, spätes Check-in möglich\n\n- Schlüssel an der Rezeption\n- Frühstück inklusive', 'Zimmer mit Blick auf den Tejo'] },
      { title: 'Programm', items: [{ type: 'todo', title: 'Tag 1', tasks: ['Belém besuchen', { text: 'Pastéis de Belém probieren', done: true }, 'Tram 28 fahren'] }, 'Tag 2: Sintra, Zug ab Rossio', { type: 'todo', title: 'Tag 3', tasks: ['Oceanário', 'Abendessen im Bairro Alto'] }, 'Fado-Abend reservieren', { type: 'note', text: 'Wetter prüfen' }] },
      { title: 'Packliste', items: [{ type: 'todo', tasks: ['Reisepass', 'Ladekabel', 'Sonnencreme', 'Regenjacke', 'Bequeme Schuhe'] }, 'Adapter nicht nötig (EU)', 'Reiseapotheke'] },
    ],
  };
}

function canvasRects(steps: Step[]): KeyedRect[] {
  return steps.filter((s) => s.rel).map((s) => ({ key: s.key, ...(s.rel as Rect) }));
}

describe.each(STRATEGIES)('planCompose(%s) mit Beispielvorlage (16 Einträge, 10 Aufgaben)', (layout) => {
  const plan = planCompose(sample(layout), m);

  it('legt alles an und zählt richtig', () => {
    const items = plan.steps.filter((s) => ['note', 'link', 'todo'].includes(s.kind));
    expect(items).toHaveLength(16);
    expect(plan.steps.filter((s) => s.kind === 'task')).toHaveLength(10);
    expect(plan.count).toBe(plan.steps.length);
    expect(new Set(plan.steps.map((s) => s.key)).size).toBe(plan.steps.length);
  });

  it('ordnet Eltern vor Kinder und gibt Kindern Listenplätze', () => {
    const seen = new Set<string>();
    for (const s of plan.steps) {
      if (s.parentKey) expect(seen.has(s.parentKey), `${s.key} vor ${s.parentKey}`).toBe(true);
      seen.add(s.key);
      if (s.section === 'INBOX') {
        expect(s.parentKey).toBeDefined();
        expect(Number.isInteger(s.index)).toBe(true);
        expect(s.rel).toBeUndefined();
      } else {
        expect(s.rel).toBeDefined();
      }
    }
  });

  it('platziert überlappungsfrei, ganzzahlig und ab 0/0', () => {
    const rects = canvasRects(plan.steps);
    expect(findCollisions(rects, m.gap - 1)).toEqual([]);
    for (const r of rects) {
      expect(Number.isInteger(r.x) && Number.isInteger(r.y)).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
    }
    expect(plan.bounds.x).toBe(0);
    expect(plan.bounds.y).toBe(0);
  });
});

describe('Gruppierung', () => {
  it('columns: eine Spalte je Gruppe, Einträge in der Spalte', () => {
    const plan = planCompose(sample('columns'), m);
    const columns = plan.steps.filter((s) => s.kind === 'column');
    expect(columns.map((c) => c.title)).toEqual(['Anreise', 'Unterkunft', 'Programm', 'Packliste']);
    for (const s of plan.steps.filter((x) => ['note', 'link', 'todo'].includes(x.kind))) {
      expect(s.parentKey).toBe(`g${s.group}`);
      expect(s.section).toBe('INBOX');
    }
    // Eine Reihe mit höchstens 4 Spalten, alle auf gleicher Höhe
    expect(new Set(columns.map((c) => c.rel?.y)).size).toBe(1);
  });

  it.each(['grid', 'masonry', 'timeline'] as const)('%s: Gruppen belegen getrennte Flächen', (layout) => {
    const plan = planCompose(sample(layout), m);
    const regions = [0, 1, 2, 3].map((g) => boundsOf(canvasRects(plan.steps.filter((s) => s.group === g))));
    for (let i = 0; i < regions.length; i += 1) {
      for (let j = i + 1; j < regions.length; j += 1) expect(collides(regions[i] as Rect, regions[j] as Rect, 0), `Gruppe ${i} / ${j}`).toBe(false);
    }
    // Jede Gruppe beginnt mit ihrer Überschrift als erste Karte der Region
    for (let g = 0; g < 4; g += 1) {
      const header = plan.steps.find((s) => s.key === `g${g}.header`)!;
      expect(header.text).toMatch(/^## /);
    }
  });

  it('radial: Mittelpunkt in der Mitte, jede Gruppe mit Überschrift', () => {
    const plan = planCompose(sample('radial'), m);
    const center = plan.steps.find((s) => s.kind === 'center')!;
    expect(center.text).toBe('# Reise nach Lissabon');
    const cx = (center.rel as Rect).x + (center.rel as Rect).w / 2;
    const cy = (center.rel as Rect).y + (center.rel as Rect).h / 2;
    const first = plan.steps.find((s) => s.key === 'g0.header')!.rel as Rect;
    expect(first.y + first.h / 2).toBeLessThan(cy);
    expect(Math.abs(first.x + first.w / 2 - cx)).toBeLessThan(first.w);
  });

  it('timeline: Einträge einer Gruppe stehen in Reihenfolge von links nach rechts', () => {
    const plan = planCompose(sample('timeline'), m);
    const lane = plan.steps.filter((s) => s.group === 0 && s.kind !== 'header').map((s) => s.rel as Rect);
    const sameRow = lane.filter((r) => r.y === lane[0]?.y);
    expect(sameRow.map((r) => r.x)).toEqual([...sameRow.map((r) => r.x)].sort((a, b) => a - b));
  });

  it('reicht Inhalte unverändert in den Plan', () => {
    const plan = planCompose(sample('grid'), m);
    expect(plan.steps.find((s) => s.key === 'g0.i0')).toMatchObject({ kind: 'note', type: 'CARD', text: 'Flug **TP 123** um 8:15 ab Berlin' });
    expect(plan.steps.find((s) => s.key === 'g0.i2')).toMatchObject({ kind: 'link', type: 'LINK', url: 'https://www.flytap.com/', caption: 'Buchung' });
    expect(plan.steps.find((s) => s.key === 'g2.i0')).toMatchObject({ kind: 'todo', type: 'TASK_LIST', title: 'Tag 1' });
    expect(plan.steps.find((s) => s.key === 'g2.i0.t1')).toMatchObject({ kind: 'task', parentKey: 'g2.i0', index: 1, text: 'Pastéis de Belém probieren', done: true });
  });
});

describe('Eingabeprüfung', () => {
  it('verlangt Titel bei columns und center bei radial', () => {
    expect(() => planCompose({ layout: 'columns', groups: [{ items: ['x'] }] }, m)).toThrow(/Titel/);
    expect(() => planCompose({ layout: 'radial', groups: [{ title: 'a', items: ['x'] }] }, m)).toThrow(/center/);
  });

  it('lehnt Unsinn ab', () => {
    expect(() => planCompose({ layout: 'zickzack' as Strategy, groups: [{ items: ['x'] }] }, m)).toThrow(/Unbekanntes Layout/);
    expect(() => planCompose({ layout: 'grid', groups: [] }, m)).toThrow(/Mindestens eine Gruppe/);
    expect(() => planCompose({ layout: 'grid', groups: [{ items: [{ type: 'link', url: 'javascript:alert(1)' }] }] }, m)).toThrow(/keine gültige http\(s\)-URL/);
    expect(() => planCompose({ layout: 'grid', groups: [{ items: [{ type: 'todo', tasks: [] }] }] }, m)).toThrow(/Aufgaben/);
    expect(() => planCompose({ layout: 'grid', groups: [{ items: ['  '] }] }, m)).toThrow(/leer/);
  });

  it('begrenzt die Elementzahl', () => {
    const big = { layout: 'grid' as const, groups: Array.from({ length: 10 }, () => ({ items: Array.from({ length: 20 }, () => 'x') })) };
    expect(() => planCompose(big, m)).toThrow(new RegExp(`höchstens ${LIMITS.elements}`));
  });

  it('akzeptiert Gruppen ohne Titel außer bei columns/radial', () => {
    const plan = planCompose({ layout: 'grid', groups: [{ items: ['a', 'b'] }, { items: ['c'] }] }, m);
    expect(plan.steps.some((s) => s.kind === 'header')).toBe(false);
    expect(findCollisions(canvasRects(plan.steps), m.gap - 1)).toEqual([]);
  });
});

describe('Größenmodell', () => {
  it('schätzt längere Texte höher', () => {
    expect(noteBox('kurz', m).h).toBeLessThan(noteBox('lang '.repeat(80), m).h);
    expect(noteBox('# Titel\n\n- a\n- b\n- c', m).h).toBeGreaterThan(noteBox('Titel', m).h);
    expect(textLines('a\n\nb', 32)).toEqual({ lines: 2, paragraphs: 2 });
  });

  it('Spalten wachsen mit ihrem Inhalt', () => {
    expect(columnBox([{ w: 40, h: 10 }, { w: 40, h: 20 }], m).h).toBeGreaterThan(columnBox([{ w: 40, h: 10 }], m).h);
  });

  it('lässt sich überschreiben und ignoriert Unbrauchbares', () => {
    const merged = mergeMetrics({ noteWidth: 50, lineHeight: -1, gap: 'x', unbekannt: 1 });
    expect(merged.noteWidth).toBe(50);
    expect(merged.lineHeight).toBe(DEFAULT_METRICS.lineHeight);
    expect(merged.gap).toBe(DEFAULT_METRICS.gap);
    const noteWidths = (metrics: typeof m) => new Set(planCompose(sample('grid'), metrics).steps.filter((s) => s.kind === 'note').map((s) => s.rel?.w));
    expect(noteWidths(m)).toEqual(new Set([40]));
    expect(noteWidths({ ...m, noteWidth: 60 })).toEqual(new Set([60]));
  });
});
