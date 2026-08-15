/**
 * Turn the Rise&Shine Notion export into `writing/rise-and-shine.html`.
 *
 *     npm run devlog          (also runs as the second step of `npm run build`)
 *
 * The devlog has lived on rise-and-shine.thesimple.ink, a Notion-backed host
 * that goes down and silently rewrites its own URLs, and both of Tani's CVs
 * link to it. It won the Most Educational Devlog Prize at Learn You A Game Jam
 * 2024, so it is a credential, and a credential behind a URL somebody else
 * controls is not one. This script gives it a permanent address.
 *
 * Markdown is parsed by markdown-it, a devDependency. Nothing ships to the
 * browser but the HTML this writes, one inlined stylesheet and forty lines of
 * inlined script — the site has `"dependencies": {}` and keeps it.
 *
 * Cheap and deterministic, so it runs on every build rather than being another
 * thing to remember. The expensive half — ffmpeg — lives in `media.ts` and is
 * invoked by hand; this script only reads the manifest that one leaves behind.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';

import {
  ALT_OVERRIDES,
  MEDIA_MANIFEST_REL,
  PUBLIC_BASE,
  REMOTE_EMBEDS,
  SLUGS,
  SOURCE_DIR_REL,
  SOURCE_MARKDOWN,
  extensionOf,
  isRemote,
} from './embeds.ts';
import type { MediaEntry, MediaManifest } from './media.ts';

type Token = ReturnType<MarkdownIt['parse']>[number];

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '../..');

const OUT_REL = 'writing/rise-and-shine.html';
const CANONICAL = 'https://imtani.dev/writing/rise-and-shine';
const REPO = 'https://github.com/ImTani/LYAGJ2024';
const JAM = 'https://itch.io/jam/learn-you-a-game-jam-2024';
const GAME = 'https://infinitani.itch.io/rise-and-shine';

/** The export writes no year. The jam is Learn You A Game Jam 2024. */
const JAM_YEAR = '2024';

/** Silent reading speed for prose with code in it, rounded to something honest. */
const WORDS_PER_MINUTE = 220;

