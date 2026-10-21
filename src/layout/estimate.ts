// Größe bestehender Elemente schätzen (für Überlappungswarnungen beim Verschieben). Gespeicherte Breiten/Höhen
// (content.width/height) gelten als Rastereinheiten, siehe docs/phase5.md; alles andere kommt aus dem Größenmodell.

import { docToText } from '../domain/richtext.ts';
import { isHidden, type RawElement } from '../domain/board.ts';
import type { Box } from './geometry.ts';
import { columnBox, linkBox, noteBox, todoBox, type Metrics } from './metrics.ts';

function positive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function estimateBox(el: RawElement, elements: Record<string, RawElement>, m: Metrics, depth = 0): Box {
  const c = el.content ?? {};
  const kids = depth > 4 ? [] : Object.values(elements).filter((k) => k.location?.parentId === el._id && k.location.section === 'INBOX' && !isHidden(k));
  kids.sort((a, b) => (a.location?.position?.index ?? 0) - (b.location?.position?.index ?? 0));
  let box: Box;
  switch (el.elementType) {
    case 'CARD':
    case 'TASK':
      box = noteBox(docToText(c.textContent), m);
      break;
    case 'LINK':
      box = linkBox(docToText(c.caption), m);
      break;
    case 'TASK_LIST':
      box = todoBox(typeof c.title === 'string' ? c.title : undefined, kids.map((k) => ({ text: docToText(k.content?.textContent) })), m);
      break;
    case 'COLUMN':
      box = columnBox(kids.map((k) => estimateBox(k, elements, m, depth + 1)), m);
      break;
    case 'IMAGE': {
      const img = c.image as { width?: unknown; height?: unknown } | undefined;
      const ratio = positive(img?.width) && positive(img?.height) ? (img?.height as number) / (img?.width as number) : undefined;
      box = { w: m.imageWidth, h: Math.ceil(ratio ? m.imageWidth * ratio : m.imageHeight) };
      break;
    }
    case 'BOARD':
      box = { w: m.boardWidth, h: m.boardHeight };
      break;
    default:
      box = noteBox('', m);
  }
  return { w: positive(c.width) ?? box.w, h: positive(c.height) ?? box.h };
}
