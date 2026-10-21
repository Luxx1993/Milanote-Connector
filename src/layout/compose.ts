// Plan für compose_board: aus „was gehört zusammen“ (Gruppen mit Inhalten) wird „welche Elemente wohin“.
// Rein und ohne Netz. Das Anlegen übernimmt der Writer anhand dieses Plans.
//
//  columns   jede Gruppe wird eine Milanote-Spalte (COLUMN) mit ihren Karten darin; die Spalten liegen nebeneinander
//  grid      jede Gruppe ist ein Block aus Überschriftskarte und Raster
//  masonry   wie grid, aber Moodboard-artig in die jeweils kürzeste Spalte
//  timeline  jede Gruppe ist eine Bahn: Überschrift links, Einträge der Reihe nach nach rechts
//  radial    Mindmap: Mittelpunktskarte, jede Gruppe ein Zweig mit Überschrift und Einträgen

import { MilanoteError } from '../errors.ts';
import type { ElementType } from '../protocol/actions.ts';
import { boundsOf, type Rect } from './geometry.ts';
import { columnBox, headerBox, linkBox, noteBox, todoBox, type Metrics } from './metrics.ts';
import { STRATEGIES, layout, type LayoutGroup, type Strategy } from './strategies.ts';

export type TaskInput = string | { text: string; done?: boolean };
export type ItemInput =
  | string
  | { type: 'note'; text: string }
  | { type: 'link'; url: string; caption?: string }
  | { type: 'todo'; title?: string; tasks: TaskInput[] };

export interface GroupSpec {
  title?: string;
  items: ItemInput[];
}

export interface ComposeSpec {
  layout: Strategy;
  groups: GroupSpec[];
  /** Mittelpunktkarte (nur radial; Pflicht dort) */
  center?: string;
  /** Spalten je Gruppe (grid, masonry) bzw. je Reihe (columns) */
  columns?: number;
  /** Maximale Breite in Rastereinheiten, bevor umbrochen wird */
  maxWidth?: number;
}

export const LIMITS = { groups: 30, itemsPerGroup: 40, elements: 150, tasksPerList: 50 } as const;

export type StepKind = 'column' | 'header' | 'center' | 'note' | 'link' | 'todo' | 'task';

export interface Step {
  /** Eindeutiger Schlüssel im Plan, z. B. `g1.i2.t0` */
  key: string;
  kind: StepKind;
  type: ElementType;
  /** Gruppennummer (0-basiert), `null` beim Mittelpunkt */
  group: number | null;
  parentKey?: string;
  section: 'CANVAS' | 'INBOX';
  /** Position relativ zum Ursprung des Plans (nur auf der Fläche) */
  rel?: Rect;
  /** Platz in der Liste (nur in Spalten und To-do-Listen) */
  index?: number;
  text?: string;
  title?: string;
  url?: string;
  caption?: string;
  done?: boolean;
}

export interface Plan {
  steps: Step[];
  /** Umriss aller Elemente auf der Fläche (relativ, beginnt bei 0/0) */
  bounds: Rect;
  /** Anzahl anzulegender Elemente (inklusive Aufgaben) */
  count: number;
}

type Normalized =
  | { kind: 'note'; text: string }
  | { kind: 'link'; url: string; caption?: string }
  | { kind: 'todo'; title?: string; tasks: { text: string; done: boolean }[] };

