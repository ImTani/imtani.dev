/**
 * An article.md as the block editor sees it: front matter, then a list of
 * top-level Markdown blocks, each holding the exact source text it came from.
 *
 * THE PROMISE IS BYTE-IDENTITY FOR WHAT WAS NOT TOUCHED. The file is cut into
 *
 *     front matter | head | block 0 | gap 1 | block 1 | gap 2 | … | block n | tail
 *
 * where every piece is a slice of the original text, so joining them again is
 * the original file, byte for byte. A block that is edited keeps its place and
 * the gaps on either side of it; a block that is moved, inserted or loses a
 * neighbour is joined to the blocks around it by one blank line. So opening a
 * file and saving it with no changes writes exactly the bytes that were read,
 * and editing one paragraph changes only that paragraph's lines. Both are
 * tested (test/writing-editor.test.ts).
 *
 * The front matter is the same: kept as read unless the form changed it, and
 * then written by `serialize` in frontmatter.ts, which keeps the comments.
 *
 * Where blocks start and end is markdown-it's answer — the same parser, with
 * the same options, as build.ts — plus the one construct the build reads
 * before markdown-it does: an aside, `<aside>` to `</aside>` on lines of their
 * own, which may hold blank lines and is cut with the regular expression the
 * build's `unwrapAsides` uses. Lines markdown-it consumes without a token (a
 * link reference definition) become a raw block, so nothing is ever dropped.
 *
 * Pure: no file system, no network. The server in this folder does the I/O.
 */

import { createHash } from 'node:crypto';

import MarkdownIt from 'markdown-it';

import {
  type FmData,
  type FmValue,
  type FrontMatter,
  FrontMatterError,
  isList,
  isMap,
  parse,
  serialize,
} from '../frontmatter.ts';

/** Block-level parsing only, configured as build.ts configures its own. */
const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

type Token = ReturnType<MarkdownIt['parse']>[number];

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'image'
  | 'clip'
  | 'figure'
  | 'remote'
  | 'aside'
  | 'code'
  | 'quote'
  | 'rule'
  | 'table'
  | 'html'
  | 'raw';

export interface Split {
  /** Body text before the first block (normally the blank line after `---`). */
  readonly head: string;
  /** Each block's source, exactly as written, without the line break after it. */
  readonly blocks: readonly string[];
  /** `gaps[i]` is the text between block i-1 and block i; `gaps[0]` is ''. */
  readonly gaps: readonly string[];
  /** Body text after the last block (normally the file's final line break). */
  readonly tail: string;
}

/** The same shape as `unwrapAsides` in build.ts, on LF text. */
const ASIDE = /^<aside>\n[\s\S]*?\n<\/aside>$/gm;

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

/** The line a character offset is on, 0-based. */
function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Cut a body (LF line endings) into top-level blocks. Joining
 * `head + blocks[0] + gaps[1] + blocks[1] + … + tail` is `body`.
 */
export function splitBody(body: string): Split {
  const lines = body.split('\n');
  const starts = lineStarts(body);
  const blank = (n: number) => (lines[n] as string).trim() === '';
  /** [first line, line after the last), 0-based. */
  const spans: Array<[number, number]> = [];

  const asides: Array<[number, number]> = [];
  for (const m of body.matchAll(ASIDE)) {
    const first = lineAt(starts, m.index);
    const last = lineAt(starts, m.index + m[0].length - 1);
    asides.push([first, last + 1]);
  }

  const parseRange = (from: number, to: number) => {
    if (to <= from) return;
    const tokens = md.parse(lines.slice(from, to).join('\n'), {});
    for (const token of tokens) {
      if (token.level !== 0 || token.nesting === -1 || !token.map) continue;
      spans.push([from + token.map[0], from + token.map[1]]);
    }
  };
  let at = 0;
  for (const aside of asides) {
    parseRange(at, aside[0]);
    spans.push(aside);
    at = aside[1];
  }
  parseRange(at, lines.length);

  // A block ends at its last non-blank line; the blank lines are the gap's.
  for (const span of spans) {
    while (span[1] > span[0] && blank(span[1] - 1)) span[1] -= 1;
  }
  const kept = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);

  // Lines no token claimed and that are not blank: a raw block each run.
  const claimed = new Uint8Array(lines.length);
  for (const [a, b] of kept) claimed.fill(1, a, b);
  for (let n = 0; n < lines.length; ) {
    if (claimed[n] || blank(n)) {
      n += 1;
      continue;
    }
    let end = n;
    while (end < lines.length && !claimed[end] && !blank(end)) end += 1;
    kept.push([n, end]);
    n = end;
  }
  kept.sort((x, y) => x[0] - y[0]);

  const offsets = kept.map(([a, b]) => {
    const start = starts[a] as number;
    const end = (starts[b - 1] as number) + (lines[b - 1] as string).length;
    return [start, end] as const;
  });
  if (!offsets.length) return { head: body, blocks: [], gaps: [], tail: '' };

  const blocks = offsets.map(([s, e]) => body.slice(s, e));
  const gaps = offsets.map(([s], i) => (i === 0 ? '' : body.slice((offsets[i - 1] as readonly [number, number])[1], s)));
  return {
    head: body.slice(0, (offsets[0] as readonly [number, number])[0]),
    blocks,
    gaps,
    tail: body.slice((offsets[offsets.length - 1] as readonly [number, number])[1]),
  };
}

