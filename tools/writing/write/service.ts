/**
 * What the block editor can do to the articles on disk, with the roots passed
 * in so the tests can point every operation at a temporary copy.
 *
 * Every write here is a temp file and a rename, after a timestamped backup of
 * what it replaces into `.edit-backups/` beside article.md (ignored by git in
 * both repositories). Nothing here runs git. The HTTP wiring is server.ts.
 */

import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import {
  type Article,
  ArticleError,
  KEYS,
  type Source,
  SLUG,
  mediaUrl,
  readMeta,
} from '../articles.ts';
import { renderArticle, renderFragment, pageStyles } from '../build.ts';
import { ARTICLE_FILE, MEDIA_DIR } from '../config.ts';
import { type FmData, type FmValue, isMap } from '../frontmatter.ts';
import { imageSize } from '../image-size.ts';
import {
  type BlockType,
  type DocumentState,
  type LoadedFile,
  blockType,
  cleanBlockSource,
  composeText,
  draftTemplate,
  encodeLike,
  hashOf,
  loadText,
  splitBody,
} from './document.ts';

export interface Roots {
  readonly published: string;
  readonly drafts: string;
}

/** A refusal the editor shows as it is: nothing was written. */
export class Refusal extends Error {
  override name = 'Refusal';
}

export const SOURCES: readonly Source[] = ['published', 'drafts'];

const BACKUPS = '.edit-backups';
const STILLS = ['webp', 'png', 'jpg', 'jpeg'];
const CLIP_SOURCES = ['gif', 'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv'];
const REQUIRED = ['title', 'author', 'date', 'description'];

export function isSource(value: unknown): value is Source {
  return value === 'published' || value === 'drafts';
}

export function rootOf(roots: Roots, source: Source): string {
  return source === 'published' ? roots.published : roots.drafts;
}

/** The folder of an existing article, after checking both halves of its name. */
export function articleDir(roots: Roots, source: unknown, slug: unknown): string {
  if (!isSource(source)) throw new Refusal(`no such place for articles: "${String(source)}"`);
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw new Refusal(`not an article slug: "${String(slug)}"`);
  const dir = join(rootOf(roots, source), slug);
  if (!existsSync(join(dir, ARTICLE_FILE))) throw new Refusal(`there is no ${source === 'drafts' ? 'draft' : 'article'} "${slug}"`);
  return dir;
}

export function readRaw(dir: string): string {
  return readFileSync(join(dir, ARTICLE_FILE), 'utf8');
}

function whereOf(source: Source, slug: string): string {
  return `${source === 'drafts' ? 'articles/drafts (private)' : 'articles'}/${slug}`;
}

/** An Article from text that may not be on disk yet. Throws ArticleError. */
export function articleFromText(source: Source, slug: string, dir: string, text: string): Article {
  const file = loadText(text);
  if (!file.fm) throw new ArticleError(`${whereOf(source, slug)}/${ARTICLE_FILE}: ${file.fmError ?? 'no front matter'}`);
  return { slug, dir, source, meta: readMeta(whereOf(source, slug), dir, slug, file.fm.data), body: file.fm.body };
}

export function mediaFiles(dir: string): string[] {
  const media = join(dir, MEDIA_DIR);
  if (!existsSync(media)) return [];
  return readdirSync(media)
    .filter((name) => !name.startsWith('.') && statSync(join(media, name)).isFile())
    .sort();
}

// ---------------------------------------------------------------- library ---

export interface LibraryEntry {
  readonly source: Source;
  readonly slug: string;
  readonly dir: string;
  readonly title: string;
  readonly kind: string;
  readonly date: string;
  /** `published`, `draft` (in the drafts folder), or `hidden` (published, but `draft: true`). */
  readonly status: 'published' | 'draft' | 'hidden';
  /** The first thing wrong with it, as the build would say it. */
  readonly problem: string | null;
  readonly modified: string;
}

