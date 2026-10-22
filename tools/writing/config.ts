/**
 * Where the writing lives, in one place.
 *
 * Every root the pipeline reads or writes is decided here and nowhere else:
 * the build, the Vite plugin, the media and banner tools and the editor all
 * import these. The format they read is documented in articles/README.md.
 *
 *   PUBLISHED_DIR  articles/<slug>/ in this (public) repository. Every
 *                  folder here with an article.md is built by CI and deployed.
 *                  Sources only: the generated pages are in writing/, and the
 *                  two are kept apart on purpose.
 *   DRAFTS_DIR     articles/drafts/<slug>/ in the PRIVATE repository this one
 *                  sits inside (potpolio/articles/drafts/), same layout. Read only when drafts are asked for —
 *                  `npm run dev` and `npm run writing:drafts` — and only if the
 *                  folder exists, which it never does in CI or a clean clone.
 *                  Publishing is moving the folder from there to PUBLISHED_DIR.
 *                  `WRITING_DRAFTS_DIR` overrides it, for testing.
 *   OUT_DIR        writing/<slug>.html, generated, ignored by git. Vite takes
 *                  each page as a build input from here (see vite.config.ts),
 *                  so it emits to dist/writing/<slug>.html, which the assets
 *                  runtime serves at /writing/<slug> without the extension.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const SITE_ROOT = resolve(here, '../..');

export const PUBLISHED_DIR = resolve(SITE_ROOT, 'articles');

export const DRAFTS_DIR = resolve(
  process.env['WRITING_DRAFTS_DIR'] ?? resolve(SITE_ROOT, '../articles/drafts'),
);

export const OUT_DIR = resolve(SITE_ROOT, 'writing');

/** The site's own origin, for canonical URLs, og:image and the sitemap. */
export const SITE_ORIGIN = 'https://imtani.dev';

/** Whose site it is: the publisher of every article, and the Person at `${SITE_ORIGIN}/#person`. */
export const SITE_OWNER = 'Tanishk Narula';

/**
 * Articles are served at `${URL_PREFIX}/<slug>`, and an article's `media/`
 * folder at `${URL_PREFIX}/<slug>/<file>` — flattened, so `media/x.webp` in the
 * source is `/writing/<slug>/x.webp` on the site. That flattening is what kept
 * every media URL the devlog had when its files moved out of `public/`.
 */
export const URL_PREFIX = '/writing';

/** The file inside each article folder, and the folder its media sits in. */
export const ARTICLE_FILE = 'article.md';
export const MEDIA_DIR = 'media';
