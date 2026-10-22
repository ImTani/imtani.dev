/**
 * Articles: finding them, and reading one folder into a checked object.
 *
 * The format is specified in articles/README.md; this file is that
 * specification's enforcement. Everything an article says about itself is in
 * its front matter, and everything is checked here — an unknown key, a date
 * that is not a date, a media path that does not exist — so that the renderer
 * in build.ts can trust what it is handed and the block editor can rely on the
 * same rules by importing the same functions.
 *
 * Pure apart from reading files; nothing here writes.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, posix } from 'node:path';

import {
  ARTICLE_FILE,
  DRAFTS_DIR,
  MEDIA_DIR,
  PUBLISHED_DIR,
  SITE_ORIGIN,
  URL_PREFIX,
} from './config.ts';
import { type FmData, type FmMap, type FmValue, isList, isMap, parse } from './frontmatter.ts';

export interface Link {
  readonly label: string;
  readonly url: string;
}

export interface Award {
  readonly text: string;
  readonly event?: string;
  readonly url?: string;
}

export interface About {
  readonly type: string;
  readonly name: string;
  readonly url?: string;
}

/** A `createBannerScreen` option value, as banner.js takes it. */
export type BannerValue = number | string | null;

export interface Banner {
  /** Media paths, relative to the article folder. */
  readonly art: string;
  readonly plateLight: string;
  readonly plateDark: string;
  /** Only the options the article sets; banner.js's DEFAULTS fill the rest. */
  readonly settings: Readonly<Record<string, BannerValue>>;
}

export interface ArticleMeta {
  readonly title: string;
  readonly deck?: string;
  readonly author: string;
  readonly handle?: string;
  /** The term on the masthead's record row, and the skip link's noun. */
  readonly kind: string;
  /** ISO days. `start === end` for a single date. */
  readonly date: { readonly start: string; readonly end: string };
  readonly published: string;
  readonly updated: string;
  readonly description: string;
  readonly image?: string;
  readonly keywords: readonly string[];
  readonly about?: About;
  readonly award?: Award;
  readonly elsewhere: readonly Link[];
  readonly colophon: readonly Link[];
  readonly canonical?: string;
  readonly toc: boolean;
  readonly draft: boolean;
  readonly banner?: Banner;
}

export type Source = 'published' | 'drafts';

export interface Article {
  readonly slug: string;
  /** Absolute path of the article folder. */
  readonly dir: string;
  readonly source: Source;
  readonly meta: ArticleMeta;
  /** The Markdown after the front matter block. */
  readonly body: string;
}

export class ArticleError extends Error {
  override name = 'ArticleError';
}

/** A folder name that can be a URL: lower-case letters, digits and single hyphens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Every key the front matter may carry. Anything else is a typo, and fails. */
export const KEYS = new Set([
  'title', 'deck', 'author', 'handle', 'kind', 'date', 'published', 'updated',
  'description', 'image', 'keywords', 'about', 'award', 'elsewhere', 'colophon',
  'canonical', 'toc', 'draft', 'banner',
]);

/**
 * The banner options an article may set: `createBannerScreen`'s own, by its
 * own names, minus the ones that are wiring rather than settings — `host`,
 * `art`, `pivot`, `progress`, `tokens` and `motion` are decided by the page.
 * See the OPTIONS block at the top of banner.js for what each one does.
 */
const BANNER_NUMBERS = new Set([
  'grain', 'levels', 'ramp', 'rampWidth', 'cell', 'anchorX', 'focus', 'direction',
  'feather', 'follow', 'wiggle', 'wiggleSign',
]);
const BANNER_NULLABLE = new Set(['travel', 'fps']);
const BANNER_FILES = new Set(['art', 'plateLight', 'plateDark']);

// ---------------------------------------------------------------- helpers ---

function fail(where: string, message: string): never {
  throw new ArticleError(`${where}: ${message}`);
}

function scalar(where: string, key: string, value: FmValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(where, `"${key}" has to be a single value, not a list or a block`);
  return value === '' ? undefined : value;
}

function required(where: string, key: string, value: FmValue | undefined): string {
  return scalar(where, key, value) ?? fail(where, `"${key}" is required`);
}

function bool(where: string, key: string, value: FmValue | undefined, fallback: boolean): boolean {
  const v = scalar(where, key, value);
  if (v === undefined) return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fail(where, `"${key}" is true or false, not "${v}"`);
}

function map(where: string, key: string, value: FmValue | undefined, allowed: readonly string[]): FmMap | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isMap(value)) fail(where, `"${key}" is a block of "  name: value" lines`);
  for (const sub of Object.keys(value)) {
    if (!allowed.includes(sub)) fail(where, `"${key}" has no "${sub}" (it takes ${allowed.join(', ')})`);
  }
  return value;
}

function list(where: string, key: string, value: FmValue | undefined): readonly string[] {
  if (value === undefined || value === '') return [];
  if (!isList(value)) fail(where, `"${key}" is a list of "  - item" lines`);
  return value;
}