export function listLibrary(roots: Roots): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const source of SOURCES) {
    const root = rootOf(roots, source);
    if (!existsSync(root)) continue;
    for (const slug of readdirSync(root).sort()) {
      const dir = join(root, slug);
      if (slug.startsWith('.') || !statSync(dir).isDirectory() || !existsSync(join(dir, ARTICLE_FILE))) continue;
      const text = readRaw(dir);
      const file = loadText(text);
      const data = file.fm?.data ?? {};
      const str = (v: FmValue | undefined) => (typeof v === 'string' ? v : '');
      let problem: string | null = null;
      let draftFlag = str(data['draft']) === 'true';
      try {
        if (!SLUG.test(slug)) throw new ArticleError('the folder name is not a slug');
        const article = articleFromText(source, slug, dir, text);
        draftFlag = article.meta.draft;
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      out.push({
        source,
        slug,
        dir,
        title: str(data['title']) || slug,
        kind: str(data['kind']) || 'Article',
        date: str(data['date']),
        status: source === 'drafts' ? 'draft' : draftFlag ? 'hidden' : 'published',
        problem,
        modified: statSync(join(dir, ARTICLE_FILE)).mtime.toISOString(),
      });
    }
  }
  return out;
}

/** A new draft folder: article.md from the template, and an empty media/. */
export function createDraft(roots: Roots, slug: unknown, title: unknown, author: string, today: string): { dir: string } {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new Refusal('a slug is lower-case letters, digits and single hyphens — it becomes the URL');
  }
  if (slug === 'drafts') throw new Refusal('"drafts" cannot be a slug: the build reads that name as a misplaced drafts folder');
  const name = typeof title === 'string' ? title.trim() : '';
  if (!name) throw new Refusal('a draft needs a title');
  if (/[\r\n]/.test(name)) throw new Refusal('a title is one line');
  if (existsSync(join(roots.drafts, slug))) throw new Refusal(`there is already a draft called "${slug}"`);
  if (existsSync(join(roots.published, slug))) throw new Refusal(`"${slug}" is already published; two folders cannot share a URL`);
  const dir = join(roots.drafts, slug);
  mkdirSync(join(dir, MEDIA_DIR), { recursive: true });
  writeFileSync(join(dir, ARTICLE_FILE), draftTemplate(name, author, today), 'utf8');
  return { dir };
}

// ----------------------------------------------------------------- render ---

export interface BlockView {
  readonly src: string;
  readonly type: BlockType;
  readonly html: string;
  readonly error: string | null;
  /** Holds a paragraph that could be the standfirst. */
  readonly candidate: boolean;
  /** Was rendered as the standfirst. */
  readonly lede: boolean;
  readonly referenced: readonly string[];
}

