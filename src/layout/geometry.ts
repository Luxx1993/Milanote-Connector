// Rechtecke in Milanote-Rastereinheiten (1 Einheit ≈ 7 bis 9 px, siehe docs/phase5.md).

export interface Box {
  w: number;
  h: number;
}

export interface Rect extends Box {
  x: number;
  y: number;
}

export interface KeyedRect extends Rect {
  key: string;
}

/** Zwei Rechtecke kollidieren, wenn der Abstand zwischen ihnen kleiner als `gap` ist. */
export function collides(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
}

/** Alle Paare, die kollidieren (O(n²), für wenige hundert Elemente gedacht). */
export function findCollisions(rects: KeyedRect[], gap = 0): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i] as KeyedRect;
      const b = rects[j] as KeyedRect;
      if (collides(a, b, gap)) out.push([a.key, b.key]);
    }
  }
  return out;
}

export function boundsOf(rects: Rect[]): Rect {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

export function translate<T extends Rect>(rects: T[], dx: number, dy: number): T[] {
  return rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
}