// --------------------------------------------------------------- utilities ---

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** For comparing an image's alt text against the caption Notion duplicates. */
function fingerprint(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ------------------------------------------------------------------- input ---

const sourceDir = resolve(siteRoot, SOURCE_DIR_REL);
const sourcePath = join(sourceDir, SOURCE_MARKDOWN);
const outPath = resolve(siteRoot, OUT_REL);

/**
 * The Notion export lives in the private repository this one sits inside, and
 * it stays there — it carries the raw unnamed exports and is not the published
 * artefact. So this is the one generated file in the repo that is committed
 * rather than ignored: CI and the rebake deploy clone only the public repo and
 * have nothing to build it from, and Vite needs the page on disk to take it as
 * an entry.
 *
 * With the export present the page is rebuilt, which is what makes editing it
 * a matter of editing the source. Without it the committed page stands, and
 * only the absence of both is an error — that one is a broken checkout, and
 * failing here says so far more clearly than Rollup's missing-entry message.
 */
if (!existsSync(sourcePath)) {
  if (!existsSync(outPath)) {
    process.stderr.write(
      `devlog: no export at ${sourcePath}, and no committed page at ${OUT_REL}.\n` +
        'One of the two has to exist. If this is a clean clone, the page should\n' +
        'have come with it; if you are regenerating, the private repository\n' +
        'holding the Notion export needs to be the parent directory.\n',
    );
    process.exit(1);
  }
  process.stdout.write(`devlog: no export present; keeping the committed ${OUT_REL}\n`);
  process.exit(0);
}

const rawMarkdown = readFileSync(sourcePath, 'utf8');

const manifest = JSON.parse(
  readFileSync(resolve(siteRoot, MEDIA_MANIFEST_REL), 'utf8'),
) as MediaManifest;

const css = readFileSync(join(here, 'page.css'), 'utf8');
const clipScript = readFileSync(join(here, 'clips.js'), 'utf8');

/**
 * The three embeds we do not host are the only part of this page that can rot,
 * and one of them had — the Steemit proxy answers `200 OK` with a 67-byte JSON
 * body saying the image is missing, so it rendered as a broken-image stub in
 * the middle of the trigonometry section and no status-code monitor would ever
 * have flagged it. Checking the status is not enough; the content type is what
 * actually distinguishes an image from an apology.
 *
 * A failed lookup is a build error, because the alternative is shipping the
 * page and finding out from a reader. A failed *connection* is not: no network
 * is a fact about this machine, not about the URL, and failing the build on a
 * flight would be a worse bug than the one this catches.
 */
async function checkRemoteEmbeds(): Promise<void> {
  await Promise.all(
    Object.values(REMOTE_EMBEDS).map(async (embed) => {
      let response: Response;
      try {
        response = await fetch(embed.url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        process.stderr.write(`devlog: could not reach ${embed.url} (${why}); not checked\n`);
        return;
      }

      const type = response.headers.get('content-type') ?? '(none)';
      if (!response.ok || !type.startsWith('image/')) {
        throw new Error(
          `remote embed is no longer an image: ${embed.url}\n` +
            `  answered ${response.status} ${response.statusText}, content-type ${type}\n` +
            '  repoint it or drop the figure in tools/devlog/embeds.ts',
        );
      }
    }),
  );
}

await checkRemoteEmbeds();

/**
 * Notion writes its callouts as literal `<aside>` blocks with the emoji as the
 * first characters of the text. markdown-it treats an HTML block as opaque up
 * to the next blank line, which would leave the links inside them — and the DRY
 * aside is almost entirely links — as raw markdown on the page. Putting a blank
 * line after the open tag hands the body back to the block parser, which is
 * where it belongs: these are the author's asides, not decoration.
 */
function unwrapAsides(markdown: string): string {
  return markdown.replace(/^<aside>\r?\n([\s\S]*?)\r?\n<\/aside>$/gm, (_all, inner: string) => {
    const icon = /^(\p{Extended_Pictographic}️?)\s*/u.exec(inner);
    const glyph = icon?.[1] ?? '';
    const body = icon ? inner.slice(icon[0].length) : inner;
    return `<aside class="note">\n<span class="note-icon" aria-hidden="true">${glyph}</span>\n\n${body.trim()}\n\n</aside>`;
  });
}

/**
 * Repair bold links the export tore in half.
 *
 * Notion writes a bold hyperlink as `[**TODO Manager](url):**` — the emphasis
 * opens inside the link text and closes outside it. That is not something any
 * CommonMark parser can pair up, so markdown-it renders the asterisks as
 * literal characters and the page reads `**TODO Manager:**`. Seven of these,
 * all the same shape. Moving the opening `**` outside the link produces exactly
 * what Notion displayed.
 *
 * The destination pattern allows one level of nested parentheses because one of
 * the seven links to `Inheritance_(object-oriented_programming)`.
 */
function repairBoldLinks(markdown: string): string {
  return markdown.replace(
    /\[\*\*([^\]]*?)\]\(((?:[^()\s]|\([^()\s]*\))*)\)([^*\n]{0,2})\*\*/g,
    (_all, text: string, href: string, trailing: string) => `**[${text}](${href})${trailing}**`,
  );
}

/**
 * Two asterisk pairs in the export can never pair up under CommonMark and so
 * survive into the page as visible `**` in the middle of a sentence. Both are
 * in the same paragraph about float numbers, and both are export damage rather
 * than punctuation the author typed — Notion showed bold text, not asterisks.
 *
 * Listed literally, and asserted, so that a changed source fails the build
 * instead of silently leaving the fix unapplied.
 */
const ORPHAN_EMPHASIS: ReadonlyArray<readonly [string, string]> = [
  ['numbers**.**', 'numbers.'],
  ['data **which will be', 'data which will be'],
];

function stripOrphanEmphasis(markdown: string): string {
  let result = markdown;
  for (const [from, to] of ORPHAN_EMPHASIS) {
    if (!result.includes(from)) {
      throw new Error(`orphan-emphasis fixup no longer matches the export: "${from}"`);
    }
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * Three links point at the Notion page this export came from. In Notion they
 * were references to a sibling page and to two embedded videos; the export
 * flattened all three to the article's own URL. That URL is not public — every
 * one of them is a 404 for a reader, and a link that 404s is worse than no link
 * because it costs a click to discover it was never going anywhere.
 *
 * The referenced videos are not in the export, so there is nothing to repoint
 * them at. Unwrap to the link text: every sentence still reads.
 */
const DEAD_SELF_LINK = /\[([^\]]*)\]\(https:\/\/app\.notion\.com\/p\/Rise-Shine-Devlog-[^)]*\)/g;
const DEAD_SELF_LINK_COUNT = 3;

/**
 * One link in the export has no text at all — `[](url)` — so it renders as an
 * anchor wrapping nothing. Invisible, unclickable, and it makes the anchor
 * count lie to anything auditing the page.
 */
const EMPTY_LINK = /\[\]\([^)]*\)/g;
const EMPTY_LINK_COUNT = 1;

