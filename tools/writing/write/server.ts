/**
 * The block editor for the articles on imtani.dev. Local only.
 *
 *     npm run write            ->  http://127.0.0.1:4300
 *
 * Opens every article — published (site/articles/) and drafts (the private
 * repo's articles/drafts/) — as its front matter in a form and its body as
 * blocks, each drawn by the build's own renderer with the page's own
 * stylesheet, so what is on screen is what ships. Saving writes article.md and
 * nothing else; see document.ts for why an untouched block is byte-identical
 * after a save, and service.ts for the backups, the checks and publishing.
 *
 * Bound to 127.0.0.1, and every request must carry this server's own Host (a
 * guard against DNS rebinding) and, if it has one, its own Origin (against a
 * page elsewhere posting to it). A write takes JSON or raw bytes only, which a
 * plain cross-site form cannot send.
 *
 * Environment, for testing against copies:
 *   WRITING_DRAFTS_DIR      the drafts root (config.ts; the build reads it too)
 *   WRITING_PUBLISHED_DIR   the published root — read by this editor only, never
 *                           by the build, so a stray value cannot change a deploy
 *   WRITE_PORT              default 4300
 *   WRITE_NO_REVEAL=1       make "Reveal in Explorer" a no-op (for tests)
 */

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BANNER_KEYS, KEYS, type Source } from '../articles.ts';
import { drawnFigures, pageStyles, renderArticle } from '../build.ts';
import { DRAFTS_DIR, MEDIA_DIR, PUBLISHED_DIR, SITE_OWNER, URL_PREFIX } from '../config.ts';
import { serialize } from '../frontmatter.ts';
import { type DocumentState, loadText, originalBlocks } from './document.ts';
import {
  Refusal,
  type Roots,
  addMedia,
  articleDir,
  articleFromText,
  composeFor,
  createDraft,
  listLibrary,
  mediaFiles,
  pageView,
  publish,
  publishPlan,
  readRaw,
  reblock,
  renderBlock,
  renderRun,
  save,
  validate,
} from './service.ts';

const here = dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1';
const PORT = Number(process.env['WRITE_PORT'] ?? 4300);
const ROOTS: Roots = {
  published: resolve(process.env['WRITING_PUBLISHED_DIR'] ?? PUBLISHED_DIR),
  drafts: DRAFTS_DIR,
};

const STATIC: Readonly<Record<string, readonly [string, string]>> = {
  '/': ['editor.html', 'text/html'],
  '/editor.js': ['editor.js', 'text/javascript'],
  '/editor.css': ['editor.css', 'text/css'],
};

const TYPES: Readonly<Record<string, string>> = {
  webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm',
};

/**
 * Which folder `/writing/<slug>/…` means. A slug is normally in one place
 * only; when it is open in the editor or previewed, that copy wins.
 */
const lastOpened = new Map<string, string>();
/** The preview pages, by slug, rendered from the editor's unsaved state. */
const previews = new Map<string, string>();

