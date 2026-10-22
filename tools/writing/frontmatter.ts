/**
 * The front matter of an article.md: a deliberately small, hand-parsed subset
 * of YAML, and a serialiser that writes it back the same way.
 *
 * NOT YAML. A YAML parser would be a dependency, and YAML's surprises — `no`
 * meaning false, `1.10` meaning 1.1, a colon in a title starting a mapping —
 * are exactly what a hand-written format for one person's articles does not
 * need. This reads three shapes and nothing else, and every value comes back as
 * a STRING: what a value means (a date, a number, a URL) is decided by the
 * article schema in articles.ts, not by how it happened to be spelled.
 *
 *   ---
 *   # a comment, on a line of its own
 *   title: Rise&Shine Devlog          scalar
 *   keywords:                         list of scalars, items indented 2 spaces
 *     - Godot
 *     - game jam
 *   award:                            map of scalars, entries indented 2 spaces
 *     text: Most Educational Devlog Prize
 *     url: https://itch.io/jam/learn-you-a-game-jam-2024
 *   ---
 *
 * Keys are `[A-Za-z][A-Za-z0-9_-]*`. A value is everything after `: ` to the
 * end of the line, trimmed; quote it with "…" (escapes \" and \\) or '…' ('' for
 * a quote) to keep edge whitespace, start with a quote or `#`, or be empty.
 * There are no inline comments — `#` mid-line is part of the value, which is
 * what a URL fragment needs. No nesting below one level, no inline `[a, b]`
 * lists, no multi-line strings, no tabs. Anything else is an error that names
 * its line, never a guess.
 *
 * COMMENTS AND BLANK LINES SURVIVE A ROUND TRIP. They are kept, verbatim, as
 * the lines in front of the key or item they precede (see `comments`), so an
 * editor that parses, changes one value and serialises again leaves every
 * other line of the block — including the reasoning written above a setting —
 * exactly as it was. For a block already in the canonical form `serialize`
 * writes, `serialize(parse(text))` is `text`, byte for byte; that is tested.
 */

export type FmScalar = string;
export type FmList = readonly string[];
export type FmMap = Readonly<Record<string, string>>;
export type FmValue = FmScalar | FmList | FmMap;
export type FmData = Readonly<Record<string, FmValue>>;

export interface FrontMatter {
  /** Keys in source order, values as strings, lists or one-level maps. */
  readonly data: FmData;
  /**
   * Comment and blank lines, verbatim, keyed by what follows them: `title`,
   * `award`, `award.url`, `keywords.0`. Lines after the last entry are under
   * the empty key `''`.
   */
  readonly comments: Readonly<Record<string, readonly string[]>>;
  /** Everything after the closing `---` line. */
  readonly body: string;
}

export class FrontMatterError extends Error {
  /** 1-based, counting the opening `---` as line 1. */
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'FrontMatterError';
    this.line = line;
  }
}

const FENCE = '---';
const KEY = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ ]+(.*?))?[ ]*$/;
const ITEM = /^ {2}- (.*?)[ ]*$/;
const ENTRY = /^ {2}([A-Za-z][A-Za-z0-9_-]*):(?:[ ]+(.*?))?[ ]*$/;

export function isList(value: FmValue | undefined): value is FmList {
  return Array.isArray(value);
}