/**
 * Both counts are asserted rather than best-effort, on the same principle as
 * ORPHAN_EMPHASIS: if the export is ever regenerated and the damage changes
 * shape, the build should stop rather than quietly ship a page with fewer
 * repairs than it claims.
 */
function dropBrokenLinks(markdown: string): string {
  const dead = markdown.match(DEAD_SELF_LINK)?.length ?? 0;
  if (dead !== DEAD_SELF_LINK_COUNT) {
    throw new Error(`expected ${DEAD_SELF_LINK_COUNT} dead Notion self-links, found ${dead}`);
  }
  const empty = markdown.match(EMPTY_LINK)?.length ?? 0;
  if (empty !== EMPTY_LINK_COUNT) {
    throw new Error(`expected ${EMPTY_LINK_COUNT} empty link, found ${empty}`);
  }
  return markdown.replace(DEAD_SELF_LINK, '$1').replace(EMPTY_LINK, '');
}

const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

// The export tags every block `swift`; all of it is GDScript. Rather than ship a
// wrong language class, ship none — there is no highlighter on this page and a
// class nothing reads is a claim nothing checks.
//
// `tabindex="0"` because these blocks scroll sideways: every one of the ten
// overflows at 390px and at 320px, four do at 768px, and a scroll container
// that is not focusable is a region a keyboard cannot reach at all — the
// widest block hides 134px of itself on a 320px phone. Making it focusable is
// the whole fix; the browser's own arrow keys do the rest.
md.renderer.rules['fence'] = (tokens, idx) => {
  const token = tokens[idx];
  return `<pre tabindex="0"><code>${escapeHtml(token?.content ?? '')}</code></pre>\n`;
};

const tokens = md.parse(
  dropBrokenLinks(stripOrphanEmphasis(repairBoldLinks(unwrapAsides(rawMarkdown)))),
  {},
);

function inlineText(token: Token | undefined): string {
  if (!token?.children) return '';
  return md.renderer.renderInlineAsText(token.children, md.options, {});
}

function inlineHtml(token: Token | undefined): string {
  if (!token?.children) return '';
  return md.renderer.renderInline(token.children, md.options, {});
}

// ------------------------------------------------------------- front matter ---

// The title, byline and tagline become the masthead rather than the first three
// paragraphs of the article. Asserted rather than searched for: this input is a
// fixed file, and a silent mismatch would put the byline in the body.
const front = tokens.splice(0, 9);
if (front[0]?.type !== 'heading_open' || front[0].tag !== 'h1') {
  throw new Error('the export no longer opens with its title; check the front matter');
}

const docTitle = inlineText(front[1]);
const handle = inlineText(front[4]).replace(/^by\s+/i, '');
const tagline = inlineText(front[7]);

// -------------------------------------------------------------- transform ---

interface TocEntry {
  readonly level: 1 | 2 | 3;
  readonly id: string;
  readonly label: string;
  readonly when?: string;
}

const toc: TocEntry[] = [];
const usedIds = new Set<string>();