/** An ISO day, checked to be a real one: 2024-02-30 is refused. */
export function isoDay(where: string, key: string, text: string): string {
  const m = ISO_DAY.exec(text.trim());
  const day = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !day || day.toISOString().slice(0, 10) !== text.trim()) {
    fail(where, `"${key}" has to be a date written YYYY-MM-DD, not "${text}"`);
  }
  return text.trim();
}

function url(where: string, key: string, text: string, allowPath: boolean): string {
  if (/^https?:\/\/\S+$/.test(text) || (allowPath && /^\/\S*$/.test(text))) return text;
  return fail(where, `"${key}" has to be an absolute http(s) URL${allowPath ? ' or a site path' : ''}, not "${text}"`);
}

/** `label | url`, split on the LAST ` | ` so a label may contain one. */
export function parseLink(where: string, key: string, item: string): Link {
  const at = item.lastIndexOf(' | ');
  if (at <= 0) fail(where, `each "${key}" item is "label | url", not "${item}"`);
  return { label: item.slice(0, at).trim(), url: url(where, key, item.slice(at + 3).trim(), true) };
}

/**
 * A media reference — `media/<file>`, relative to the article folder. Flat: no
 * subfolders, no `..`, and the file has to exist.
 */
export function mediaRef(article: { readonly dir: string; readonly slug: string }, ref: string, where = article.slug): string {
  const norm = posix.normalize(ref);
  const file = norm.startsWith(`${MEDIA_DIR}/`) ? norm.slice(MEDIA_DIR.length + 1) : '';
  if (!file || file.includes('/') || norm !== ref) {
    fail(where, `"${ref}" is not a media path; local files are written ${MEDIA_DIR}/<file>`);
  }
  if (!existsSync(join(article.dir, MEDIA_DIR, file))) {
    fail(where, `"${ref}" does not exist in ${join(article.dir, MEDIA_DIR)}`);
  }
  return file;
}

/** Where a media file is served: `media/x.webp` -> `/writing/<slug>/x.webp`. */
export function mediaUrl(slug: string, file: string): string {
  return `${URL_PREFIX}/${slug}/${file}`;
}

export function pageUrl(slug: string): string {
  return `${SITE_ORIGIN}${URL_PREFIX}/${slug}`;
}

function bannerValue(where: string, key: string, raw: string): BannerValue {
  if (key === 'rampSpace') {
    if (raw !== 'band' && raw !== 'art') fail(where, `banner.rampSpace is band or art, not "${raw}"`);
    return raw;
  }
  if (key === 'artScale' && raw === 'cover') return raw;
  if (BANNER_NULLABLE.has(key) && raw === 'null') return null;
  const n = Number(raw);
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(raw) || !Number.isFinite(n)) {
    fail(where, `banner.${key} has to be a number${BANNER_NULLABLE.has(key) ? ' or null' : ''}, not "${raw}"`);
  }
  return n;
}

/** Every key a `banner:` block may hold: the three files, then the options. */
export const BANNER_KEYS: readonly string[] = [...BANNER_FILES, ...BANNER_NUMBERS, ...BANNER_NULLABLE, 'rampSpace', 'artScale'];

function readBanner(where: string, dir: string, slug: string, value: FmValue | undefined): Banner | undefined {
  const keys = BANNER_KEYS;
  const m = map(where, 'banner', value, keys);
  if (!m) return undefined;
  const file = (k: string) => {
    const ref = m[k] || fail(where, `banner.${k} is required when there is a banner`);
    mediaRef({ dir, slug }, ref, where);
    return ref;
  };
  const settings: Record<string, BannerValue> = {};
  for (const [k, raw] of Object.entries(m)) {
    if (!BANNER_FILES.has(k)) settings[k] = bannerValue(where, k, raw);
  }
  return { art: file('art'), plateLight: file('plateLight'), plateDark: file('plateDark'), settings };
}

// --------------------------------------------------------------- the schema ---

