/**
 * Local prose editor for the Rise&Shine devlog source.
 *
 *   npm run devlog:edit        ->  http://127.0.0.1:4300
 *
 * Edits the Notion export in place (the export is the source of truth) through
 * a list of prepared "places to change", plus a free paragraph search. Every
 * write matches on exact text, never on line numbers, and refuses unless the
 * text is found exactly as many times as expected. Line endings and encoding
 * are preserved, a timestamped backup goes to `.edit-backups/` beside the
 * file, and the write is temp-file + rename.
 *
 * `DEVLOG_MD` overrides the markdown path (used for testing against a copy).
 * `DEVLOG_BUILD_CMD` overrides the rebuild command (default `npm run build`).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  copyFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..', '..', '..');
const FIGURE_TEXT = resolve(here, '..', 'figure-text.json');
const HTML = join(here, 'editor.html');

const DEFAULT_MD = resolve(
  siteRoot,
  '../rise-and-shine-devlog/Rise&Shine Devlog 5aed9b9b966a49abaf401e560ceccd6a.md',
);
const MD = resolve(process.env['DEVLOG_MD'] ?? DEFAULT_MD);
const BACKUPS = join(dirname(MD), '.edit-backups');
const STATE = join(BACKUPS, 'editor-state.json');
const HOST = '127.0.0.1';
const PORT = 4300;

type Card = {
  id: string;
  title: string;
  why: string;
  kind: 'replace' | 'insert' | 'remove';
  optional?: boolean;
  note?: string;
  /** Exact text to find (LF line endings). */
  current: string;
  /** What the textarea starts as: the full replacement for `current`. Unused for removals. */
  suggested: string;
  /** How many times `current` must occur. 2 for Notion caption pairs. */
  expect: number;
};

const CARDS: Card[] = [
  {
    id: 'toc',
    title: 'Where the contents is',
    why: 'The contents now sits right, on top, or behind the menu depending on screen size.',
    kind: 'replace',
    current:
      'If you are on a larger screen, there is a table of contents to the right of this text, you can skip through to specific sections from there.',
    suggested:
      "If you'd rather skip to a specific section, the table of contents will take you there.",
    expect: 1,
  },
  {
    id: 'cap-interp',
    title: 'Interpolation caption',
    why: 'The redrawn figure is green and terracotta and has its own key.',
    kind: 'replace',
    note: 'A caption appears twice in the export (image alt and the paragraph under it). Both change together.',
    current: 'Smooth Interpolation (Blue) from Data Points (Red)',
    suggested: 'Smooth Interpolation from Data Points',
    expect: 2,
  },
  {
    id: 'cap-sine',
    title: 'Sine caption',
    why: 'The GIF is being replaced, so the joke stops being true.',
    kind: 'replace',
    note: 'A caption appears twice in the export (image alt and the paragraph under it). Both change together.',
    current: 'Sin Wave  (This GIF doesn’t like to be centered. . . )',
    suggested: 'Sine Wave',
    expect: 2,
  },
  {
    id: 'godot-y',
    title: 'Godot flips Y',
    why: "The prose describes maths convention; Godot's 2D Y points down, and the next section moves vertices in a Godot shader.",
    kind: 'insert',
    note: 'Appended to the end of the paragraph in "The 2D Coordinate System". The textarea holds the sentence it follows plus the new sentence.',
    current: 'when you move to the left, it will *decrease*.',
    suggested:
      'when you move to the left, it will *decrease*. Godot flips the Y-axis, though: in 2D, moving down increases Y. Flip the switch on the grid to see it.',
    expect: 1,
  },
  {
    id: 'gif-above',
    title: '"the gif above"',
    why: 'The figure above is becoming an interactive grid, not a gif.',
    kind: 'replace',
    current: 'Another example is the point (4, 3) that you see in the gif above.',
    suggested: 'Another example is the point (4, 3) on the grid above.',
    expect: 1,
  },
  {
    id: 'rm-inheritance',
    title: 'Remove the Real Python title image',
    why: 'A borrowed title image with a caption that only repeats the heading.',
    kind: 'remove',
    note: 'Removes only the image line and the caption paragraph straight after it. The heading is not touched.',
    current:
      '![Inheritance and Composition](54f20446-f1ca-4d75-b92c-6af65b17d6d2.png)\n\nInheritance and Composition\n\n',
    suggested: '',
    expect: 1,
  },
  {
    id: 'rm-ecs',
    title: 'Remove the ECS image',
    why: 'A borrowed diagram whose caption only repeats the heading.',
    kind: 'remove',
    note: 'Removes only the image line and the caption paragraph straight after it. The "### Entity Component System" heading is not touched.',
    current: '![Entity Component System](Untitled%208.png)\n\nEntity Component System\n\n',
    suggested: '',
    expect: 1,
  },
  {
    id: 'ecs-book',
    title: 'ECS by the book',
    why: 'The textbook ECS keeps logic in Systems; his components carry behaviour.',
    kind: 'insert',
    optional: true,
    note: 'Optional. Adds a new paragraph after the one ending "They handle things like physics, rendering, or AI logic."',
    current: 'They handle things like physics, rendering, or AI logic.',
    suggested:
      "They handle things like physics, rendering, or AI logic.\n\nGodot doesn't do ECS by the book, since my components carry their own logic instead of leaving it to Systems, but the idea of building a player out of small swappable parts is the same.",
    expect: 1,
  },
];