function uniqueId(base: string): string {
  let id = base || 'section';
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

const dayDates: string[] = [];
/** `21 July 2026` — the epilogue heading, which is the article's last edit. */
let epilogueDate = '';

/** `June 19, Day 1` and `June 23, Day 5 - June 26, Day 8`, plus the epilogue. */
function readDayHeading(text: string): { index: string; date: string; slug: string } {
  const range = /^(.+?),\s*Day\s+(\d+)\s*[-–—]\s*(.+?),\s*Day\s+(\d+)$/i.exec(text);
  if (range) {
    return {
      index: `Days ${range[2]}–${range[4]}`,
      date: `${range[1]} – ${range[3]}`,
      slug: `day-${range[2]}-${range[4]}`,
    };
  }

  const single = /^(.+?),\s*Day\s+(\d+)$/i.exec(text);
  if (single) {
    return { index: `Day ${single[2]}`, date: single[1] ?? '', slug: `day-${single[2]}` };
  }

  // `# 21 July, 2026` — the note he came back and added two years later.
  return { index: 'Epilogue', date: text.replace(/,\s*(\d{4})$/, ' $1'), slug: 'epilogue' };
}

function figureMarkup(imageToken: Token, captionHtml: string | null): string {
  const href = imageToken.attrGet('src') ?? '';
  // Local filenames arrive percent-encoded (`Untitled%201.png`); remote URLs are
  // already URLs and decoding one would corrupt its query string.
  const rawSrc = isRemote(href) ? href : decodeURIComponent(href);
  // `content` is the raw alt, emphasis markers and all; an alt of
  // "I can be *efficient*." is read out with the asterisks in it.
  const altSource = imageToken.children
    ? md.renderer.renderInlineAsText(imageToken.children, md.options, {})
    : imageToken.content;

  const caption = captionHtml ? `\n  <figcaption>${captionHtml}</figcaption>` : '';

  /**
   * A caption is attached above only when the export's own alt text and the
   * paragraph under the image are the same string — that is the Notion damage
   * this build repairs. So wherever a caption exists, repeating that string in
   * `alt` or `aria-label` makes a screen reader say it twice: once as the
   * figure's name and once as the image's. The caption is the one that stays,
   * because it is the one sighted readers get too.
   *
   * The exception is the handful of figures where we wrote a better
   * description than the export's — an `ALT_OVERRIDES` entry, or a remote
   * embed's `alt`. Those are not duplicates of anything and are the only
   * description of the picture there is, so they are kept.
   */
  function describe(authored: string | undefined): string {
    return authored ?? (captionHtml ? '' : altSource);
  }

  if (isRemote(rawSrc)) {
    // Three embeds are other people's images hosted elsewhere — a Steemit
    // mirror, a GeeksforGeeks diagram and a Giphy reaction. Re-hosting them here
    // would be republishing work that is not his, so they stay where they are
    // and stay attributed by their URL. They are the only part of this page that
    // can rot; everything else is on our own disk.
    //
    // What they get from us is the same treatment the local figures get: a
    // measured intrinsic size, so the browser reserves the box before the bytes
    // arrive and `--fig-w` stops a 480px GIF being blown up to 864.
    const remote = REMOTE_EMBEDS[rawSrc];
    if (!remote) {
      throw new Error(
        `no entry for remote embed "${rawSrc}" — add it to tools/devlog/embeds.ts`,
      );
    }
    const alt = describe(remote.alt);
    // An animated GIF has no controls and cannot be paused, so it is the one
    // thing on the page the reader cannot stop. `data-motion` is what the
    // masthead's pause control looks for; see clips.js.
    const motion = remote.animated ? ' data-motion' : '';
    return (
      `<figure class="fig fig-remote" style="--fig-w:${remote.width}px">\n` +
      `  <img src="${escapeHtml(remote.url)}" alt="${escapeHtml(alt)}"` +
      ` width="${remote.width}" height="${remote.height}"` +
      ` loading="lazy" decoding="async" referrerpolicy="no-referrer"${motion} />${caption}\n` +
      `</figure>`
    );
  }

  const slug = SLUGS[rawSrc];
  if (!slug) {
    throw new Error(`no slug for embedded file "${rawSrc}" — add it to tools/devlog/embeds.ts`);
  }

  const entry: MediaEntry | undefined = manifest.entries[slug];
  if (!entry) {
    throw new Error(`"${slug}" is not in ${MEDIA_MANIFEST_REL} — run \`npm run devlog:media\``);
  }

  // Notion puts the filename in the alt slot when a block has no caption, which
  // is what a screen reader would then be read out.
  const alt = describe(ALT_OVERRIDES[rawSrc]);
  const style = ` style="--fig-w:${entry.width}px"`;

  if (extensionOf(rawSrc) === 'gif') {
    // WebM first: everything but Safari takes VP9, which is the smaller file,
    // and Safari falls through to H.264. `controls` is in the markup on purpose
    // and clips.js removes it — see that file.
    const label = alt ? ` aria-label="${escapeHtml(alt)}"` : '';
    return (
      `<figure class="fig"${style}>\n` +
      `  <video class="clip" data-clip loop muted playsinline controls preload="none"\n` +
      `         poster="${PUBLIC_BASE}/${slug}.webp" width="${entry.width}" height="${entry.height}"${label}>\n` +
      `    <source src="${PUBLIC_BASE}/${slug}.webm" type="video/webm" />\n` +
      `    <source src="${PUBLIC_BASE}/${slug}.mp4" type="video/mp4" />\n` +
      `  </video>${caption}\n` +
      `</figure>`
    );
  }

  return (
    `<figure class="fig"${style}>\n` +
    `  <img src="${PUBLIC_BASE}/${slug}.webp" alt="${escapeHtml(alt)}"` +
    ` width="${entry.width}" height="${entry.height}" loading="lazy" decoding="async" />${caption}\n` +
    `</figure>`
  );
}

/** The lone image in a paragraph of its own, or nothing. */
function soleImage(inline: Token | undefined): Token | null {
  if (inline?.type !== 'inline' || !inline.children) return null;
  const meaningful = inline.children.filter(
    (child) => !(child.type === 'text' && child.content.trim() === ''),
  );
  const only = meaningful[0];
  return meaningful.length === 1 && only?.type === 'image' ? only : null;
}

const out: Token[] = [];
let ledeDone = false;
let seenDay = false;

for (let i = 0; i < tokens.length; i += 1) {
  const token = tokens[i];
  if (!token) continue;

  // --- headings: ids, the day treatment, and the table of contents ---
  if (token.type === 'heading_open') {
    const inline = tokens[i + 1];
    const text = inlineText(inline);

    if (token.tag === 'h1') {
      const day = readDayHeading(text);
      const id = uniqueId(day.slug);
      if (day.index === 'Epilogue') epilogueDate = day.date;
      else dayDates.push(day.date);
      toc.push({ level: 1, id, label: day.index, when: day.date });

      token.type = 'html_block';
      token.tag = '';
      token.nesting = 0;
      token.content =
        `<h1 id="${id}">` +
        `<span class="day-index">${escapeHtml(day.index)}</span>` +
        `<span class="day-date">${escapeHtml(day.date)}</span>` +
        `</h1>\n`;
      out.push(token);
      seenDay = true;
      i += 2;
      continue;
    }

    // "Before You Read" is an h3 that arrives before the first day and so has
    // no parent to nest under. In the outline it is a section in its own right;
    // filing it three levels deep under nothing would be a lie about the shape
    // of the piece.
    const level = !seenDay ? 1 : token.tag === 'h2' ? 2 : 3;
    const id = uniqueId(slugify(text));
    token.attrSet('id', id);
    toc.push({ level, id, label: text });
    out.push(token);
    continue;
  }

  // --- figures: image, plus the caption paragraph Notion duplicates below it ---
  if (token.type === 'paragraph_open') {
    const image = soleImage(tokens[i + 1]);
    if (image) {
      let captionHtml: string | null = null;
      let consumed = 2;

      const nextInline = tokens[i + 4];
      if (
        tokens[i + 3]?.type === 'paragraph_open' &&
        nextInline?.type === 'inline' &&
        fingerprint(nextInline.content) === fingerprint(image.content) &&
        fingerprint(image.content) !== ''
      ) {
        captionHtml = inlineHtml(nextInline);
        consumed = 5;
      }

      token.type = 'html_block';
      token.tag = '';
      token.nesting = 0;
      token.content = `${figureMarkup(image, captionHtml)}\n`;
      out.push(token);
      i += consumed;
      continue;
    }

    // The first paragraph of the article is the standfirst.
    if (!ledeDone) {
      token.attrJoin('class', 'lede');
      ledeDone = true;
    }
  }

  out.push(token);
}

const bodyHtml = md.renderer.render(out, md.options, {});

// ----------------------------------------------------------------- masthead ---

const prose = rawMarkdown
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/<\/?[a-z][^>]*>/gi, ' ');
const wordCount = prose.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
const readingMinutes = Math.round(wordCount / WORDS_PER_MINUTE);

