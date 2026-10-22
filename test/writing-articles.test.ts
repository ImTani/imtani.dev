import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArticleError, discover, readArticle } from '../tools/writing/articles.ts';
import { formatDateRange, renderArticle } from '../tools/writing/build.ts';
import { renderHeaders } from '../tools/writing/headers.ts';
import { renderSitemap } from '../tools/writing/sitemap.ts';

/** A 1x1 PNG, enough for a header read. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6a50000000049454e44ae426082',
  'hex',
);

const MINIMAL = `title: A Test
author: Tanishk Narula
date: 2026-10-01
description: Something to read.`;

function workspace(): { root: string; published: string; drafts: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'writing-test-'));
  const published = join(root, 'content');
  const drafts = join(root, 'drafts');
  mkdirSync(published);
  return { root, published, drafts, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function article(dir: string, slug: string, front: string, body = '\nHello.\n', media: string[] = []): string {
  const at = join(dir, slug);
  mkdirSync(join(at, 'media'), { recursive: true });
  writeFileSync(join(at, 'article.md'), `---\n${front}\n---\n${body}`);
  for (const file of media) writeFileSync(join(at, 'media', file), PNG);
  return at;
}

test('published articles are found; drafts only when asked for', () => {
  const ws = workspace();
  try {
    article(ws.published, 'first', MINIMAL);
    article(ws.published, 'not-an-article-folder', MINIMAL);
    rmSync(join(ws.published, 'not-an-article-folder', 'article.md'));
    article(ws.drafts, 'second', MINIMAL);

    const prod = discover({ drafts: false, publishedDir: ws.published, draftsDir: ws.drafts });
    assert.deepEqual(prod.articles.map((a) => [a.slug, a.source]), [['first', 'published']]);

    const dev = discover({ drafts: true, publishedDir: ws.published, draftsDir: ws.drafts });
    assert.deepEqual(dev.articles.map((a) => [a.slug, a.source]), [['first', 'published'], ['second', 'drafts']]);
  } finally {
    ws.cleanup();
  }
});

test('a missing drafts folder is not an error', () => {
  const ws = workspace();
  try {
    article(ws.published, 'first', MINIMAL);
    const dev = discover({ drafts: true, publishedDir: ws.published, draftsDir: join(ws.root, 'nowhere') });
    assert.equal(dev.articles.length, 1);
  } finally {
    ws.cleanup();
  }
});

test('draft: true in the published folder is left out, with a warning', () => {
  const ws = workspace();
  try {
    article(ws.published, 'unready', `${MINIMAL}\ndraft: true`);
    const found = discover({ drafts: false, publishedDir: ws.published, draftsDir: ws.drafts });
    assert.equal(found.articles.length, 0);
    assert.match(found.warnings[0] ?? '', /unready says "draft: true"/);
  } finally {
    ws.cleanup();
  }
});

test('one slug both published and drafted is refused', () => {
  const ws = workspace();
  try {
    article(ws.published, 'twice', MINIMAL);
    article(ws.drafts, 'twice', MINIMAL);
    assert.throws(
      () => discover({ drafts: true, publishedDir: ws.published, draftsDir: ws.drafts }),
      /"twice" is both published and a draft/,
    );
  } finally {
    ws.cleanup();
  }
});

test('the schema fills defaults and reads every documented field', () => {
  const ws = workspace();
  try {
    const dir = article(
      ws.published,
      'full',
      `${MINIMAL.replace('date: 2026-10-01', 'date: 2024-06-19 .. 2024-06-28')}
deck: A deck
handle: infiniTani
kind: Devlog
updated: 2026-07-21
image: media/cover.png
keywords:
  - one
about:
  type: VideoGame
  name: Rise&Shine
award:
  text: A Prize
  event: A Jam
  url: https://example.com/jam
elsewhere:
  - a label | with a pipe | https://example.com/a
colophon:
  - example.com | https://example.com/
canonical: https://medium.com/@x/post
toc: false
banner:
  art: media/cover.png
  plateLight: media/cover.png
  plateDark: media/cover.png
  grain: 0.85
  travel: null
  rampSpace: art`,
      '\n',
      ['cover.png'],
    );
    const { meta } = readArticle(dir, 'published');
    assert.deepEqual(meta.date, { start: '2024-06-19', end: '2024-06-28' });
    assert.equal(meta.published, '2024-06-28', 'published defaults to the end of the date');
    assert.equal(meta.updated, '2026-07-21');
    assert.equal(meta.kind, 'Devlog');
    assert.deepEqual(meta.elsewhere, [{ label: 'a label | with a pipe', url: 'https://example.com/a' }]);
    assert.deepEqual(meta.award, { text: 'A Prize', event: 'A Jam', url: 'https://example.com/jam' });
    assert.equal(meta.toc, false);
    assert.deepEqual(meta.banner?.settings, { grain: 0.85, travel: null, rampSpace: 'art' });

    const bare = readArticle(article(ws.published, 'bare', MINIMAL), 'published').meta;
    assert.equal(bare.kind, 'Article');
    assert.equal(bare.toc, true);
    assert.equal(bare.draft, false);
    assert.equal(bare.published, '2026-10-01');
    assert.equal(bare.updated, '2026-10-01');
    assert.equal(bare.banner, undefined);
  } finally {
    ws.cleanup();
  }
});

test('the schema refuses what it does not understand', () => {
  const ws = workspace();
  try {
    const cases: Array<[string, string, RegExp]> = [
      ['typo', `${MINIMAL}\ntitel: x`, /unknown front matter key "titel"/],
      ['no-title', MINIMAL.replace('title: A Test\n', ''), /"title" is required/],
      ['bad-date', MINIMAL.replace('2026-10-01', '2026-02-30'), /"date" has to be a date written YYYY-MM-DD/],
      ['backwards', MINIMAL.replace('2026-10-01', '2026-10-02 .. 2026-10-01'), /ends .* before it starts/],
      ['no-image', `${MINIMAL}\nimage: media/missing.webp`, /does not exist/],
      ['escape', `${MINIMAL}\nimage: media/../article.md`, /is not a media path/],
      ['link', `${MINIMAL}\nelsewhere:\n  - just a label`, /"label \| url"/],
      ['toc', `${MINIMAL}\ntoc: yes`, /"toc" is true or false/],
      ['banner-key', `${MINIMAL}\nbanner:\n  colour: red`, /"banner" has no "colour"/],
      ['Bad_Slug', MINIMAL, /the folder name is the URL slug/],
    ];
    for (const [slug, front, message] of cases) {
      const dir = article(ws.published, slug, front);
      assert.throws(() => readArticle(dir, 'published'), (e: unknown) => e instanceof ArticleError && message.test(e.message), slug);
    }
  } finally {
    ws.cleanup();
  }
});

test('the date line reads the way the devlog has always printed it', () => {
  assert.equal(formatDateRange({ start: '2024-06-19', end: '2024-06-28' }), 'June 19 – June 28, 2024');
  assert.equal(formatDateRange({ start: '2024-06-19', end: '2024-06-19' }), 'June 19, 2024');
  assert.equal(formatDateRange({ start: '2024-12-30', end: '2025-01-02' }), 'December 30, 2024 – January 2, 2025');
});

test('an article with no banner, award or contents renders without them', () => {
  const ws = workspace();
  try {
    const dir = article(
      ws.published,
      'plain',
      `${MINIMAL}\ntoc: false`,
      '\nFirst paragraph.\n\n# Part one | Today {#one}\n\n![](media/a.png "A *caption*")\n\n```python\nprint("<hi>")\n```\n',
      ['a.png'],
    );
    const { html, referenced } = renderArticle(readArticle(dir, 'published'));
    assert.doesNotMatch(html, /class="band"/);
    assert.doesNotMatch(html, /createBannerScreen\(\{/);
    assert.doesNotMatch(html, /<dt>Award<\/dt>/);
    assert.doesNotMatch(html, /<nav class="toc"/);
    assert.match(html, /<p class="lede">First paragraph\.<\/p>/);
    assert.match(html, /<h1 id="one">.*<span class="day-index">Part one<\/span><span class="day-date">Today<\/span><\/h1>/);
    assert.match(html, /<img src="\/writing\/plain\/a\.png" alt="" width="1" height="1"/);
    assert.match(html, /<figcaption>A <em>caption<\/em><\/figcaption>/);
    assert.match(html, /<span class="code-lang">Python<\/span>/);
    assert.match(html, /<code class="language-python">print\(&quot;&lt;hi&gt;&quot;\)/);
    assert.match(html, /<link rel="canonical" href="https:\/\/imtani\.dev\/writing\/plain" \/>/);
    assert.deepEqual([...referenced], ['a.png']);
  } finally {
    ws.cleanup();
  }
});

test('the sitemap lists the home page and own-canonical articles, nothing else', () => {
  const ws = workspace();
  try {
    article(ws.published, 'mine', MINIMAL);
    article(ws.published, 'republished', `${MINIMAL}\ncanonical: https://medium.com/@x/post`);
    article(ws.drafts, 'secret', MINIMAL);
    const xml = renderSitemap(discover({ drafts: false, publishedDir: ws.published, draftsDir: ws.drafts }).articles);
    assert.match(xml, /<loc>https:\/\/imtani\.dev\/<\/loc>/);
    assert.match(xml, /<loc>https:\/\/imtani\.dev\/writing\/mine<\/loc>/);
    assert.doesNotMatch(xml, /republished|secret/);
    assert.ok(!xml.includes('</lastmod>'), 'no lastmod element');
  } finally {
    ws.cleanup();
  }
});

test("_headers makes every published article's media immutable, and nothing else", () => {
  const ws = workspace();
  try {
    article(ws.published, 'one', MINIMAL);
    article(ws.published, 'two', MINIMAL);
    article(ws.drafts, 'secret', MINIMAL);
    const text = renderHeaders(discover({ drafts: false, publishedDir: ws.published, draftsDir: ws.drafts }).articles);
    const rules = text.split('\n').filter((line) => line && !line.startsWith('#'));
    assert.deepEqual(rules, [
      '/writing/one/*',
      '  Cache-Control: public, max-age=31536000, immutable',
      '/writing/two/*',
      '  Cache-Control: public, max-age=31536000, immutable',
    ]);
  } finally {
    ws.cleanup();
  }
});

test('a drafts folder inside the public articles folder is refused', () => {
  const ws = workspace();
  try {
    article(ws.published, 'drafts', MINIMAL);
    assert.throws(() => discover({ drafts: false, publishedDir: ws.published, draftsDir: ws.drafts }), /drafts folder inside the PUBLIC/);
  } finally {
    ws.cleanup();
  }
});