export function renderBlock(ref: { slug: string; dir: string }, src: string, lede: boolean): BlockView {
  const type = blockType(src);
  try {
    const out = renderFragment(ref, src, { lede });
    return { src, type, html: out.html, error: null, candidate: out.ledeCandidate, lede: out.ledeUsed, referenced: out.referenced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { src, type, html: '', error: message, candidate: false, lede: false, referenced: [] };
  }
}

/** Render a run of blocks with the standfirst on the first that can take it. */
export function renderRun(ref: { slug: string; dir: string }, sources: readonly string[], lede = true): BlockView[] {
  const views = sources.map((src) => renderBlock(ref, src, false));
  if (lede) {
    const owner = views.findIndex((v) => v.candidate);
    if (owner !== -1) views[owner] = renderBlock(ref, sources[owner] as string, true);
  }
  return views;
}

/**
 * What an edited block has become: one block, several (a blank line typed into
 * a paragraph makes two), or none.
 */
export function reblock(ref: { slug: string; dir: string }, src: string, lede: boolean): BlockView[] {
  const clean = cleanBlockSource(src);
  if (!clean.trim()) return [];
  const parts = splitBody(clean).blocks;
  return renderRun(ref, parts.length ? parts : [clean], lede);
}

/**
 * The page's own stylesheet for this article, and its masthead as the page
 * would draw it, when the front matter is good enough to draw one.
 */
export function pageView(source: Source, slug: string, dir: string, text: string): { css: string; masthead: string | null; mastheadError: string | null } {
  const file = loadText(text);
  const banner = file.fm?.data['banner'];
  const plate = (key: string) => {
    const ref = isMap(banner) ? banner[key] : undefined;
    return ref?.startsWith(`${MEDIA_DIR}/`) ? mediaUrl(slug, ref.slice(MEDIA_DIR.length + 1)) : null;
  };
  const light = plate('plateLight');
  const dark = plate('plateDark');
  const css = pageStyles(light && dark ? { light, dark } : undefined);

  const extract = (html: string) => /<header class="masthead">[\s\S]*?<\/header>/.exec(html)?.[0] ?? null;
  try {
    const article = articleFromText(source, slug, dir, text);
    try {
      return { css, masthead: extract(renderArticle(article).html), mastheadError: null };
    } catch {
      // A block the build would refuse: draw the masthead from the blocks that
      // render, so the word count is as near as it can be.
      const good = splitBody(article.body).blocks.filter((src) => renderBlock({ slug, dir }, src, false).error === null);
      return { css, masthead: extract(renderArticle({ ...article, body: good.join('\n\n') }).html), mastheadError: null };
    }
  } catch (error) {
    return { css, masthead: null, mastheadError: error instanceof Error ? error.message : String(error) };
  }
}

// --------------------------------------------------------------- checking ---

export interface Problem {
  readonly level: 'error' | 'warning';
  readonly message: string;
  /** Index of the block it is about, when it is about one. */
  readonly block?: number;
  readonly area: 'front matter' | 'body' | 'media' | 'folder';
}

export interface Validation {
  readonly errors: readonly Problem[];
  readonly warnings: readonly Problem[];
}

const PLACEHOLDER: Readonly<Record<string, string>> = {
  title: 'x',
  author: 'x',
  date: '2000-01-01',
  description: 'x',
};

/**
 * Every front matter problem, not only the first. `readMeta` stops at the
 * first, which is right for a build and too little for a form, so this asks it
 * again with each key it complained about taken out (or, for a required key,
 * stood in for) until it has nothing more to say.
 */
function frontMatterProblems(source: Source, slug: string, dir: string, data: FmData): string[] {
  const out: string[] = [];
  const work: Record<string, FmValue> = { ...data };
  for (const key of Object.keys(data)) {
    if (!KEYS.has(key)) {
      out.push(`unknown front matter key "${key}" (see articles/README.md)`);
      delete work[key];
    }
  }
  for (const key of REQUIRED) {
    const value = work[key];
    if (value === undefined || value === '') {
      out.push(`"${key}" is required`);
      work[key] = PLACEHOLDER[key] as string;
    }
  }
  const where = whereOf(source, slug);
  const tried = new Set<string>();
  for (let round = 0; round < 24; round += 1) {
    try {
      readMeta(where, dir, slug, work);
      break;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).replace(`${where}: `, '');
      out.push(message);
      const quoted = [...message.matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);
      const dotted = [...message.matchAll(/\b([A-Za-z][\w-]*)\.[A-Za-z]/g)].map((m) => m[1] as string);
      const key =
        [...dotted, ...quoted].find((k) => k in work) ??
        Object.keys(work).find((k) => {
          const v = work[k];
          return quoted.some((q) => v === q || (isMap(v) && Object.values(v).includes(q)) || (Array.isArray(v) && v.includes(q)));
        });
      if (!key || tried.has(key)) break;
      tried.add(key);
      if (REQUIRED.includes(key)) work[key] = PLACEHOLDER[key] as string;
      else delete work[key];
    }
  }
  return out;
}

/**
 * Check an article as the build would: its front matter, every block, and its
 * media folder. `as` is the rules to apply — a draft's stray media is only a
 * warning, a published article's fails the deploy.
 */