// ---------------------------------------------------------------- file access

type Loaded = { text: string; eol: '\n' | '\r\n' };

class Refusal extends Error {}

function load(): Loaded {
  const raw = readFileSync(MD, 'utf8');
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const lf = (raw.match(/\n/g) ?? []).length;
  if (crlf > 0 && crlf !== lf) {
    throw new Refusal('The file has mixed line endings (CRLF and LF); refusing to touch it.');
  }
  const eol = crlf > 0 ? '\r\n' : '\n';
  return { eol, text: eol === '\r\n' ? raw.replace(/\r\n/g, '\n') : raw };
}

function countOf(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n++;
  return n;
}

function backupAndWrite(newText: string, eol: string): string {
  mkdirSync(BACKUPS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = join(BACKUPS, `${basename(MD)}.${stamp}.bak`);
  copyFileSync(MD, backup);
  const out = eol === '\r\n' ? newText.replace(/\n/g, '\r\n') : newText;
  const tmp = join(dirname(MD), `.${basename(MD)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, out, 'utf8');
    renameSync(tmp, MD);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
  return backup;
}

type State = { kept: string[]; applied: Record<string, string | true> };

function readState(): State {
  try {
    const s = JSON.parse(readFileSync(STATE, 'utf8'));
    return { kept: s.kept ?? [], applied: s.applied ?? {} };
  } catch {
    return { kept: [], applied: {} };
  }
}

function writeState(s: State): void {
  mkdirSync(BACKUPS, { recursive: true });
  const tmp = `${STATE}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, STATE);
}

// ---------------------------------------------------------------- cards

/**
 * Status is read off the file each time. The only memory is which text was
 * last applied (so a hand-edited replacement still reads as applied) and which
 * cards were marked "use current"; both are checked against the file.
 */
function cardView(card: Card, text: string, state: State) {
  const found = countOf(text, card.current);
  const recorded = state.applied[card.id];
  let status: 'pending' | 'applied' | 'kept' | 'not found';
  if (card.kind === 'remove') {
    status = found === card.expect ? 'pending' : recorded === true ? 'applied' : 'not found';
  } else if (typeof recorded === 'string' && countOf(text, recorded) >= 1) {
    status = 'applied';
  } else if (card.kind === 'insert' && countOf(text, card.suggested) === 1) {
    status = 'applied';
  } else if (found === card.expect) {
    status = state.kept.includes(card.id) ? 'kept' : 'pending';
  } else if (card.kind === 'replace' && found === 0 && countOf(text, card.suggested) === card.expect) {
    status = 'applied';
  } else {
    status = 'not found';
  }
  const idx = text.indexOf(card.current);
  const view = {
    id: card.id,
    title: card.title,
    why: card.why,
    kind: card.kind,
    optional: !!card.optional,
    note: card.note ?? '',
    expect: card.expect,
    found,
    status,
    suggested: card.suggested,
    current: card.current,
    line: idx === -1 ? null : lineOf(text, idx),
    before: '',
    after: '',
  };
  if (idx !== -1) {
    const b0 = Math.max(0, idx - 280);
    const a0 = idx + card.current.length;
    view.before = (b0 > 0 ? '…' : '') + text.slice(b0, idx);
    view.after = text.slice(a0, a0 + 280) + (a0 + 280 < text.length ? '…' : '');
  }
  return view;
}

function applyCard(id: string, newText: string): { backup: string } {
  const card = CARDS.find((c) => c.id === id);
  if (!card) throw new Refusal(`No such card: ${id}`);
  const { text, eol } = load();
  const found = countOf(text, card.current);
  if (found !== card.expect) {
    throw new Refusal(
      `Refused: the current text was found ${found} time(s), expected exactly ${card.expect}. Nothing was written.`,
    );
  }
  const clean = newText.replace(/\r\n/g, '\n');
  let replacement: string;
  if (card.kind === 'remove') {
    replacement = '';
  } else {
    if (!clean.trim()) throw new Refusal('Refused: the replacement is empty.');
    if (card.expect > 1 && clean.includes('\n')) {
      throw new Refusal('Refused: a caption must be a single line.');
    }
    replacement = clean;
  }
  const next = text.split(card.current).join(replacement);
  const backup = backupAndWrite(next, eol);
  const state = readState();
  state.applied[id] = card.kind === 'remove' ? true : replacement;
  state.kept = state.kept.filter((k) => k !== id);
  writeState(state);
  return { backup };
}

// ---------------------------------------------------------------- search

type Para = { line: number; text: string };

function paragraphs(text: string): Para[] {
  const out: Para[] = [];
  let cur: string[] = [];
  let start = 0;
  text.split('\n').forEach((l, i) => {
    if (l.trim() === '') {
      if (cur.length) out.push({ line: start, text: cur.join('\n') });
      cur = [];
    } else {
      if (!cur.length) start = i + 1;
      cur.push(l);
    }
  });
  if (cur.length) out.push({ line: start, text: cur.join('\n') });
  return out;
}

function search(q: string): Para[] {
  const { text } = load();
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return paragraphs(text)
    .filter((p) => p.text.toLowerCase().includes(needle))
    .slice(0, 40);
}

function editParagraph(original: string, replacement: string): { backup: string } {
  const { text, eol } = load();
  const orig = original.replace(/\r\n/g, '\n');
  const repl = replacement.replace(/\r\n/g, '\n');
  if (!orig.trim()) throw new Refusal('Refused: no original paragraph given.');
  const matches = paragraphs(text).filter((p) => p.text === orig);
  if (matches.length !== 1) {
    throw new Refusal(
      `Refused: that paragraph was found ${matches.length} time(s) as a whole paragraph, expected exactly 1. ` +
        'The file may have changed since you searched; search again. Nothing was written.',
    );
  }
  if (!repl.trim()) throw new Refusal('Refused: the replacement is empty.');
  const m = matches[0]!;
  const lines = text.split('\n');
  lines.splice(m.line - 1, orig.split('\n').length, ...repl.split('\n'));
  return { backup: backupAndWrite(lines.join('\n'), eol) };
}

// ---------------------------------------------------------------- build

let building = false;
function rebuild(): Promise<{ ok: boolean; code: number | null; tail: string; ms: number }> {
  if (building) return Promise.reject(new Refusal('A build is already running.'));
  building = true;
  const started = Date.now();
  const cmd = process.env['DEVLOG_BUILD_CMD'] ?? 'npm run build';
  return new Promise((done) => {
    const child = spawn(cmd, { cwd: siteRoot, shell: true });
    let out = '';
    const take = (d: Buffer) => {
      out += d.toString();
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const finish = (code: number | null, extra = '') => {
      building = false;
      const clean = (out + extra).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
      const tail = clean.trimEnd().split(/\r?\n/).slice(-60).join('\n');
      done({ ok: code === 0, code, tail, ms: Date.now() - started });
    };
    child.on('error', (e) => finish(null, `\n${e.message}`));
    child.on('close', (code) => finish(code));
  });
}

// ---------------------------------------------------------------- http

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((ok, fail) => {
    let s = '';
    req.on('data', (d) => {
      s += d;
      if (s.length > 1_000_000) fail(new Refusal('Request too large.'));
    });
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch {
        fail(new Refusal('Bad JSON.'));
      }
    });
  });
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const server = createServer(async (req, res) => {
  try {
    // Guards against DNS rebinding and cross-site POSTs: this server rewrites a file.
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'Bad host.' });
    const origin = req.headers.origin;
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) {
      return send(res, 403, { error: 'Bad origin.' });
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, readFileSync(HTML, 'utf8'), 'text/html');
    }
    if (req.method === 'GET' && url.pathname === '/api/cards') {
      const { text } = load();
      const state = readState();
      return send(res, 200, { file: MD, cards: CARDS.map((c) => cardView(c, text, state)) });
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
      return send(res, 200, { results: search(url.searchParams.get('q') ?? '') });
    }
    if (req.method === 'GET' && url.pathname === '/api/figure-text') {
      return send(res, 200, JSON.parse(readFileSync(FIGURE_TEXT, 'utf8')));
    }
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        return send(res, 415, { error: 'JSON only.' });
      }
      const body = await readBody(req);
      if (url.pathname === '/api/apply') {
        return send(res, 200, { ok: true, ...applyCard(String(body.id), String(body.text ?? '')) });
      }
      if (url.pathname === '/api/remove') {
        return send(res, 200, { ok: true, ...applyCard(String(body.id), '') });
      }
      if (url.pathname === '/api/keep') {
        const card = CARDS.find((c) => c.id === body.id);
        if (!card) throw new Refusal('No such card.');
        const { text } = load();
        if (countOf(text, card.current) !== card.expect) {
          throw new Refusal('Refused: the current text is not in the file as expected.');
        }
        const state = readState();
        if (!state.kept.includes(card.id)) state.kept.push(card.id);
        writeState(state);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/edit-paragraph') {
        return send(res, 200, {
          ok: true,
          ...editParagraph(String(body.original ?? ''), String(body.text ?? '')),
        });
      }
      if (url.pathname === '/api/figure-text') {
        const quip = String(body.godotQuip ?? '').replace(/[\r\n]+/g, ' ').trim();
        const data = JSON.parse(readFileSync(FIGURE_TEXT, 'utf8'));
        data.grid = { ...(data.grid ?? {}), godotQuip: quip };
        const tmp = `${FIGURE_TEXT}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
        renameSync(tmp, FIGURE_TEXT);
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/rebuild') {
        return send(res, 200, await rebuild());
      }
    }
    send(res, 404, { error: 'Not found.' });
  } catch (e) {
    if (e instanceof Refusal) return send(res, 409, { error: e.message });
    console.error(e);
    send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`devlog editor: http://${HOST}:${PORT}`);
  console.log(`editing:       ${MD}`);
});
