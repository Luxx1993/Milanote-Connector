// Text <-> TipTap/ProseMirror-Dokument, wie Milanote es in `content.textContent` speichert.
// Phase 1: nur Absätze und Zeilenumbrüche. Markdown (Überschriften, Listen, Marks) folgt in Phase 3.

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Leerzeilen trennen Absätze, einfache Zeilenumbrüche werden zu `hardBreak`. */
export function textToDoc(text: string, blockKey: () => string): TipTapNode {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.replace(/^\n+|\n+$/g, ''))
    .filter((block) => block.trim() !== '');
  return {
    type: 'doc',
    content: paragraphs.map((block) => {
      const inline: TipTapNode[] = [];
      block.split('\n').forEach((line, index) => {
        if (index > 0) inline.push({ type: 'hardBreak' });
        if (line) inline.push({ type: 'text', text: line });
      });
      const paragraph: TipTapNode = { type: 'paragraph', attrs: { key: blockKey(), textAlign: 'left' } };
      if (inline.length) paragraph.content = inline;
      return paragraph;
    }),
  };
}

/** Reiner Text aus einem TipTap-Dokument (für Rückmeldungen und Prüfungen). */
export function docToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as TipTapNode;
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  const inner = (n.content ?? []).map(docToText);
  if (n.type === 'doc') return inner.join('\n\n');
  if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') return inner.join('\n');
  return inner.join('');
}
