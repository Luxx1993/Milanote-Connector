// Text <-> TipTap/ProseMirror-Dokument, wie Milanote es in `content.textContent` speichert.
// Unterstützt leichtes Markdown: Überschriften (# und ##), Listen (-, 1.), Aufgaben (- [ ] / - [x]), Zitate (>),
// Codeblöcke (```), Trennlinien (---), **fett**, *kursiv*, ~~durchgestrichen~~, `Code`, [Text](url) und nackte URLs.
// Milanote kennt laut Hilfe-Center nur zwei Überschriftsebenen („Large“ und „Normal heading“); ### wird deshalb wie ##
// behandelt. Trennlinien (Juni 2025), Inline-Code (Oktober 2026) und Codeblöcke sind in Hilfe bzw. Release Notes belegt
// (docs/official-sources.md). Die Knotenformen stammen aus milanote-plus-plus und sind am eigenen Konto nicht verifiziert.

export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
}

type Key = () => string;

const LINK_ATTRS = (href: string): Record<string, unknown> => ({ href, target: '_blank', rel: 'noopener noreferrer nofollow', class: null });

// Reihenfolge: Markdown-Link, fett, durchgestrichen, kursiv, Code, nackte URL.
const INLINE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|\*([^*\n]+)\*|`([^`\n]+)`|(https?:\/\/[^\s<>()]+)/g;

export function inlineNodes(text: string): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) nodes.push({ type: 'text', text: text.slice(last, index) });
    if (m[1] !== undefined && m[2] !== undefined) nodes.push({ type: 'text', text: m[1], marks: [{ type: 'link', attrs: LINK_ATTRS(m[2]) }] });
    else if (m[3] !== undefined) nodes.push({ type: 'text', text: m[3], marks: [{ type: 'bold' }] });
    else if (m[4] !== undefined) nodes.push({ type: 'text', text: m[4], marks: [{ type: 'strike' }] });
    else if (m[5] !== undefined) nodes.push({ type: 'text', text: m[5], marks: [{ type: 'italic' }] });
    else if (m[6] !== undefined) nodes.push({ type: 'text', text: m[6], marks: [{ type: 'code' }] });
    else if (m[7] !== undefined) {
      // Satzzeichen am Ende gehören nicht zur URL.
      const url = m[7].replace(/[.,;:!?]+$/, '');
      nodes.push({ type: 'text', text: url, marks: [{ type: 'link', attrs: LINK_ATTRS(url) }] });
      if (url.length < m[7].length) nodes.push({ type: 'text', text: m[7].slice(url.length) });
    }
    last = index + m[0].length;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
  return nodes;
}

function paragraph(text: string, key: Key): TipTapNode {
  const p: TipTapNode = { type: 'paragraph', attrs: { key: key(), textAlign: 'left' } };
  const content: TipTapNode[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    content.push(...inlineNodes(line));
  });
  if (content.length) p.content = content;
  return p;
}

/**
 * Text oder leichtes Markdown -> Dokument. Leerzeilen trennen Absätze, einfache Zeilenumbrüche
 * innerhalb eines Absatzes werden zu `hardBreak`.
 */
export function textToDoc(text: string, blockKey: Key): TipTapNode {
  const blocks: TipTapNode[] = [];
  let para: string[] = [];
  let list: { type: 'bulletList' | 'orderedList' | 'taskList'; node: TipTapNode } | undefined;

  const flushPara = () => {
    if (para.length) {
      blocks.push(paragraph(para.join('\n'), blockKey));
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list.node);
      list = undefined;
    }
  };
  const addItem = (type: 'bulletList' | 'orderedList' | 'taskList', item: TipTapNode) => {
    if (!list || list.type !== type) {
      flushList();
      const attrs: Record<string, unknown> = { key: blockKey() };
      if (type === 'orderedList') Object.assign(attrs, { start: 1, type: null });
      list = { type, node: { type, attrs, content: [] } };
    }
    list.node.content?.push(item);
  };

  let fence: { language: string | null; lines: string[] } | undefined;
  const flushFence = () => {
    if (!fence) return;
    const code: TipTapNode = { type: 'codeBlock', attrs: { key: blockKey(), language: fence.language } };
    if (fence.lines.length) code.content = [{ type: 'text', text: fence.lines.join('\n') }];
    blocks.push(code);
    fence = undefined;
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m: RegExpExecArray | null;
    if (fence) {
      if (/^\s*```\s*$/.test(line)) flushFence();
      else fence.lines.push(raw);
    } else if ((m = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line))) {
      flushPara();
      flushList();
      fence = { language: m[1] || null, lines: [] };
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', attrs: { key: blockKey(), textAlign: 'left', level: Math.min(2, (m[1] ?? '#').length) }, content: inlineNodes(m[2] ?? '') });
    } else if ((m = /^\s*[-*+]\s+\[( |x|X)\]\s+(.*)$/.exec(line))) {
      flushPara();
      addItem('taskList', { type: 'taskItem', attrs: { key: blockKey(), checked: m[1] !== ' ' }, content: [paragraph(m[2] ?? '', blockKey)] });
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) {
      flushPara();
      addItem('bulletList', { type: 'listItem', attrs: { key: blockKey() }, content: [paragraph(m[1] ?? '', blockKey)] });
    } else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
      flushPara();
      addItem('orderedList', { type: 'listItem', attrs: { key: blockKey() }, content: [paragraph(m[1] ?? '', blockKey)] });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flushPara();
      flushList();
      blocks.push({ type: 'blockquote', attrs: { key: blockKey() }, content: [paragraph(m[1] ?? '', blockKey)] });
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      flushList();
      blocks.push({ type: 'horizontalRule', attrs: { key: blockKey() } });
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushFence();
  flushPara();
  flushList();
  if (!blocks.length) blocks.push(paragraph('', blockKey));
  return { type: 'doc', content: blocks };
}

/** Reiner Text aus einem TipTap-Dokument (für Rückmeldungen und Prüfungen). */
export function docToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as TipTapNode;
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'horizontalRule') return '---';
  const inner = (n.content ?? []).map(docToText);
  switch (n.type) {
    case 'doc':
      return inner.join('\n\n');
    case 'bulletList':
      return (n.content ?? []).map((li) => `- ${docToText(li)}`).join('\n');
    case 'orderedList':
      return (n.content ?? []).map((li, i) => `${i + 1}. ${docToText(li)}`).join('\n');
    case 'taskList':
      return (n.content ?? []).map((ti) => `- [${ti.attrs?.checked ? 'x' : ' '}] ${docToText(ti)}`).join('\n');
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level) || 1)} ${inner.join('')}`;
    case 'blockquote':
      return `> ${inner.join('\n')}`;
    case 'codeBlock':
      return `\`\`\`${typeof n.attrs?.language === 'string' ? n.attrs.language : ''}\n${inner.join('')}\n\`\`\``;
    case 'listItem':
    case 'taskItem':
      return inner.join('\n');
    default:
      return inner.join('');
  }
}