const firstDay = dayDates[0] ?? '';
const lastDay = (dayDates[dayDates.length - 1] ?? '').split('–').pop()?.trim() ?? '';
const dateRange = `${firstDay} – ${lastDay}, ${JAM_YEAR}`;

/**
 * The two dates the structured data was missing, taken from the headings rather
 * than invented: the article was published on the last day it covers, and last
 * changed on the day of the epilogue he came back and added.
 *
 * Parsed through `Date` and asserted, because a heading that stops matching
 * `readDayHeading` would otherwise put `Invalid Date` in the JSON-LD, and a
 * wrong date in structured data is worse than none.
 */
function isoDay(text: string, what: string): string {
  const when = new Date(`${text} UTC`);
  if (Number.isNaN(when.getTime())) {
    throw new Error(`could not read a date out of the ${what} heading: "${text}"`);
  }
  return when.toISOString().slice(0, 10);
}

const datePublished = isoDay(`${lastDay} ${JAM_YEAR}`, 'last day');
const dateModified = isoDay(epilogueDate, 'epilogue');

const tocHtml = (() => {
  const lines: string[] = [];
  let depth = 0;

  for (const entry of toc) {
    if (depth === 0) {
      lines.push('<ol>');
    } else if (entry.level > depth) {
      // Nested lists open *inside* the still-open <li>, which is what makes the
      // outline an outline rather than three flat lists in a row.
      for (let k = depth; k < entry.level; k += 1) lines.push('<ol>');
    } else {
      lines.push('</li>');
      for (let k = depth; k > entry.level; k -= 1) lines.push('</ol></li>');
    }

    const when = entry.when ? ` <span class="toc-when">${escapeHtml(entry.when)}</span>` : '';
    lines.push(
      `<li class="lvl-${entry.level}"><a href="#${entry.id}">${escapeHtml(entry.label)}${when}</a>`,
    );
    depth = entry.level;
  }

  for (let k = depth; k > 0; k -= 1) lines.push('</li></ol>');
  return lines.join('\n');
})();