export function validate(roots: Roots, source: Source, slug: string, dir: string, text: string, as: Source = source): Validation {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const file = loadText(text);

  if (!file.fm) {
    errors.push({ level: 'error', area: 'front matter', message: file.fmError ?? 'no front matter' });
  } else {
    for (const message of frontMatterProblems(source, slug, dir, file.fm.data)) {
      errors.push({ level: 'error', area: 'front matter', message });
    }
    if (as === 'published' && file.fm.data['draft'] === 'true') {
      warnings.push({
        level: 'warning',
        area: 'front matter',
        message: 'it says "draft: true", so the build leaves it out (with a warning) until that line goes',
      });
    }
  }

  const referenced = new Set<string>();
  const blocks = splitBody(file.fm ? file.fm.body : file.body).blocks;
  blocks.forEach((src, i) => {
    const view = renderBlock({ slug, dir }, src, false);
    if (view.error) errors.push({ level: 'error', area: 'body', block: i, message: view.error.replace(`${slug}: `, '') });
    for (const name of view.referenced) referenced.add(name);
  });

  const data = file.fm?.data ?? {};
  const refs: string[] = [];
  if (typeof data['image'] === 'string') refs.push(data['image']);
  const banner = data['banner'];
  if (isMap(banner)) for (const key of ['art', 'plateLight', 'plateDark']) if (banner[key]) refs.push(banner[key] as string);
  for (const ref of refs) if (ref.startsWith(`${MEDIA_DIR}/`)) referenced.add(ref.slice(MEDIA_DIR.length + 1));

  const stray = mediaFiles(dir).filter((name) => !referenced.has(name));
  if (stray.length) {
    const message = `media/ holds ${stray.length} file(s) the article does not use, and they would be deployed: ${stray.join(', ')}`;
    (as === 'published' ? errors : warnings).push({ level: as === 'published' ? 'error' : 'warning', area: 'media', message });
  }
  const media = join(dir, MEDIA_DIR);
  if (existsSync(media)) {
    const folders = readdirSync(media).filter((n) => !n.startsWith('.') && statSync(join(media, n)).isDirectory());
    if (folders.length) warnings.push({ level: 'warning', area: 'media', message: `media/ is flat; these folders in it are never served: ${folders.join(', ')}` });
  }

  const other = source === 'drafts' ? roots.published : roots.drafts;
  if (existsSync(join(other, slug, ARTICLE_FILE))) {
    errors.push({ level: 'error', area: 'folder', message: `"${slug}" is both published and a draft; one of the two folders has to go` });
  }
  return { errors, warnings };
}

// ------------------------------------------------------------------ saving ---

export interface Saved {
  readonly unchanged: boolean;
  readonly hash: string;
  readonly backup: string | null;
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** Temp file and rename, so a crash leaves the old file or the new, never half. */
function atomicWrite(path: string, data: string | Uint8Array): void {
  const tmp = join(dirname(path), `.${basename(path)}.tmp-${process.pid}`);
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw error;
  }
}

/** The text a state would save, without saving it. Throws Refusal if the file moved on. */
export function composeFor(dir: string, state: DocumentState): { raw: string; file: LoadedFile; text: string; bytes: string } {
  const raw = readRaw(dir);
  const file = loadText(raw);
  if (file.hash !== state.baseHash) {
    throw new Refusal('article.md has changed on disk since it was opened here. Reload it (your edits here would be lost) or save it elsewhere first.');
  }
  let text: string;
  try {
    text = composeText(file, state);
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error));
  }
  let bytes: string;
  try {
    bytes = encodeLike(file, text);
  } catch (error) {
    throw new Refusal(error instanceof Error ? error.message : String(error));
  }
  return { raw, file, text, bytes };
}

/**
 * Write the state to article.md. If the bytes would not change, nothing is
 * written and no backup is made.
 */
export function save(dir: string, state: DocumentState, now = new Date()): Saved {
  const { raw, bytes } = composeFor(dir, state);
  if (bytes === raw) return { unchanged: true, hash: hashOf(raw), backup: null };
  const path = join(dir, ARTICLE_FILE);
  mkdirSync(join(dir, BACKUPS), { recursive: true });
  const backup = join(dir, BACKUPS, `${ARTICLE_FILE}.${stamp(now)}.bak`);
  copyFileSync(path, backup);
  atomicWrite(path, bytes);
  return { unchanged: false, hash: hashOf(bytes), backup };
}