/** A block in the editor: its source, and which original block it is, if any. */
export interface PlacedBlock {
  readonly src: string;
  /** Index into `Split.blocks` of the block this was read as; absent if new. */
  readonly orig?: number | undefined;
}

/**
 * Join blocks back into a body. Two blocks that were neighbours in the file
 * and still are keep the exact text that was between them; any other pair is
 * one blank line apart.
 */
export function composeBody(split: Split, blocks: readonly PlacedBlock[]): string {
  // A body that had no blocks is all blank lines; the first ones written into
  // it go after one blank line and end with a line break, as a file should.
  if (!split.blocks.length && blocks.length) {
    return `\n${blocks.map((b) => b.src).join('\n\n')}\n`;
  }
  let out = split.head;
  blocks.forEach((block, i) => {
    if (i > 0) {
      const prev = blocks[i - 1] as PlacedBlock;
      const neighbours =
        block.orig !== undefined && prev.orig !== undefined && block.orig === prev.orig + 1 && block.orig < split.gaps.length;
      out += neighbours ? (split.gaps[block.orig as number] as string) : '\n\n';
    }
    out += block.src;
  });
  return out + split.tail;
}

/** An edited block's text, as it will be stored: LF, no blank lines at either end. */
export function cleanBlockSource(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/(?:\n[ \t]*)+$/, '')
    .replace(/^[ \t]+$/, '');
}

// ------------------------------------------------------------------ types ---

function soleImageSrc(inline: Token | undefined): string | null {
  if (inline?.type !== 'inline' || !inline.children) return null;
  const meaningful = inline.children.filter((c) => !(c.type === 'text' && c.content.trim() === ''));
  const only = meaningful[0];
  if (only?.type !== 'image') return null;
  if (meaningful.length === 1) return only.attrGet('src') ?? '';
  const tail = meaningful[1];
  if (meaningful.length === 2 && tail?.type === 'text' && /^\{[^}]*\}$/.test(tail.content.trim())) {
    return only.attrGet('src') ?? '';
  }
  return null;
}

/** What kind of block a piece of source is, for the editor's label and fields. */
export function blockType(src: string): BlockType {
  if (/^<aside>\n[\s\S]*\n<\/aside>$/.test(src)) return 'aside';
  const tokens = md.parse(src, {});
  const top = tokens.filter((t) => t.level === 0 && t.nesting !== -1);
  const first = top[0];
  if (!first || top.length !== 1) return 'raw';
  switch (first.type) {
    case 'heading_open':
      return 'heading';
    case 'paragraph_open': {
      const image = soleImageSrc(tokens[1]);
      if (image === null) return 'paragraph';
      if (image.startsWith('figure:')) return 'figure';
      if (/^https?:\/\//i.test(image)) return 'remote';
      if (/\.mp4$/i.test(image)) return 'clip';
      return 'image';
    }
    case 'bullet_list_open':
    case 'ordered_list_open':
      return 'list';
    case 'fence':
      return 'code';
    case 'blockquote_open':
      return 'quote';
    case 'hr':
      return 'rule';
    case 'table_open':
      return 'table';
    case 'html_block':
      return 'html';
    default:
      return 'raw';
  }
}

// ------------------------------------------------------------------- file ---

export type Eol = '\n' | '\r\n' | 'mixed';

export interface LoadedFile {
  /** sha256 of the bytes as read, so a save can tell the file changed under it. */
  readonly hash: string;
  readonly bom: boolean;
  readonly eol: Eol;
  /** The front matter block, LF, through the closing `---` and its line break. */
  readonly fmRaw: string;
  /** The parsed front matter, or why it could not be read. */
  readonly fm: FrontMatter | null;
  readonly fmError?: string;
  readonly body: string;
  readonly split: Split;
}

export function hashOf(raw: string | Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function loadText(raw: string): LoadedFile {
  const bom = raw.startsWith('﻿');
  const unbommed = bom ? raw.slice(1) : raw;
  const crlf = (unbommed.match(/\r\n/g) ?? []).length;
  const lf = (unbommed.match(/\n/g) ?? []).length;
  const eol: Eol = crlf === 0 ? '\n' : crlf === lf ? '\r\n' : 'mixed';
  const text = unbommed.replace(/\r\n/g, '\n');

  const lines = text.split('\n');
  let fmRaw = '';
  let body = text;
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1);
    if (close !== -1) {
      fmRaw = `${lines.slice(0, close + 1).join('\n')}${close + 1 < lines.length ? '\n' : ''}`;
      body = text.slice(fmRaw.length);
    }
  }

  let fm: FrontMatter | null = null;
  let fmError: string | undefined;
  try {
    fm = parse(text);
  } catch (error) {
    fmError = error instanceof Error ? error.message : String(error);
  }

  return { hash: hashOf(raw), bom, eol, fmRaw, fm, ...(fmError ? { fmError } : {}), body, split: splitBody(body) };
}