const description =
  'A day-by-day account of building Rise&Shine, a Godot puzzle-platformer, for ' +
  'Learn You A Game Jam 2024 — shaders, entity components, tilemaps and the ' +
  'things that broke. Winner of the Most Educational Devlog Prize.';

const html = `<!doctype html>
<!--
  Generated by tools/devlog/build.ts from the Notion export. Do not edit by
  hand: run \`npm run devlog\`, or change tools/devlog/page.css for the styling.
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(docTitle)} — Tanishk Narula</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="author" content="Tanishk Narula" />
    <link rel="canonical" href="${CANONICAL}" />
    <!--
      The favicon is deferred until the identity exists, so there is no icon to
      point at and /favicon.ico 404s on every load. An empty data URL is the
      one way to say "there is no icon" that costs no request; delete this line
      the day there is a real one.
    -->
    <link rel="icon" href="data:," />
    <meta name="theme-color" content="#111316" media="(prefers-color-scheme: dark)" />
    <meta name="theme-color" content="#faf6ee" media="(prefers-color-scheme: light)" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(docTitle)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:image" content="https://imtani.dev${PUBLIC_BASE}/rise-and-shine-cover.webp" />
    <meta name="twitter:card" content="summary_large_image" />
    <!--
      The author is a reference to the Person node declared on the home page,
      not a second description of him. One @id across the site is what lets a
      search engine treat the article and the identity as the same graph
      instead of two pages that happen to share a name.
    -->
    <script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: docTitle,
    description,
    url: CANONICAL,
    mainEntityOfPage: CANONICAL,
    datePublished,
    dateModified,
    image: `https://imtani.dev${PUBLIC_BASE}/rise-and-shine-cover.webp`,
    author: { '@type': 'Person', '@id': 'https://imtani.dev/#person', name: 'Tanishk Narula' },
    publisher: { '@id': 'https://imtani.dev/#person' },
    inLanguage: 'en',
    keywords: ['Godot', 'game jam', 'devlog', 'shaders', 'game development'],
    about: { '@type': 'VideoGame', name: 'Rise&Shine', url: GAME },
    award: `Most Educational Devlog Prize, Learn You A Game Jam ${JAM_YEAR}`,
  },
  null,
  2,
)
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}
    </script>
    <style>
