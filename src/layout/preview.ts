// ASCII-Skizze eines Plans: jede Gruppe bekommt einen Buchstaben, Überschriften und Mittelpunkt sind hervorgehoben.
// Nur zur Vorschau (npm run spike -- plan); Milanote kennt diese Zeichnung nicht.

import type { Plan, Step } from './compose.ts';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export function renderAscii(plan: Plan, options: { unitsPerCol?: number; unitsPerRow?: number } = {}): string {
  const cx = options.unitsPerCol ?? 3;
  const cy = options.unitsPerRow ?? 6;
  const placed = plan.steps.filter((s): s is Step & { rel: NonNullable<Step['rel']> } => Boolean(s.rel));
  const width = Math.ceil(plan.bounds.w / cx) + 1;
  const height = Math.ceil(plan.bounds.h / cy) + 1;
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, () => ' '));
  for (const step of placed) {
    const letter = step.group === null ? '*' : (LETTERS[step.group % LETTERS.length] as string);
    const fill = step.kind === 'header' || step.kind === 'center' || step.kind === 'column' ? letter.toUpperCase() : letter.toLowerCase();
    const x0 = Math.floor(step.rel.x / cx);
    const y0 = Math.floor(step.rel.y / cy);
    const x1 = Math.max(x0, Math.ceil((step.rel.x + step.rel.w) / cx) - 1);
    const y1 = Math.max(y0, Math.ceil((step.rel.y + step.rel.h) / cy) - 1);
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) if (grid[y]?.[x] !== undefined) (grid[y] as string[])[x] = fill;
  }
  return grid.map((row) => row.join('').trimEnd()).join('\n');
}