export function planCompose(spec: ComposeSpec, m: Metrics): Plan {
  if (!STRATEGIES.includes(spec.layout)) throw new MilanoteError('args', `Unbekanntes Layout "${spec.layout}". Erlaubt: ${STRATEGIES.join(', ')}`);
  if (!spec.groups.length) throw new MilanoteError('args', 'Mindestens eine Gruppe nötig');
  if (spec.groups.length > LIMITS.groups) throw new MilanoteError('args', `Höchstens ${LIMITS.groups} Gruppen`);
  if (spec.layout === 'columns' && spec.groups.some((g) => !g.title?.trim())) throw new MilanoteError('args', 'Im Layout "columns" braucht jede Gruppe einen Titel (er wird die Spaltenüberschrift)');
  if (spec.layout === 'radial' && !spec.center?.trim()) throw new MilanoteError('args', 'Im Layout "radial" fehlt `center` (Text der Mittelpunktkarte)');

  const groups = spec.groups.map((g, gi) => {
    if (g.items.length > LIMITS.itemsPerGroup) throw new MilanoteError('args', `Gruppe ${gi + 1}: höchstens ${LIMITS.itemsPerGroup} Einträge`);
    return { title: g.title?.trim() || undefined, items: g.items.map((item) => normalize(item, gi)) };
  });

  const steps: Step[] = [];
  const nodes: LayoutGroup[] = [];
  const stepOf = new Map<string, Step>();
  const push = (s: Step) => {
    steps.push(s);
    stepOf.set(s.key, s);
  };

  if (spec.layout === 'radial') push({ key: 'center', kind: 'center', type: 'CARD', group: null, section: 'CANVAS', text: `# ${spec.center?.trim()}` });

  groups.forEach((g, gi) => {
    const gk = `g${gi}`;
    const inColumn = spec.layout === 'columns';
    // Karten in einer Spalte sind schmaler; Zeilenumbrüche kommen früher.
    const cm: Metrics = inColumn ? { ...m, charsPerLine: Math.max(10, m.charsPerLine - 4) } : m;
    const boxes = g.items.map((item) => boxOf(item, cm));

    if (inColumn) {
      push({ key: gk, kind: 'column', type: 'COLUMN', group: gi, section: 'CANVAS', title: g.title });
    } else if (g.title) {
      push({ key: `${gk}.header`, kind: 'header', type: 'CARD', group: gi, section: 'CANVAS', text: `## ${g.title}` });
    }

    const itemNodes: { key: string; box: { w: number; h: number } }[] = [];
    g.items.forEach((item, ii) => {
      const ik = `${gk}.i${ii}`;
      const base = { group: gi, section: inColumn ? ('INBOX' as const) : ('CANVAS' as const), ...(inColumn ? { parentKey: gk, index: ii } : {}) };
      if (item.kind === 'note') push({ key: ik, kind: 'note', type: 'CARD', ...base, text: item.text });
      else if (item.kind === 'link') push({ key: ik, kind: 'link', type: 'LINK', ...base, url: item.url, caption: item.caption });
      else {
        push({ key: ik, kind: 'todo', type: 'TASK_LIST', ...base, title: item.title });
        item.tasks.forEach((t, ti) => push({ key: `${ik}.t${ti}`, kind: 'task', type: 'TASK', group: gi, section: 'INBOX', parentKey: ik, index: ti, text: t.text, done: t.done }));
      }
      itemNodes.push({ key: ik, box: boxes[ii] as { w: number; h: number } });
    });

    if (inColumn) {
      const col = columnBox(boxes, cm);
      nodes.push({ key: gk, items: [{ key: gk, box: col }] });
    } else {
      nodes.push({ key: gk, header: g.title ? { key: `${gk}.header`, box: headerBox(g.title, m) } : undefined, items: itemNodes });
    }
  });

  if (steps.length > LIMITS.elements) throw new MilanoteError('args', `Das ergäbe ${steps.length} Elemente; erlaubt sind höchstens ${LIMITS.elements} pro Aufruf`);

  const result = layout(nodes, {
    strategy: spec.layout,
    gap: m.gap,
    columns: spec.columns,
    maxWidth: spec.maxWidth,
    center: spec.layout === 'radial' ? { key: 'center', box: noteBox(`# ${spec.center?.trim()}`, m) } : undefined,
  });
  for (const rect of result.rects) {
    const step = stepOf.get(rect.key);
    if (step) step.rel = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  const placed = steps.filter((s) => s.rel).map((s) => s.rel as Rect);
  return { steps, bounds: boundsOf(placed), count: steps.length };
}

function boxOf(item: Normalized, m: Metrics): { w: number; h: number } {
  if (item.kind === 'note') return noteBox(item.text, m);
  if (item.kind === 'link') return linkBox(item.caption, m);
  return todoBox(item.title, item.tasks, m);
}

function normalize(item: ItemInput, gi: number): Normalized {
  const where = `Gruppe ${gi + 1}`;
  if (typeof item === 'string') return { kind: 'note', text: nonEmpty(item, `${where}: Notiztext`) };
  if (item.type === 'note') return { kind: 'note', text: nonEmpty(item.text, `${where}: Notiztext`) };
  if (item.type === 'link') {
    try {
      const url = new URL(item.url.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Protokoll');
      return { kind: 'link', url: url.toString(), caption: item.caption?.trim() || undefined };
    } catch {
      throw new MilanoteError('args', `${where}: "${item.url}" ist keine gültige http(s)-URL`);
    }
  }
  const tasks = item.tasks.map((t) => (typeof t === 'string' ? { text: t, done: false } : { text: t.text, done: Boolean(t.done) })).map((t) => ({ ...t, text: nonEmpty(t.text, `${where}: Aufgabe`) }));
  if (!tasks.length || tasks.length > LIMITS.tasksPerList) throw new MilanoteError('args', `${where}: eine To-do-Liste braucht 1 bis ${LIMITS.tasksPerList} Aufgaben`);
  return { kind: 'todo', title: item.title?.trim() || undefined, tasks };
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new MilanoteError('args', `${label} ist leer`);
  if (value.length > 20_000) throw new MilanoteError('args', `${label} ist zu lang`);
  return value;
}