${css.trimEnd()}
    </style>
  </head>
  <body>
    <a class="skip" href="#article">Skip to the devlog</a>
    <div class="page">
      <header class="masthead">
        <a class="masthead-up" href="/">← imtani.dev</a>
        <h1 class="title">${escapeHtml(docTitle)}</h1>
        <p class="tagline">${escapeHtml(tagline)}</p>
        <p class="byline">by Tanishk Narula <span class="handle">(${escapeHtml(handle)})</span></p>
        <p class="meta">
          ${escapeHtml(dateRange)}<span class="sep">·</span>${wordCount.toLocaleString('en-US')} words<span class="sep">·</span>about ${readingMinutes} minutes
        </p>
        <p class="award">
          Most Educational Devlog Prize<br />
          <span class="award-where"><a href="${JAM}">Learn You A Game Jam ${JAM_YEAR}</a></span>
        </p>
        <!--
          The pause control ships hidden and clips.js reveals it, because it is
          only true when clips.js is running. With JavaScript off, or under
          reduced motion, nothing starts by itself and every clip already has
          its own controls — a button offering to stop motion that is not
          happening would be the page lying about itself.
        -->
        <ul class="masthead-links">
          <li><a href="${REPO}">source code</a></li>
          <li><a href="${GAME}">play Rise&amp;Shine</a></li>
          <li><a href="#article">start reading</a></li>
          <li hidden>
            <button class="motion-button" type="button" data-motion-toggle>Pause the motion</button>
          </li>
        </ul>
      </header>

      <div class="layout">
        <nav class="toc" aria-labelledby="contents">
          <h2 class="toc-h" id="contents">Contents</h2>
${tocHtml}
        </nav>

        <!--
          A role rather than a main element: the landmark set was banner,
          navigation and contentinfo with nothing in the middle, and at the wide
          breakpoint the layout wrapper dissolves into the page grid with
          display:contents, so a second wrapper here would be another element
          needing grid treatment to sit exactly where this one already sits.
          The role is the same landmark for no layout at all.
        -->
        <article class="prose" id="article" role="main">
${bodyHtml}
        </article>
      </div>

      <footer class="colophon">
        <p>
          Written during Learn You A Game Jam ${JAM_YEAR} and first published on
          Notion. Rehosted here in ${new Date().getFullYear()} so that the address stops
          moving. The text is unchanged; the animations were GIFs and are now video.
        </p>
        <p><a href="/">imtani.dev</a> <span class="sep">·</span> <a href="${REPO}">github.com/ImTani/LYAGJ2024</a></p>
      </footer>
    </div>
    <script>
${clipScript.trimEnd()}
    </script>
  </body>
</html>
`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

process.stdout.write(
  `devlog: ${OUT_REL} — ${wordCount.toLocaleString('en-US')} words, ` +
    `${toc.length} headings, ${Object.keys(manifest.entries).length} local media files\n`,
);