export function readMeta(where: string, dir: string, slug: string, data: FmData): ArticleMeta {
  for (const key of Object.keys(data)) {
    if (!KEYS.has(key)) fail(where, `unknown front matter key "${key}" (see articles/README.md)`);
  }

  const rawDate = required(where, 'date', data['date']);
  const range = rawDate.split(/\s*\.\.\s*/);
  if (range.length > 2) fail(where, `"date" is one day or "start .. end", not "${rawDate}"`);
  const start = isoDay(where, 'date', range[0] as string);
  const end = range[1] === undefined ? start : isoDay(where, 'date', range[1]);
  if (end < start) fail(where, `"date" ends (${end}) before it starts (${start})`);

  const publishedRaw = scalar(where, 'published', data['published']);
  const published = publishedRaw ? isoDay(where, 'published', publishedRaw) : end;
  const updatedRaw = scalar(where, 'updated', data['updated']);
  const updated = updatedRaw ? isoDay(where, 'updated', updatedRaw) : published;
  if (updated < published) fail(where, `"updated" (${updated}) is before "published" (${published})`);

  const imageRaw = scalar(where, 'image', data['image']);
  if (imageRaw) mediaRef({ dir, slug }, imageRaw, where);

  const aboutMap = map(where, 'about', data['about'], ['type', 'name', 'url']);
  const about: About | undefined = aboutMap
    ? {
        type: aboutMap['type'] || fail(where, 'about.type is required'),
        name: aboutMap['name'] || fail(where, 'about.name is required'),
        ...(aboutMap['url'] ? { url: url(where, 'about.url', aboutMap['url'], false) } : {}),
      }
    : undefined;

  const awardMap = map(where, 'award', data['award'], ['text', 'event', 'url']);
  const award: Award | undefined = awardMap
    ? {
        text: awardMap['text'] || fail(where, 'award.text is required'),
        ...(awardMap['event'] ? { event: awardMap['event'] } : {}),
        ...(awardMap['url'] ? { url: url(where, 'award.url', awardMap['url'], true) } : {}),
      }
    : undefined;

  const canonical = scalar(where, 'canonical', data['canonical']);
  const deck = scalar(where, 'deck', data['deck']);
  const handle = scalar(where, 'handle', data['handle']);
  const banner = readBanner(where, dir, slug, data['banner']);

  return {
    title: required(where, 'title', data['title']),
    ...(deck ? { deck } : {}),
    author: required(where, 'author', data['author']),
    ...(handle ? { handle } : {}),
    kind: scalar(where, 'kind', data['kind']) ?? 'Article',
    date: { start, end },
    published,
    updated,
    description: required(where, 'description', data['description']),
    ...(imageRaw ? { image: imageRaw } : {}),
    keywords: list(where, 'keywords', data['keywords']),
    ...(about ? { about } : {}),
    ...(award ? { award } : {}),
    elsewhere: list(where, 'elsewhere', data['elsewhere']).map((item) => parseLink(where, 'elsewhere', item)),
    colophon: list(where, 'colophon', data['colophon']).map((item) => parseLink(where, 'colophon', item)),
    ...(canonical ? { canonical: url(where, 'canonical', canonical, false) } : {}),
    toc: bool(where, 'toc', data['toc'], true),
    draft: bool(where, 'draft', data['draft'], false),
    ...(banner ? { banner } : {}),
  };
}

/** Read and check one article folder. */
export function readArticle(dir: string, source: Source): Article {
  const slug = dir.split(/[\\/]/).filter(Boolean).pop() ?? '';
  const where = `${source === 'drafts' ? 'articles/drafts (private)' : 'articles'}/${slug}`;
  if (!SLUG.test(slug)) fail(where, 'the folder name is the URL slug: lower-case letters, digits and single hyphens');
  const file = join(dir, ARTICLE_FILE);
  if (!existsSync(file)) fail(where, `no ${ARTICLE_FILE}`);
  let fm;
  try {
    fm = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${where}/${ARTICLE_FILE}`, error instanceof Error ? error.message : String(error));
  }
  return { slug, dir, source, meta: readMeta(where, dir, slug, fm.data), body: fm.body };
}

function folders(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith('.') && statSync(join(root, name)).isDirectory())
    .sort()
    .map((name) => join(root, name));
}

export interface Discovery {
  readonly articles: readonly Article[];
  /** Things worth printing that are not failures. */
  readonly warnings: readonly string[];
}

/**
 * Every article to build. Published ones always; drafts only when asked and
 * only if the drafts folder exists. A published folder whose front matter says
 * `draft: true` is left out with a warning rather than failing the build: CI
 * also deploys the six-hourly rebake, and one unfinished article should not be
 * able to stop that. A slug in both places is an error — it would be two pages
 * at one URL.
 */
export function discover(options: { readonly drafts: boolean; readonly publishedDir?: string; readonly draftsDir?: string }): Discovery {
  const publishedDir = options.publishedDir ?? PUBLISHED_DIR;
  const draftsDir = options.draftsDir ?? DRAFTS_DIR;
  const warnings: string[] = [];
  const articles: Article[] = [];

  for (const dir of folders(publishedDir)) {
    // Drafts live in the PRIVATE repo's articles/drafts/. The same name inside
    // this public folder would be a slug — and a draft one `git add` from public.
    if (basename(dir) === 'drafts') {
      throw new ArticleError(`${dir} looks like a drafts folder inside the PUBLIC articles/; drafts belong in ${draftsDir}`);
    }
    if (!existsSync(join(dir, ARTICLE_FILE))) continue;
    const article = readArticle(dir, 'published');
    if (article.meta.draft) {
      warnings.push(`articles/${article.slug} says "draft: true", so it is not built. Publish it by removing that line.`);
      continue;
    }
    articles.push(article);
  }

  if (options.drafts) {
    for (const dir of folders(draftsDir)) {
      if (!existsSync(join(dir, ARTICLE_FILE))) continue;
      const article = readArticle(dir, 'drafts');
      if (articles.some((a) => a.slug === article.slug)) {
        throw new ArticleError(`"${article.slug}" is both published and a draft; one of the two folders has to go`);
      }
      articles.push(article);
    }
  }

  return { articles, warnings };
}

/** Published slugs only, for Vite's build inputs and the sitemap. */
export function publishedArticles(): readonly Article[] {
  return discover({ drafts: false }).articles;
}
