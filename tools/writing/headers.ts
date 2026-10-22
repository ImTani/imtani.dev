/**
 * `_headers`, generated from the published article list.
 *
 * Workers reads `dist/_headers` at the edge; it is never served. It used to be
 * a hand-kept file in public/ with one line for the devlog's media, which meant
 * every new article's media went out on the Workers default until somebody
 * remembered to add a line. Now the Vite plugin writes it at build time, one
 * block per published article, from the same list that decides what is built.
 *
 * One explicit path per article rather than a pattern like `/writing/:slug/*`:
 * an explicit prefix cannot also match the article page itself or anything
 * added under /writing/ later, so the immutable rule reaches exactly the
 * folders it is true of. Rules that are not about articles belong in
 * `SITE_RULES` below, so there is still one file and one place to look.
 */

import type { Article } from './articles.ts';
import { URL_PREFIX } from './config.ts';

/** Header rules that are not per-article. Empty today. */
const SITE_RULES: readonly string[] = [];

export function renderHeaders(articles: readonly Article[]): string {
  const slugs = articles.map((article) => article.slug).sort();
  return [
    '# Response headers for the static assets, read by Workers at the edge. It is',
    '# never served. Generated at build time by tools/writing/headers.ts from the',
    '# published article list; drafts never appear.',
    '#',
    "# Every article's media/ folder is copied to /writing/<slug>/ by the build and",
    '# served `immutable` for a year. Those files do not change between builds,',
    '# and on the Workers default of `max-age=0, must-revalidate` they would cost',
    '# every returning reader a conditional round trip per figure before the',
    '# article can finish drawing — forty, for the devlog.',
    '#',
    '# The price of `immutable` is that these names are not content-hashed, so a',
    '# file that IS re-encoded keeps its old bytes in caches for up to a year. That',
    '# makes it a rule rather than a caveat: changing one of these files means',
    '# giving it a new name — and changing the reference in the article — which',
    '# changes its URL. See articles/README.md.',
    ...SITE_RULES,
    ...slugs.flatMap((slug) => [`${URL_PREFIX}/${slug}/*`, '  Cache-Control: public, max-age=31536000, immutable']),
    '',
  ].join('\n');
}
