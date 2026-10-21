import { describe, expect, it } from 'vitest';
import { findCollisions, collides } from '../../src/layout/geometry.ts';
import { STRATEGIES, layout, packBlocks, type LayoutGroup, type Strategy } from '../../src/layout/strategies.ts';

/** Kleiner deterministischer Zufallsgenerator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomGroups(seed: number, strategy: Strategy): LayoutGroup[] {
  const rand = rng(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const groupCount = int(1, 6);
  return Array.from({ length: groupCount }, (_, g) => {
    const key = `g${g}`;
    if (strategy === 'columns') return { key, items: [{ key: `${key}.col`, box: { w: 40, h: int(10, 160) } }] };
    return {
      key,
      header: rand() < 0.8 ? { key: `${key}.header`, box: { w: 40, h: int(6, 12) } } : undefined,
      items: Array.from({ length: int(0, 9) }, (_, i) => ({ key: `${key}.i${i}`, box: { w: int(20, 60), h: int(6, 90) } })),
    };
  });
}

const gap = 4;

describe.each(STRATEGIES)('layout(%s)', (strategy) => {
  it('liefert für 200 zufällige Eingaben nie Überlappungen und nur ganze Zahlen ab 0/0', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const groups = randomGroups(seed, strategy);
      const center = strategy === 'radial' ? { key: 'center', box: { w: 40, h: 14 } } : undefined;
      const { rects, bounds } = layout(groups, { strategy, gap, center, columns: seed % 4 === 0 ? 2 : undefined, maxWidth: seed % 3 === 0 ? 100 : undefined });
      const expectedKeys = [...(center ? ['center'] : []), ...groups.flatMap((g) => [...(g.header ? [g.header.key] : []), ...g.items.map((i) => i.key)])].sort();
      expect(rects.map((r) => r.key).sort(), `Seed ${seed}`).toEqual(expectedKeys);
      expect(findCollisions(rects, 1), `Seed ${seed}`).toEqual([]);
      for (const r of rects) {
        expect(Number.isInteger(r.x) && Number.isInteger(r.y), `Seed ${seed} ${r.key}`).toBe(true);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
      }
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
    }
  });

  it('ist deterministisch', () => {
    const groups = randomGroups(7, strategy);
    const center = strategy === 'radial' ? { key: 'center', box: { w: 40, h: 14 } } : undefined;
    const a = layout(groups, { strategy, gap, center });
    const b = layout(groups, { strategy, gap, center });
    expect(a).toEqual(b);
  });

  it('übersteht leere Eingaben und kleine Abstände', () => {
    const center = strategy === 'radial' ? { key: 'center', box: { w: 40, h: 14 } } : undefined;
    expect(() => layout([], { strategy, gap, center })).not.toThrow();
    const groups = randomGroups(3, strategy);
    expect(findCollisions(layout(groups, { strategy, gap: 1, center }).rects, 0)).toEqual([]);
  });
});

describe('packBlocks', () => {
  it('bricht um, wenn die Breite nicht reicht, und respektiert perRow', () => {
    const blocks = ['a', 'b', 'c', 'd'].map((key) => ({ key, w: 40, h: 10 }));
    expect(packBlocks(blocks, { maxWidth: 100, gap: 4 }).map((r) => [r.key, r.x, r.y])).toEqual([['a', 0, 0], ['b', 44, 0], ['c', 0, 14], ['d', 44, 14]]);
    expect(packBlocks(blocks, { maxWidth: 1000, gap: 4, perRow: 3 }).map((r) => [r.x, r.y])).toEqual([[0, 0], [44, 0], [88, 0], [0, 14]]);
  });

  it('stellt zu breite Blöcke allein in eine Reihe', () => {
    const rects = packBlocks([{ key: 'a', w: 500, h: 10 }, { key: 'b', w: 20, h: 10 }], { maxWidth: 100, gap: 4 });
    expect(rects.map((r) => [r.x, r.y])).toEqual([[0, 0], [0, 14]]);
  });

  it('nimmt als Reihenhöhe den höchsten Block', () => {
    const rects = packBlocks([{ key: 'a', w: 10, h: 50 }, { key: 'b', w: 10, h: 10 }, { key: 'c', w: 10, h: 10 }], { maxWidth: 24, gap: 4 });
    expect(rects.find((r) => r.key === 'c')?.y).toBe(54);
  });
});

describe('Strategien im Einzelnen', () => {
  const item = (key: string, w = 40, h = 20) => ({ key, box: { w, h } });

  it('columns: Spalten nebeneinander, danach umbrochen', () => {
    const groups = Array.from({ length: 5 }, (_, i) => ({ key: `c${i}`, items: [item(`c${i}.col`, 40, 30 + i * 10)] }));
    const { rects } = layout(groups, { strategy: 'columns', gap, columns: 3 });
    expect(rects.map((r) => [r.key, r.x, r.y])).toEqual([['c0.col', 0, 0], ['c1.col', 44, 0], ['c2.col', 88, 0], ['c3.col', 0, 54], ['c4.col', 44, 54]]);
  });

  it('grid: Einträge zeilenweise in Gruppenreihenfolge unter der Überschrift', () => {
    const groups: LayoutGroup[] = [{ key: 'g', header: item('h', 40, 8), items: ['a', 'b', 'c', 'd', 'e'].map((k) => item(k)) }];
    const { rects } = layout(groups, { strategy: 'grid', gap, columns: 2 });
    const at = (k: string) => rects.find((r) => r.key === k)!;
    expect([at('h').x, at('h').y]).toEqual([0, 0]);
    expect([at('a').x, at('a').y]).toEqual([0, 12]);
    expect([at('b').x, at('b').y]).toEqual([44, 12]);
    expect([at('c').x, at('c').y]).toEqual([0, 36]);
    expect([at('e').x, at('e').y]).toEqual([0, 60]);
  });

  it('masonry: füllt immer die kürzeste Spalte und behält die Reihenfolge', () => {
    const groups: LayoutGroup[] = [{ key: 'g', items: [item('a', 40, 50), item('b', 40, 10), item('c', 40, 10), item('d', 40, 10), item('e', 40, 10)] }];
    const { rects } = layout(groups, { strategy: 'masonry', gap, columns: 2 });
    const col = (k: string) => rects.find((r) => r.key === k)!.x;
    // a (50 hoch) steht links; b, c, d füllen rechts, bis die rechte Spalte höher als a ist; e kommt wieder rechts
    expect([col('a'), col('b'), col('c'), col('d'), col('e')]).toEqual([0, 44, 44, 44, 44]);
    const bottoms = [0, 44].map((x) => Math.max(...rects.filter((r) => r.x === x).map((r) => r.y + r.h)));
    expect(Math.abs((bottoms[0] as number) - (bottoms[1] as number))).toBeLessThanOrEqual(50);
  });

  it('timeline: eine Bahn je Gruppe, Einträge wachsen in Reihenfolge nach rechts', () => {
    const groups: LayoutGroup[] = [
      { key: 'l1', header: item('h1', 30, 8), items: [item('a'), item('b'), item('c')] },
      { key: 'l2', header: item('h2', 30, 8), items: [item('d'), item('e')] },
    ];
    const { rects } = layout(groups, { strategy: 'timeline', gap });
    const at = (k: string) => rects.find((r) => r.key === k)!;
    expect(at('a').x).toBeLessThan(at('b').x);
    expect(at('b').x).toBeLessThan(at('c').x);
    expect(at('a').y).toBe(at('c').y);
    expect(at('h1').x).toBe(0);
    expect(at('a').x).toBeGreaterThan(at('h1').x + at('h1').w);
    expect(at('d').y).toBeGreaterThan(at('a').y + at('a').h);
  });

  it('timeline: lange Bahnen brechen um, ohne die Überschrift zu verdecken', () => {
    const groups: LayoutGroup[] = [{ key: 'l', header: item('h', 30, 8), items: Array.from({ length: 8 }, (_, i) => item(`i${i}`)) }];
    const { rects, bounds } = layout(groups, { strategy: 'timeline', gap, maxWidth: 150 });
    expect(bounds.w).toBeLessThanOrEqual(150);
    expect(new Set(rects.map((r) => r.y)).size).toBeGreaterThan(1);
  });

  it('radial: erste Gruppe oberhalb des Mittelpunkts, zweite unterhalb (bei zwei Gruppen)', () => {
    const groups: LayoutGroup[] = [
      { key: 'g0', header: item('h0', 40, 8), items: [item('a')] },
      { key: 'g1', header: item('h1', 40, 8), items: [item('b')] },
    ];
    const { rects } = layout(groups, { strategy: 'radial', gap, center: item('center', 40, 14) });
    const at = (k: string) => rects.find((r) => r.key === k)!;
    expect(at('h0').y + at('h0').h).toBeLessThanOrEqual(at('center').y);
    expect(at('h1').y).toBeGreaterThanOrEqual(at('center').y + at('center').h);
  });

  it('radial ohne Mittelpunkt ist ein Fehler', () => {
    expect(() => layout([], { strategy: 'radial', gap })).toThrow(/Mittelpunkt/);
  });

  it('collides: Abstand zählt', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(collides(a, { x: 10, y: 0, w: 10, h: 10 })).toBe(false);
    expect(collides(a, { x: 10, y: 0, w: 10, h: 10 }, 2)).toBe(true);
    expect(collides(a, { x: 12, y: 0, w: 10, h: 10 }, 2)).toBe(false);
  });
});