export function isMap(value: FmValue | undefined): value is FmMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unquote(raw: string, line: number): string {
  const q = raw[0];
  if (q !== '"' && q !== "'") return raw;
  if (raw.length < 2 || raw[raw.length - 1] !== q) {
    throw new FrontMatterError(`unterminated ${q === '"' ? 'double' : 'single'}-quoted value`, line);
  }
  const inner = raw.slice(1, -1);
  if (q === "'") {
    if (/'(?!')/.test(inner.replace(/''/g, ''))) {
      throw new FrontMatterError("a single quote inside '…' is written ''", line);
    }
    return inner.replace(/''/g, "'");
  }
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i] as string;
    if (c === '\\') {
      const next = inner[i + 1];
      if (next !== '"' && next !== '\\') {
        throw new FrontMatterError('inside "…" only \\" and \\\\ are escapes', line);
      }
      out += next;
      i += 1;
    } else if (c === '"') {
      throw new FrontMatterError('a double quote inside "…" is written \\"', line);
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Split an article file into front matter and body. The block is required and
 * must open on the very first line.
 */
export function parse(text: string): FrontMatter {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  if (lines[0] !== FENCE) {
    throw new FrontMatterError('an article must start with a front matter block: a line of three dashes', 1);
  }

  const data: Record<string, FmValue> = {};
  const comments: Record<string, string[]> = {};
  let pending: string[] = [];
  let open: { key: string; line: number; kind: 'unknown' | 'list' | 'map'; list: string[]; map: Record<string, string> } | null = null;

  const flush = () => {
    if (!open) return;
    data[open.key] = open.kind === 'list' ? open.list : open.kind === 'map' ? open.map : '';
    open = null;
  };
  const note = (path: string) => {
    if (pending.length) comments[path] = pending;
    pending = [];
  };

  let i = 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const n = i + 1;
    if (line === FENCE) break;
    if (line.includes('\t')) throw new FrontMatterError('tabs are not allowed; indent with two spaces', n);
    if (line.trim() === '' || /^\s*#/.test(line)) {
      pending.push(line.trimEnd());
      continue;
    }

    const key = KEY.exec(line);
    if (key) {
      flush();
      const name = key[1] as string;
      if (name in data) throw new FrontMatterError(`"${name}" is given twice`, n);
      note(name);
      const value = key[2];
      if (value === undefined || value === '') {
        open = { key: name, line: n, kind: 'unknown', list: [], map: {} };
      } else {
        data[name] = unquote(value, n);
      }
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      if (!open || open.kind === 'map') {
        throw new FrontMatterError('a list item has to follow a "key:" line with no value', n);
      }
      open.kind = 'list';
      note(`${open.key}.${open.list.length}`);
      open.list.push(unquote(item[1] as string, n));
      continue;
    }

    const entry = ENTRY.exec(line);
    if (entry) {
      if (!open || open.kind === 'list') {
        throw new FrontMatterError('an indented "key: value" has to follow a "key:" line with no value', n);
      }
      open.kind = 'map';
      const sub = entry[1] as string;
      if (sub in open.map) throw new FrontMatterError(`"${open.key}.${sub}" is given twice`, n);
      note(`${open.key}.${sub}`);
      open.map[sub] = entry[2] === undefined ? '' : unquote(entry[2], n);
      continue;
    }

    throw new FrontMatterError(
      `cannot read "${line.trim()}". Expected "key: value", "key:", "  - item" or "  key: value"`,
      n,
    );
  }

  if (i >= lines.length) throw new FrontMatterError('the front matter block is never closed with "---"');
  flush();
  note('');

  return { data, comments, body: lines.slice(i + 1).join('\n') };
}

/** Quote a value only when reading it back bare would change it. */
function quote(value: string): string {
  if (/[\r\n]/.test(value)) throw new FrontMatterError(`a value cannot span lines: ${JSON.stringify(value)}`);
  if (value === '' || /^\s|\s$/.test(value) || /^["'#]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function checkKey(key: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new FrontMatterError(`not a valid key: "${key}"`);
}

/**
 * Write front matter and body back out, LF line endings. `comments` is what
 * `parse` returned (or a subset of it); entries for keys that no longer exist
 * are dropped.
 */
export function serialize(fm: {
  readonly data: FmData;
  readonly comments?: Readonly<Record<string, readonly string[]>>;
  readonly body: string;
}): string {
  const out: string[] = [FENCE];
  const c = fm.comments ?? {};
  const before = (path: string) => out.push(...(c[path] ?? []));

  for (const [key, value] of Object.entries(fm.data)) {
    checkKey(key);
    before(key);
    if (isList(value)) {
      out.push(`${key}:`);
      value.forEach((item, k) => {
        before(`${key}.${k}`);
        out.push(`  - ${quote(item)}`);
      });
    } else if (isMap(value)) {
      out.push(`${key}:`);
      for (const [sub, v] of Object.entries(value)) {
        checkKey(sub);
        before(`${key}.${sub}`);
        out.push(`  ${sub}: ${quote(v)}`);
      }
    } else {
      out.push(`${key}: ${quote(value)}`);
    }
  }
  before('');
  out.push(FENCE);
  return `${out.join('\n')}\n${fm.body}`;
}