// ------------------------------------------------------------------- media ---

export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Copy a still into an article's media/ under a slugified name. A file with
 * that name and the same bytes is reused; different bytes get a new name,
 * because published media is cached `immutable` and a changed file has to.
 */
export function addMedia(dir: string, original: unknown, bytes: Uint8Array): { file: string; reused: boolean } {
  const name = typeof original === 'string' ? basename(original.replace(/\\/g, '/')) : '';
  const dot = name.lastIndexOf('.');
  const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
  if (CLIP_SOURCES.includes(ext)) {
    throw new Refusal(
      `a ${ext.toUpperCase()} becomes a clip (.mp4, .webm and a .webp poster), which needs transcoding: ` +
        'put the original with a media-map.json and run `npm run writing:media -- <originals-dir> <slug>`, then reference the .mp4',
    );
  }
  if (ext === 'svg') {
    throw new Refusal(
      'the page takes WebP, PNG and JPEG stills (articles/README.md), not SVG; export it as PNG or WebP, ' +
        'or make it a drawn figure in tools/writing/figures.ts',
    );
  }
  if (!STILLS.includes(ext)) throw new Refusal(`"${name}" is not a still the page takes: WebP, PNG or JPEG`);
  const buffer = Buffer.from(bytes);
  try {
    imageSize(buffer, name);
  } catch (error) {
    throw new Refusal(`"${name}" could not be read as a ${ext.toUpperCase()}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const stem = slugifyName(name.slice(0, dot)) || 'image';
  const folder = join(dir, MEDIA_DIR);
  mkdirSync(folder, { recursive: true });
  for (let n = 1; n < 1000; n += 1) {
    const file = `${stem}${n === 1 ? '' : `-${n}`}.${ext}`;
    const path = join(folder, file);
    if (!existsSync(path)) {
      atomicWrite(path, buffer);
      return { file, reused: false };
    }
    if (readFileSync(path).equals(buffer)) return { file, reused: true };
  }
  throw new Refusal('could not find a free name for that file');
}

// ---------------------------------------------------------------- publish ---

export interface PublishPlan {
  readonly slug: string;
  readonly from: string;
  readonly to: string;
  /** Every file that moves, relative to the article folder. */
  readonly files: readonly string[];
  /** Reasons it cannot happen. Empty means it can. */
  readonly blockers: readonly string[];
  readonly validation: Validation;
}

function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, base));
    else out.push(relative(base, path).replace(/\\/g, '/'));
  }
  return out;
}

export function publishPlan(roots: Roots, slug: unknown): PublishPlan {
  const from = articleDir(roots, 'drafts', slug);
  const name = slug as string;
  const to = join(roots.published, name);
  const blockers: string[] = [];
  if (existsSync(to)) blockers.push(`${to} already exists; publishing never replaces a folder`);
  if (name === 'drafts') blockers.push('"drafts" cannot be a published slug');
  const validation = validate(roots, 'drafts', name, from, readRaw(from), 'published');
  if (validation.errors.length) {
    blockers.push(`the deploy build would fail on ${validation.errors.length} problem(s); fix them first`);
  }
  return { slug: name, from, to, files: walk(from), blockers, validation };
}

/**
 * Move a draft's folder into the published articles. No git: committing it is
 * Tani's step.
 */
export function publish(roots: Roots, slug: unknown): PublishPlan {
  const plan = publishPlan(roots, slug);
  if (plan.blockers.length) throw new Refusal(`not published: ${plan.blockers.join('; ')}`);
  mkdirSync(roots.published, { recursive: true });
  try {
    renameSync(plan.from, plan.to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EXDEV' && code !== 'EPERM') throw error;
    // Another volume: copy, check every file arrived, then remove the draft.
    cpSync(plan.from, plan.to, { recursive: true, errorOnExist: true, force: false });
    const arrived = walk(plan.to);
    if (arrived.length !== plan.files.length) throw new Error(`copy to ${plan.to} is incomplete; the draft is left where it was`);
    rmSync(plan.from, { recursive: true });
  }
  return plan;
}