function folderFor(slug: string): string | null {
  const opened = lastOpened.get(slug);
  if (opened && existsSync(opened)) return opened;
  for (const root of [ROOTS.published, ROOTS.drafts]) {
    const dir = join(root, slug);
    if (existsSync(dir)) return dir;
  }
  return null;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ------------------------------------------------------------------- api ---

function stateOf(body: Record<string, unknown>): DocumentState {
  const state = body['state'] as DocumentState | undefined;
  if (!state || typeof state.baseHash !== 'string' || !Array.isArray(state.blocks) || !state.fm) {
    throw new Refusal('the request is missing the document');
  }
  return state;
}

function target(body: Record<string, unknown>): { source: Source; slug: string; dir: string } {
  const dir = articleDir(ROOTS, body['source'], body['slug']);
  return { source: body['source'] as Source, slug: body['slug'] as string, dir };
}

function openArticle(source: unknown, slug: unknown) {
  const dir = articleDir(ROOTS, source, slug);
  const s = source as Source;
  const name = slug as string;
  lastOpened.set(name, dir);
  const raw = readRaw(dir);
  const file = loadText(raw);
  const views = renderRun({ slug: name, dir }, file.split.blocks);
  const placed = originalBlocks(file);
  const fmCanonical = file.fm ? serialize({ data: file.fm.data, comments: file.fm.comments, body: '' }) === file.fmRaw : false;
  return {
    source: s,
    slug: name,
    dir,
    hash: file.hash,
    eol: file.eol === '\r\n' ? 'CRLF' : file.eol === '\n' ? 'LF' : 'mixed',
    bom: file.bom,
    fm: file.fm ? { data: file.fm.data, comments: file.fm.comments } : null,
    fmError: file.fmError ?? null,
    fmRaw: file.fmRaw,
    fmCanonical,
    blocks: views.map((view, i) => ({ ...view, orig: placed[i]?.orig })),
    media: mediaFiles(dir),
    ...pageView(s, name, dir, raw),
    validation: validate(ROOTS, s, name, dir, raw),
  };
}

function previewPage(source: Source, slug: string, dir: string, text: string): string {
  try {
    return renderArticle(articleFromText(source, slug, dir, text)).html;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const v = validate(ROOTS, source, slug, dir, text);
    const items = [...v.errors, ...v.warnings]
      .map((p) => `<li>${escapeHtml(`${p.block !== undefined ? `block ${p.block + 1}: ` : ''}${p.message}`)}</li>`)
      .join('');
    return (
      `<!doctype html><meta charset="utf-8"><title>Preview: ${escapeHtml(slug)}</title>` +
      `<body style="font:16px/1.6 Georgia,serif;background:#efe7d8;color:#3a332a;max-width:46rem;margin:3rem auto;padding:0 1rem">` +
      `<h1>The page cannot be built yet</h1><p>${escapeHtml(message)}</p><ul>${items}</ul></body>`
    );
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function reveal(dir: string): void {
  if (process.env['WRITE_NO_REVEAL'] === '1') return;
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

async function api(path: string, body: Record<string, unknown>, query: URLSearchParams, raw: Buffer | null): Promise<unknown> {
  switch (path) {
    case '/api/library':
      return {
        roots: ROOTS,
        articles: listLibrary(ROOTS),
        today: today(),
        css: pageStyles(),
      };
    case '/api/article':
      return {
        ...openArticle(query.get('source'), query.get('slug')),
        figures: drawnFigures(),
        keys: { known: [...KEYS], banner: BANNER_KEYS },
        today: today(),
      };
    case '/api/drafts': {
      const made = createDraft(ROOTS, body['slug'], body['title'], SITE_OWNER, today());
      return { source: 'drafts', slug: body['slug'], dir: made.dir };
    }
    case '/api/blocks': {
      const { slug, dir } = target(body);
      const items = Array.isArray(body['items']) ? (body['items'] as Array<{ src?: unknown; lede?: unknown }>) : [];
      return {
        items: items.map((item) => ({ parts: reblock({ slug, dir }, String(item.src ?? ''), item.lede === true) })),
      };
    }
    case '/api/render': {
      // Re-render blocks as they are, with the standfirst where the editor says.
      const { slug, dir } = target(body);
      const items = Array.isArray(body['items']) ? (body['items'] as Array<{ src?: unknown; lede?: unknown }>) : [];
      return { items: items.map((item) => renderBlock({ slug, dir }, String(item.src ?? ''), item.lede === true)) };
    }
    case '/api/compose': {
      // The page view for an unsaved state: masthead, stylesheet and checks.
      const { source, slug, dir } = target(body);
      const { text } = composeFor(dir, stateOf(body));
      return { ...pageView(source, slug, dir, text), validation: validate(ROOTS, source, slug, dir, text) };
    }
    case '/api/save': {
      const { source, slug, dir } = target(body);
      const state = stateOf(body);
      const { text } = composeFor(dir, state);
      const validation = validate(ROOTS, source, slug, dir, text);
      return { ...save(dir, state), validation };
    }
    case '/api/preview': {
      const { source, slug, dir } = target(body);
      const { text } = composeFor(dir, stateOf(body));
      lastOpened.set(slug, dir);
      previews.set(slug, previewPage(source, slug, dir, text));
      return { url: `${URL_PREFIX}/${slug}` };
    }
    case '/api/media': {
      const dir = articleDir(ROOTS, query.get('source'), query.get('slug'));
      if (!raw) throw new Refusal('no file was sent');
      return { ...addMedia(dir, query.get('name'), raw), media: mediaFiles(dir) };
    }
    case '/api/publish-plan':
      return publishPlan(ROOTS, body['slug']);
    case '/api/publish': {
      if (body['confirm'] !== true) throw new Refusal('publishing needs confirming');
      const plan = publish(ROOTS, body['slug']);
      lastOpened.delete(plan.slug);
      return { source: 'published', slug: plan.slug, to: plan.to, files: plan.files };
    }
    case '/api/reveal': {
      const { dir } = target(body);
      reveal(dir);
      return { dir };
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ http ---

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const JSON_LIMIT = 8_000_000;
const MEDIA_LIMIT = 40_000_000;

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        fail(new Refusal('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => ok(Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

function serveFile(res: ServerResponse, path: string): void {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'content-length': String(statSync(path).size),
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(res, 403, { error: 'Bad host.' });
    const origin = req.headers.origin;
    if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'Bad origin.' });
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    if (req.method === 'GET') {
      const asset = STATIC[path];
      if (asset) return send(res, 200, readFileSync(join(here, asset[0]), 'utf8'), asset[1]);

      // The preview page, and every article's media where the page asks for it.
      const page = new RegExp(`^${URL_PREFIX}/([a-z0-9-]+)/?$`).exec(path);
      if (page) {
        const slug = page[1] as string;
        // `?disk=<source>` is the library's preview: the file as saved. Without
        // it, the editor's last Preview — its unsaved state — if there is one.
        const disk = url.searchParams.get('disk');
        if (disk === 'published' || disk === 'drafts') {
          const dir = articleDir(ROOTS, disk, slug);
          lastOpened.set(slug, dir);
          previews.delete(slug);
          return send(res, 200, previewPage(disk, slug, dir, readRaw(dir)), 'text/html');
        }
        const html = previews.get(slug);
        if (html) return send(res, 200, html, 'text/html');
        const dir = folderFor(slug);
        if (!dir) return send(res, 404, 'No such article.', 'text/plain');
        const source: Source = dir.startsWith(ROOTS.drafts) ? 'drafts' : 'published';
        return send(res, 200, previewPage(source, slug, dir, readRaw(dir)), 'text/html');
      }
      const media = new RegExp(`^${URL_PREFIX}/([a-z0-9-]+)/([^/]+)$`).exec(path);
      if (media) {
        const dir = folderFor(media[1] as string);
        const name = decodeURIComponent(media[2] as string);
        if (!dir || name.startsWith('.') || /[\\/]/.test(name)) return send(res, 404, 'Not found.', 'text/plain');
        const file = join(dir, MEDIA_DIR, name);
        if (!existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'Not found.', 'text/plain');
        return serveFile(res, file);
      }
      if (path === '/api/library' || path === '/api/article') {
        return send(res, 200, await api(path, {}, url.searchParams, null));
      }
      return send(res, 404, { error: 'Not found.' });
    }

    if (req.method === 'POST' && path.startsWith('/api/')) {
      const type = String(req.headers['content-type'] ?? '');
      if (path === '/api/media') {
        if (!type.startsWith('application/octet-stream')) return send(res, 415, { error: 'Raw bytes only.' });
        const raw = await readBody(req, MEDIA_LIMIT);
        return send(res, 200, await api(path, {}, url.searchParams, raw));
      }
      if (!type.startsWith('application/json')) return send(res, 415, { error: 'JSON only.' });
      const text = (await readBody(req, JSON_LIMIT)).toString('utf8');
      let body: Record<string, unknown>;
      try {
        body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        throw new Refusal('bad JSON');
      }
      const out = await api(path, body, url.searchParams, null);
      if (out === undefined) return send(res, 404, { error: 'Not found.' });
      return send(res, 200, out);
    }
    send(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (error instanceof Refusal) return send(res, 409, { error: error.message });
    console.error(error);
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`writing editor: http://${HOST}:${PORT}`);
  console.log(`  published:   ${ROOTS.published}`);
  console.log(`  drafts:      ${ROOTS.drafts}`);
});

