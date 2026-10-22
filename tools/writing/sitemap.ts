/**
 * sitemap.xml, generated from the published article list.
 *
 * It used to be a hand-kept file in public/ with "add a line when a page
 * ships" at the top, which is a step to forget. Now the Vite plugin writes it
 * into dist/ at build time (and serves it in dev) from the same discovery that
 * decides what gets built, so an article is in the sitemap exactly when it is
 * deployed — and a draft never is, because drafts are not in that list.
 *
 * An article whose `canonical` points somewhere else — republished from Medium,
 * say — is left out: a sitemap lists the URLs this site says are the real ones,
 * and that page says the real one is elsewhere.
 */

import { type Article, pageUrl } from './articles.ts';
import { SITE_ORIGIN } from './config.ts';

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderSitemap(articles: readonly Article[]): string {
  const own = articles
    .filter((article) => !article.meta.canonical || article.meta.canonical === pageUrl(article.slug))
    .map((article) => article.slug)
    .sort();

  const url = (loc: string, priority: string) =>
    `  <url>\n    <loc>${xml(loc)}</loc>\n    <priority>${priority}</priority>\n  </url>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    '  Every indexable page on imtani.dev. /harness is deliberately absent: it is',
    "  the engine's test rig and carries a noindex.",
    '',
    '  No <lastmod>. A date that is not maintained is worse than none — a crawler',
    '  that is told a page changed and finds it identical learns to distrust the',
    '  file. Add dates here only if something starts writing them honestly.',
    '',
    '  Generated at build time by tools/writing/sitemap.ts: the home page, then',
    '  every published article. Drafts never appear; they are not in the list',
    '  this is made from.',
    '-->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url(`${SITE_ORIGIN}/`, '1.0'),
    ...own.map((slug) => url(pageUrl(slug), '0.8')),
    '</urlset>',
    '',
  ].join('\n');
}