/** What the form sends back: the whole front matter, values and comments. */
export interface FrontMatterEdit {
  readonly data: FmData;
  readonly comments: Readonly<Record<string, readonly string[]>>;
}

function pathsOf(data: FmData): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    paths.push(key);
    if (isList(value)) value.forEach((_, i) => paths.push(`${key}.${i}`));
    else if (isMap(value)) for (const sub of Object.keys(value)) paths.push(`${key}.${sub}`);
  }
  return paths;
}

function hasPath(data: FmData, path: string): boolean {
  if (path === '') return true;
  const dot = path.indexOf('.');
  if (dot === -1) return path in data;
  const value: FmValue | undefined = data[path.slice(0, dot)];
  const sub = path.slice(dot + 1);
  if (isList(value)) return Number(sub) < value.length;
  if (isMap(value)) return sub in value;
  return false;
}

/**
 * Write an edited front matter. A comment above a key that has been removed is
 * not lost with it: it moves to the next line that still exists, so reasoning
 * written into the block can only be deleted on purpose.
 */
export function composeFrontMatter(original: FrontMatter | null, edit: FrontMatterEdit): string {
  const comments: Record<string, string[]> = {};
  for (const [path, lines] of Object.entries(edit.comments)) comments[path] = [...lines];
  const order = original ? [...pathsOf(original.data), ''] : [''];
  for (const path of Object.keys(comments)) {
    if (hasPath(edit.data, path)) continue;
    const lines = comments[path] as string[];
    delete comments[path];
    const from = order.indexOf(path);
    const next = order.slice(from === -1 ? order.length - 1 : from + 1).find((p) => hasPath(edit.data, p)) ?? '';
    comments[next] = next === '' ? [...(comments[next] ?? []), ...lines] : [...lines, ...(comments[next] ?? [])];
  }
  const text = serialize({ data: edit.data, comments, body: '' });
  // Read back what was written: anything serialize let through that parse
  // would not take is refused here rather than saved.
  parse(text);
  return text;
}

/** What the editor sends to save, preview or check an article. */
export interface DocumentState {
  /** The hash of the file the editor loaded. */
  readonly baseHash: string;
  /** Front matter: unchanged, edited through the form, or edited as text. */
  readonly fm:
    | { readonly mode: 'unchanged' }
    | ({ readonly mode: 'form' } & FrontMatterEdit)
    | { readonly mode: 'raw'; readonly text: string };
  readonly blocks: readonly PlacedBlock[];
}

/** The whole file the state describes, LF and without a BOM. */
export function composeText(file: LoadedFile, state: DocumentState): string {
  let fm: string;
  if (state.fm.mode === 'unchanged') {
    fm = file.fmRaw;
  } else if (state.fm.mode === 'form') {
    fm = composeFrontMatter(file.fm, state.fm);
  } else {
    fm = state.fm.text.replace(/\r\n?/g, '\n');
    if (!fm.endsWith('\n')) fm += '\n';
  }
  const blocks = state.blocks.map((b) => {
    const orig = typeof b.orig === 'number' && Number.isInteger(b.orig) && b.orig >= 0 && b.orig < file.split.blocks.length ? b.orig : undefined;
    return { src: String(b.src).replace(/\r\n?/g, '\n'), orig };
  });
  return fm + composeBody(file.split, blocks);
}

/** The text as bytes go to disk: the file's own line endings and BOM. */
export function encodeLike(file: LoadedFile, text: string): string {
  if (file.eol === 'mixed') {
    throw new FrontMatterError('the file has mixed line endings (CRLF and LF); refusing to rewrite it');
  }
  const body = file.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  return file.bom ? `﻿${body}` : body;
}

/** The blocks of a freshly loaded file, each in its original place. */
export function originalBlocks(file: LoadedFile): PlacedBlock[] {
  return file.split.blocks.map((src, orig) => ({ src, orig }));
}

// ------------------------------------------------------------------ drafts ---

/**
 * A new article.md: the required fields filled in or left visibly empty, and
 * every optional one written out as a comment to uncomment. `description` is
 * left empty on purpose, so the draft fails its check until it is written.
 */
export function draftTemplate(title: string, author: string, today: string): string {
  const optional = [
    '# Optional fields — uncomment what this article needs. The format is',
    '# specified in site/articles/README.md.',
    '# deck: The line under the title.',
    '# handle: infiniTani',
    '# kind: Article',
    `# published: ${today}`,
    `# updated: ${today}`,
    '# image: media/cover.webp',
    '# keywords:',
    '#   - Godot',
    '# about:',
    '#   type: VideoGame',
    '#   name: The thing it is about',
    '#   url: https://example.com',
    '# award:',
    '#   text: The prize',
    '#   event: The event',
    '#   url: https://example.com',
    '# elsewhere:',
    '#   - label | https://example.com',
    '# colophon:',
    '#   - label | https://example.com',
    '# canonical: https://example.com/where-it-was-first-published',
    '# toc: false',
    '# draft: true',
  ];
  return serialize({
    data: { title, author, date: today, description: '' },
    comments: { '': optional },
    body: '\n',
  });
}
