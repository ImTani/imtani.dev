/**
 * Turn every article into `writing/<slug>.html`.
 *
 *     npm run writing          published articles (also the second step of `npm run build`)
 *     npm run writing:drafts   the same, plus articles/drafts/ from the private repo
 *     node tools/writing/build.ts [--drafts] [--only <slug>]
 *
 * An article is a folder — `articles/<slug>/` when published,
 * `articles/drafts/<slug>/` in the private repo while it is not — holding `article.md`
 * and its `media/`. The format is specified in articles/README.md and
 * checked in articles.ts; config.ts says where the folders are. Everything in
 * this directory — the template below, page.css, the scripts — is shared, once,
 * by every article.
 *
 * It started as the Rise&Shine devlog's build. The devlog had lived on
 * rise-and-shine.thesimple.ink, a Notion-backed host that goes down and
 * silently rewrites its own URLs, and both of Tani's CVs link to it. It won the
 * Most Educational Devlog Prize at Learn You A Game Jam 2024, so it is a
 * credential, and a credential behind a URL somebody else controls is not one.
 * This script gave it a permanent address, and its Markdown — repaired once,
 * out of the Notion export — is now its source.
 *
 * Markdown is parsed by markdown-it, a devDependency. This script emits the
 * HTML, one inlined stylesheet and six inlined scripts, none of which anything
 * on the page depends on to be readable — the site has `"dependencies": {}`
 * and keeps it.
 *
 * That is a claim about what this file writes, and it is deliberately no
 * longer a claim about what a reader receives. Cloudflare Web Analytics is on
 * for the account, so the edge injects a beacon into the HTML response after
 * this script and the Worker have both finished with it — roughly 11 kB of
 * third-party script and one request per page view. Nothing here can see it or
 * stop it; the toggle is account-level (dashboard → Analytics & Logs → Web
 * Analytics), and Tani has decided to keep it, 16 August 2026. The sentence
 * above used to say "nothing ships to the browser", which was false and
 * checkable in ten seconds with DevTools.
 *
 * Cheap and deterministic, so it runs on every build rather than being another
 * thing to remember. The expensive half — ffmpeg — lives in `media.ts` and is
 * invoked by hand; this script reads each media file's size off its own header.
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import MarkdownIt from 'markdown-it';

import { type Article, discover, mediaRef, mediaUrl, pageUrl } from './articles.ts';
import { MEDIA_DIR, OUT_DIR, SITE_ORIGIN, SITE_OWNER, SITE_ROOT } from './config.ts';
import { MOUNT_INNER_PX, extensionOf, figureWidth, isRemote, remoteWidth } from './embeds.ts';
import { DRAWN, type DrawnFigure } from './figures.ts';
import { handLine, mulberry32, wander } from './hand.js';
import { imageSize } from './image-size.ts';

type Token = ReturnType<MarkdownIt['parse']>[number];

const here = dirname(fileURLToPath(import.meta.url));

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

// ------------------------------------------------------------------- input ---

/**
 * A shared file, as text with LF line endings. Git stores these LF, but a
 * Windows checkout or editor can hand them over CRLF, and a CR pasted into the
 * page is a byte of difference between a build here and the same build in CI.
 */
function shared(name: string): string {
  return readFileSync(join(here, name), 'utf8').replace(/\r\n/g, '\n');
}

const css = shared('page.css');
const clipScript = shared('clips.js');
const themeBoot = shared('theme-boot.js');
const themeScript = shared('theme.js');
const tocScript = shared('toc.js');
const remoteBoot = shared('remote-boot.js');
const remoteScript = shared('remote.js');
const codeScript = shared('code.js');
const drawnRulesScript = shared('drawn-rules.js');

/**
 * hand.js, ready to be pasted into a <script> tag.
 *
 * It is an ES module because this file imports it, and the page has no modules
 * — everything is inlined into one HTML file. Stripping the `export ` keyword
 * off the front of each declaration turns it into an ordinary script, which is
 * why every export in that file starts at column zero. The two are concatenated
 * inside one IIFE below, so `drawn-rules.js` can call `handLine` without
 * anything reaching the global object.
 */
const handScript = shared('hand.js').replace(/^export /gm, '');

/**
 * banner.js and its boot, the same way and for the same reason.
 *
 * banner.js has two consumers: this file pastes it into a <script> tag, and
 * `banner-plate.ts` imports it as a module at build time to bake the no-JS
 * plates. One source, so the static plate cannot drift from the live render.
 * They are concatenated inside one IIFE below so `createBannerScreen` never
 * reaches the global object.
 */
const bannerScript = shared('banner.js').replace(/^export /gm, '');
const bannerBootScript = shared('banner-boot.js');

/**
 * The remote's face: what the reader sees on the phone's floating menu button.
 *
 * A PLACEHOLDER, AND NOT A DESIGN DECISION. The button is going to be a small
 * character, and the character is Tani's to draw — this site does not let a
 * machine make its art. Until it exists the button wears the page's own label
 * voice, the word the control is, so nothing here pretends to be the drawing.
 *
 * Swapping it in is this one constant. Paste his SVG over the span: page.css
 * sizes whatever sits in `.remote-face` and sets `fill: currentColor` on an SVG
 * there, so the drawing takes ink in both themes and the accent on hover with
 * no colour of its own — as long as its paths carry no `fill` attribute, or
 * carry `fill="currentColor"`. The face is decoration only; the button's name
 * is the hidden "Menu" beside it in the markup, which does not move.
 */
const REMOTE_FACE = '<span class="remote-word">menu</span>';

// ------------------------------------------------------ the link underline ---

/**
 * The drawn underline, as two repeating tiles baked into the stylesheet.
 *
 * A link is the one element on this page that can wrap, so it cannot be an SVG
 * cut to its own length: half of it would be on the next line with nothing under
 * it. What survives a wrap is a repeating background, and `box-decoration-break:
 * clone` gives both fragments the full treatment.
 *
 * TWO TILES, NOT ONE, AND THE PERIODS ARE COPRIME. A single repeating tile makes
 * the wobble periodic, and a period a reader can see is wallpaper rather than a
 * hand — the one thing that would give the whole treatment away. 97 and 131 are
 * both prime, so the pair repeats every 12,707px: about a hundred and thirty
 * links, which is more than twice what this article has. The two lines are
 * unioned by the compositor rather than added, both are the same solid colour,
 * and neither carries any alpha, so the measured contrast of the result is
 * exactly the measured contrast of `--underline` and not a blend of anything.
 *
 * BAKED, NOT GENERATED IN THE BROWSER. This is the opposite call from the day
 * rule, and deliberately: a background-image cannot take `currentColor`, so a
 * runtime version would have to regenerate itself every time the reader touched
 * the theme button, and it would leave a reader with JavaScript off looking at
 * fifty-eight links with nothing under them. Baked, the underline is in the
 * stylesheet before anything runs, follows the palette through all three of its
 * cases, and costs the page no script at all. The seeds are therefore fixed
 * rather than random: this file is meant to be deterministic, and a build that
 * rewrote every underline in the article on every run would make the generated
 * page impossible to read a diff of.
 */
const TILE_A_PX = 97;
const TILE_B_PX = 131;
/** Tall enough for the wander plus half the weight, with the line down the middle. */
const TILE_H_PX = 4;

/**
 * The two tiles, stated as departures from the day rule's wing.
 *
 * The wing is 1.65px of weight and 1.4px of wobble, which is a display ornament
 * at 400px across. An underline is the same pen doing a much smaller job: the
 * numbers here are what keeps the *union* of the two tiles at roughly the
 * optical weight of the 1px hairline it replaces, so that turning the treatment
 * on does not darken the colour of a page with fifty-eight links in it.
 *
 * A carries the line and most of the wander; B is the second pass, thinner and
 * steadier, and mostly rides inside A. Where B pokes out it adds thickness, and
 * where the two part company by a fraction of a pixel it adds a furred edge —
 * which is what two passes of a real pen do. Their excursions are kept small
 * enough that they always overlap: A wanders +/-0.44px and B +/-0.30px, so the
 * centres are never more than 0.74px apart, against a summed half-weight that
 * does not fall below 0.55px + 0.45px.
 */
const TILES = [
  {
    len: TILE_A_PX,
    step: 2,
    xDigits: 1,
    y: TILE_H_PX / 2,
    cyclic: true,
    seed: 0x5eed1a11,
    wobble: 0.8,
    weight: 1.05,
    driftN: 2,
    driftAmp: 0.36,
    tremorN: 6,
    tremorAmp: 0.19,
    pressN: 4,
    minWeight: 0.55,
  },
  {
    len: TILE_B_PX,
    step: 2,
    xDigits: 1,
    y: TILE_H_PX / 2,
    cyclic: true,
    seed: 0x0b0113ed,
    wobble: 0.8,
    weight: 0.9,
    driftN: 3,
    driftAmp: 0.22,
    tremorN: 9,
    tremorAmp: 0.16,
    pressN: 5,
    minWeight: 0.45,
  },
] as const;

/**
 * Pull a palette token out of page.css rather than restating it here.
 *
 * The stylesheet is the only place these two colours are decided — `--underline`
 * carries a measured 3.33:1 that was a defect once and was fixed deliberately —
 * and a copy of the hex in this file would be a second place to change it and a
 * silent regression the day somebody changed only one. So the values are read
 * back out of the file that owns them.
 *
 * page.css declares each token four times, in this order: the light `:root`, the
 * `prefers-color-scheme` block, the `[data-theme='dark']` block, and print. The
 * two dark blocks are documented duplicates that have to stay identical, so this
 * asserts that they are — which makes the parse safe and, as a side effect, is
 * the only automated check that invariant has ever had. Print restores a real
 * `text-decoration` and needs no tile.
 */
function paletteToken(name: string): { light: string; dark: string } {
  const found = [...css.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, 'g'))].map(
    (m) => m[1] as string,
  );
  if (found.length !== 4) {
    throw new Error(
      `devlog: expected four declarations of --${name} in page.css, found ${found.length}. ` +
        'The link tiles are coloured from that file; see paletteToken in build.ts.',
    );
  }
  if (found[1] !== found[2]) {
    throw new Error(
      `devlog: the two dark declarations of --${name} in page.css disagree ` +
        `(${found[1]} and ${found[2]}). They are duplicates on purpose and have to match.`,
    );
  }
  return { light: found[0] as string, dark: found[1] as string };
}

// ------------------------------------------------------------- colour maths ---

/**
 * sRGB to OKLab and back, so that a colour on this page can be DERIVED from
 * another one rather than picked next to it.
 *
 * OKLab rather than HSL because the two moves this file makes — hold the hue,
 * take the chroma most of the way out, lift the lightness a little — are only
 * honest in a perceptual space. In HSL, dropping saturation on a pale warm
 * yellow also changes how light it looks, and the result has to be re-eyeballed;
 * in OKLab the three axes are independent enough that the recipe is the
 * description. Twenty lines, no dependency.
 *
 * The matrices are Björn Ottosson's published OKLab transform.
 */
type Rgb = readonly [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function rgbToHex([r, g, b]: Rgb): string {
  const q = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${q(r)}${q(g)}${q(b)}`;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function srgbToOklab(rgb: Rgb): Rgb {
  const [r, g, b] = rgb.map(toLinear) as unknown as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToSrgb([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** An SVG tile as a data URI, ready to sit in a `url()`. */
function tileUri(d: string, width: number, colour: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${TILE_H_PX}' ` +
    `width='${width}' height='${TILE_H_PX}'><path d='${d}' fill='${colour}'/></svg>`;
  const encoded = svg
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20');
  return `url("data:image/svg+xml,${encoded}")`;
}

const linkRuleCss = (() => {
  const underline = paletteToken('underline');
  const accent = paletteToken('accent');
  const geometry = TILES.map(({ seed, ...tile }) => handLine({ ...tile, rnd: mulberry32(seed) }));

  const set = (rest: string, hover: string) =>
    [
      `  --link-rule-a: ${tileUri(geometry[0] as string, TILE_A_PX, rest)};`,
      `  --link-rule-b: ${tileUri(geometry[1] as string, TILE_B_PX, rest)};`,
      `  --link-rule-a-on: ${tileUri(geometry[0] as string, TILE_A_PX, hover)};`,
      `  --link-rule-b-on: ${tileUri(geometry[1] as string, TILE_B_PX, hover)};`,
    ].join('\n');

  return [
    '/* ------------------------------------------------- the drawn underline --- */',
    '/* Generated by tools/writing/build.ts from tools/writing/hand.js — the same',
    '   generator that draws the day rule and the masthead rule. The rules that',
    '   use these four values are in page.css, above; only the pigment is here,',
    '   because a background-image cannot inherit currentColor and so each tile',
    '   has to be baked once per colour it is ever drawn in. Three cases, in step',
    '   with the palette blocks at the top of page.css. */',
    ':root {',
    `  --link-tile-a: ${TILE_A_PX}px;`,
    `  --link-tile-b: ${TILE_B_PX}px;`,
    `  --link-tile-h: ${TILE_H_PX}px;`,
    set(underline.light, accent.light),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    "  :root:where(:not([data-theme='light'])) {",
    set(underline.dark, accent.dark)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    '  }',
    '}',
    '',
    ":root[data-theme='dark'] {",
    set(underline.dark, accent.dark),
    '}',
  ].join('\n');
})();

// -------------------------------------------------------------- the band ---

/**
 * The masthead band's two plate URLs, as custom properties.
 *
 * They are generated here rather than written into page.css for the same reason
 * the link tiles are: the URLs are the article's — the `banner:` block of its
 * front matter — and a copy of them in a shared stylesheet is a second place to
 * change them. Everything that decides how the band is used is in page.css.
 *
 * The devlog's names carry the geometry they were baked at, because the
 * generated `_headers` serves every article's media `immutable` for a year:
 * re-baking a plate at a different band means a new URL, exactly as
 * re-encoding a clip means a new file name. See tools/writing/headers.ts.
 */
function bannerCss(plateLight: string, plateDark: string): string {
  return [
    '/* ------------------------------------------------------ the band plates --- */',
    "/* Written by tools/writing/build.ts from the banner block of the article's",
    '   front matter. The plates are what a reader with no JavaScript keeps: the',
    '   identical screen, baked at the rest offset by tools/writing/banner-plate.ts.',
    '   Three cases, in step with the palette blocks at the top of page.css. */',
    ':root {',
    `  --band-plate: url("${plateLight}");`,
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    "  :root:where(:not([data-theme='light'])) {",
    `    --band-plate: url("${plateDark}");`,
    '  }',
    '}',
    '',
    ":root[data-theme='dark'] {",
    `  --band-plate: url("${plateDark}");`,
    '}',
  ].join('\n');
}

/**
 * The live band's options, from the article's `banner:` settings, written into
 * banner-boot.js at `__BANNER_OPTIONS__`. Grouped and ordered the way that file
 * has always laid them out — the owner's five, the fade, the geometry, the
 * motion — so the generated call reads like the hand-written one it replaced.
 * Only the settings the article gives are written; banner.js's DEFAULTS are the
 * rest, and banner-plate.ts bakes the no-JS plate from the same merge.
 */
const BANNER_GROUPS: ReadonlyArray<readonly string[]> = [
  ['grain', 'levels', 'cell'],
  ['ramp', 'rampWidth', 'rampSpace'],
  ['artScale', 'anchorX', 'focus', 'travel', 'direction', 'feather'],
  ['follow', 'wiggle', 'wiggleSign', 'fps'],
];

function bannerOptions(settings: Readonly<Record<string, number | string | null>>): string {
  const lines: string[] = [];
  const literal = (v: number | string | null) => (typeof v === 'string' ? `'${v}'` : String(v));
  for (const group of BANNER_GROUPS) {
    const set = group.filter((key) => key in settings);
    if (set.length === 0) continue;
    lines.push('', ...set.map((key) => `    ${key}: ${literal(settings[key] ?? null)},`));
  }
  const known = new Set(BANNER_GROUPS.flat());
  for (const key of Object.keys(settings)) {
    if (!known.has(key)) throw new Error(`banner setting "${key}" has no place in BANNER_GROUPS in build.ts`);
  }
  return lines.join('\n');
}

// --------------------------------------------------------- the torn edges ---

/**
 * The asides, as slips of a different stock with torn top and bottom edges.
 *
 * WHY THERE IS MATERIAL HERE AT ALL. `.note` carried `border-left: 2px solid
 * var(--accent)`, which is the default shape of a callout in every framework
 * ever shipped, and Tani read it exactly as what it was: *"a very geometric way
 * of doing things... it's a very general way of showing block notes and just
 * feels outside. It doesn't feel like it meshes."* PRODUCT.md's ninth principle
 * says where the hand is allowed to go — *"structural elements that repeat
 * rarely"*, because *"character that is charming once is noise nine times"* —
 * and there are three of these in six thousand words. Three is rare. Forty
 * figures is not, which is the same principle saying no somewhere else.
 *
 * WHY TORN RATHER THAN DRAWN. Every other mark on this page is a pen: the day
 * rule's fleuron and wings, the masthead rule, the link underlines. A fourth pen
 * mark would have been a fourth rule, and the aside would still have been a
 * callout with a nicer border. PRODUCT.md's scrapbook section names the other
 * material directly — *"things that were put on a page rather than printed on
 * it. Torn and cut edges, overlap"* — so this is the page's first piece of
 * paper behaviour rather than its fourth piece of ink behaviour. The slip is a
 * shade of stock lighter than the ground, where `--sunk` is a shade darker: one
 * is something laid on the page and the other is a hole in it, which is why a
 * code block and an aside cannot be confused for one another.
 *
 * AN ALPHA MASK, NOT A PICTURE. The tear is a `mask-image`, so it carries no
 * colour at all — it is baked exactly once and works in the light palette, both
 * dark palettes and any future one, where the link tiles have to be baked four
 * times over because a `background-image` cannot inherit `currentColor`. It also
 * needs no JavaScript, so the aside is torn before anything runs and stays torn
 * if nothing ever does.
 *
 * TWO TILE WIDTHS, BOTH PRIME AND UNEQUAL. The edges repeat, and a repeat a
 * reader can see is wallpaper. 431 and 397 give a shade over two repeats across
 * the 860px column and none at all on a phone, and because the two are different
 * the top and bottom tears never line up into a pattern. The wanders are
 * `cyclic`, which makes each tile seamless in value and in slope at its own
 * join — see hand.js — so there is no kink to find even where it does repeat.
 *
 * ALL FOUR SIDES, NOT TWO. The slip was torn along the top and bottom and its
 * sides were the box's own edge, and the result was the opposite of a slip. Two
 * tiled tears ran out to a knife-straight side and stopped dead there, mid-wiggle,
 * fibre band and all, with a square corner under each — which is what a long
 * torn strip looks like when something has cropped its ends off. That is what
 * the eye read, and Tani said it in five words: *"The edges cut off on these
 * panels."* Nothing was clipping the note; the note was drawn as a clipping.
 * A piece torn out of a sheet is torn all the way round, and its corners are
 * wherever two tears happened to meet, so the sides get tears of their own off
 * the same `wander`, and the corners are left to come out of the arithmetic.
 *
 * The side tiles are prime, unequal to each other and to the top and bottom
 * ones, and longer than any of the three notes is tall on a phone (274px at
 * most), so a side does not repeat at all at the sizes a reader will see.
 */
const TORN_PX = 10;
const TORN_TILE_TOP_PX = 431;
const TORN_TILE_BOTTOM_PX = 397;
const TORN_TILE_LEFT_PX = 281;
const TORN_TILE_RIGHT_PX = 307;
const TORN_SEED_TOP = 0x7043_ed9e;
const TORN_SEED_BOTTOM = 0x0b07_70a1;
const TORN_SEED_LEFT = 0x51de_7ea2;
const TORN_SEED_RIGHT = 0x2e5f_c0d3;

/**
 * How far each mask tile's paper runs past its own tear, in px. See `tornPath`:
 * each tile is the whole slip seen from one edge, so its far side has to reach
 * past the far side of any note there will ever be. It costs nothing — the
 * tile is rasterised at the note's size, and the image's own box is what cuts
 * the path — so it is simply a number no note will reach.
 */
const TORN_REACH = 10_000;

type TornEdge = 'top' | 'bottom' | 'left' | 'right';

/** Top and bottom run along x; the sides run along y. */
const tornAlongX = (edge: TornEdge) => edge === 'top' || edge === 'bottom';

/** The near edges have their paper at larger coordinates than the tear. */
const tornNear = (edge: TornEdge) => edge === 'top' || edge === 'left';

/**
 * THE FIBRE EDGE.
 *
 * Tani, on the version that had the tear and nothing else: *"I really like the
 * shape, but maybe a border following the same shape, but slightly desaturated,
 * like a torn piece of paper is."* He is describing the real thing, and the real
 * thing has a reason. A sheet is coated or printed on its face and is raw pulp
 * inside, so tearing one exposes the core: lighter than the face because it has
 * never been inked, and markedly LESS saturated because it is fibre rather than
 * surface. That is not a highlight and it is not a border; it is a different
 * material, seen edge-on.
 *
 * WHERE THE BAND GOES. Inside the silhouette, hugging the tear, not outside it.
 * Real torn paper has nothing outside its own ragged boundary — the pale core IS
 * the outermost couple of millimetres of the sheet. Putting the band outside
 * would also have meant growing the note's box by the band on both edges and
 * moving every paragraph after it down five pixels, for a silhouette a reader
 * cannot tell from this one.
 *
 * IT IS THE SAME CURVE, NOT THE SAME PARAMETERS. `tornCurve` is evaluated once
 * per edge and both the mask and the band read the same array of numbers out of
 * it. A fibre edge that does not track its own tear is worse than no fibre edge,
 * and "seeded identically" is a claim that survives exactly until somebody
 * changes the order of two `wander` calls; sharing the array is not a claim.
 */
const FIBRE_PX = 3.5;

/**
 * The band's colour: `--slip` taken 22% of the way toward `--accent`, in OKLab.
 *
 * Chosen by Tani on 22 October 2026 at `reference/note-edge.html`, at 3.5px, on
 * both themes — "ink-touched", as if the tear had caught the page's ink.
 *
 * It replaced the pulp-core derivation above it in this file's history (four
 * fifths of the chroma out, lightness lifted a touch). That was right for the
 * light page and wrong for the dark one: on the warm brown slip it came out a
 * near-neutral grey, #2c2a28, at 1.09:1 against the note — a cool line around a
 * warm object. *"It doesn't feel like it belongs."* Mixing toward the accent
 * keeps the band in the page's own warm family on both grounds and lets it
 * register as an outline (1.38:1 dark, 1.37:1 light against the slip) without
 * leaving the hairline register; the extra width is what makes it read as an
 * edge rather than a highlight.
 */
const FIBRE_INK = 0.22;

function fibreOf(slip: string, accent: string): string {
  const s = srgbToOklab(hexToRgb(slip));
  const a = srgbToOklab(hexToRgb(accent));
  return rgbToHex(
    oklabToSrgb([
      s[0] + (a[0] - s[0]) * FIBRE_INK,
      s[1] + (a[1] - s[1]) * FIBRE_INK,
      s[2] + (a[2] - s[2]) * FIBRE_INK,
    ]),
  );
}

/**
 * One torn edge, as [along, depth] pairs: the depth of the boundary into its
 * strip at every step along the tile. Along is x for the top and bottom and y
 * for the sides; `tornAt` is the one place that knows which.
 *
 * Not `handLine`: that returns a stroke with two edges and a weight, and a torn
 * edge is a boundary rather than a line. What it does share is the hand — the
 * same `wander` at the same two scales the pen uses, one slow and one fast, so
 * the tear has the same rhythm as everything else on the page.
 *
 * The fast wander is the fibre and carries most of the character; the slow one
 * is where the tear generally ran. `edge` is the side of the note the strip is
 * on, and so which side of the tear the paper is: below it for the top, above
 * it for the bottom, right of it for the left, left of it for the right.
 */
/**
 * Every two pixels, not every one. The faster of the two wanders has a stop
 * every fifteen pixels, so sampling at one loses nothing to sampling at two —
 * the chord under a two-pixel step departs from the curve by about three
 * hundredths of a pixel — and these paths are baked into the page sixteen
 * times over: four masks, and four bands in each of three palette blocks. At one decimal and one sample every two pixels the whole treatment is a
 * quarter of the bytes it was and looks the same.
 */
const TORN_STEP = 2;

function tornCurve(seed: number, len: number, edge: TornEdge): Array<[number, number]> {
  const rnd = mulberry32(seed);
  const slow = wander(rnd, 5, true);
  const fast = wander(rnd, 29, true);
  const mid = tornNear(edge) ? TORN_PX * 0.46 : TORN_PX * 0.54;
  const at = (x: number) => {
    const u = x / len;
    return mid + slow(u) * TORN_PX * 0.26 + fast(u) * TORN_PX * 0.16;
  };

  const points: Array<[number, number]> = [];
  for (let x = 0; x <= len; x += TORN_STEP) points.push([x, at(x)]);
  // The tiles are prime widths, so the last step rarely lands on the end — and a
  // tile that misses its own right edge does not repeat seamlessly.
  if ((points[points.length - 1] as [number, number])[0] !== len) points.push([len, at(len)]);
  return points;
}

/** One point of a tile, from along-and-depth to the tile's own x and y. */
function tornAt(edge: TornEdge, along: number, depth: number): string {
  const d = Number(depth.toFixed(1));
  return tornAlongX(edge) ? `${along},${d}` : `${d},${along}`;
}

/**
 * The mask: everything on the paper side of this one tear — not a strip of it,
 * the whole slip as this edge sees it. page.css intersects the four, so a pixel
 * is paper only if every edge agrees it is, and each corner comes out as
 * wherever the two tears that meet there happen to cross. Under the old union
 * of two strips and a body there was no way to say "and", which is why the
 * corners were square and the sides were straight.
 *
 * The far side runs out `TORN_REACH` px, and the tile is laid with
 * `preserveAspectRatio` pinning its viewBox — the strip the tear lives in — to
 * the note's own edge at scale 1 (see `edgeUri`). Everything past the viewBox
 * is still drawn, out to the image's box, which page.css sizes to the note: so
 * one tile is a tear on its edge and solid paper across the rest, at any size.
 *
 * Along the tile the path starts and ends a pixel outside it, flat. The image
 * cuts that off, which is the point: an edge that stopped exactly on the tile's
 * boundary would be antialiased there, and on a 1.25 or 1.5 screen that is a
 * faint column of not-quite-paper at every join — a seam across the whole
 * slip, now that a tile is the whole slip and not a ten-pixel strip of it.
 */
function tornPath(curve: ReadonlyArray<readonly [number, number]>, len: number, edge: TornEdge): string {
  const far = tornNear(edge) ? TORN_REACH : -TORN_REACH;
  const first = (curve[0] as readonly [number, number])[1];
  const last = (curve[curve.length - 1] as readonly [number, number])[1];
  const points: Array<readonly [number, number]> = [[-1, first], ...curve, [len + 1, last], [len + 1, far], [-1, far]];
  return `M${points.map(([along, depth]) => tornAt(edge, along, depth)).join('L')}Z`;
}

/**
 * The band, as the tear's own centreline pushed half a band into the paper and
 * then stroked at the band's width. A stroke rather than a filled outline, which
 * is the opposite of the call `handLine` makes and for the opposite reason: a
 * pen stroke has to vary in width and this does not, so a filled outline here
 * would be two copies of the same numbers for a band of constant thickness.
 *
 * Every strip is drawn in a box one band deeper than the mask's strip, and in
 * every one the band lands on the paper side of the tear — because opposite
 * strips are anchored to opposite ends of the note. The top strip is flush with
 * the top, so the mask's coordinates and this box's are the same and the paper
 * is below the curve. The bottom strip is flush with the bottom, so this box
 * starts one band higher than the mask's does and the paper is above the curve.
 * The sides are the same two cases turned on end. The same expression describes
 * all four.
 *
 * At a corner two bands cross, each running into the other edge's tear and cut
 * off by it — which is what the pale core of a torn corner does.
 */
function fibrePath(curve: ReadonlyArray<readonly [number, number]>, edge: TornEdge): string {
  return `M${curve.map(([along, depth]) => tornAt(edge, along, depth + FIBRE_PX / 2)).join('L')}`;
}

/**
 * The same encoding `tileUri` uses. `paint` is the fill or the stroke; `pin` is
 * a `preserveAspectRatio` for a mask tile, which is drawn into a box bigger than
 * its viewBox — see `tornPath` — and has to sit on its own edge of it, unscaled.
 * `meet` is what keeps the scale at 1: the viewBox is the full length of the
 * tile in one direction and the depth of a tear in the other, and the box it
 * meets is the tile's length by a whole note.
 */
function edgeUri(d: string, width: number, height: number, paint: string, pin?: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}' ` +
    (pin ? `preserveAspectRatio='${pin} meet' ` : '') +
    `width='${width}' height='${height}'><path d='${d}' ${paint}/></svg>`;
  const encoded = svg
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20');
  return `url("data:image/svg+xml,${encoded}")`;
}

const tornEdgeCss = (() => {
  const slip = paletteToken('slip');
  const accent = paletteToken('accent');
  const fibre = { light: fibreOf(slip.light, accent.light), dark: fibreOf(slip.dark, accent.dark) };

  const band = TORN_PX + FIBRE_PX;

  // Each edge's curve is evaluated here, once, and both its mask and its band
  // read it. `pin` is the corner of the note the mask tile is anchored to.
  const edges = (
    [
      ['top', TORN_SEED_TOP, TORN_TILE_TOP_PX, 'xMinYMin'],
      ['bottom', TORN_SEED_BOTTOM, TORN_TILE_BOTTOM_PX, 'xMinYMax'],
      ['left', TORN_SEED_LEFT, TORN_TILE_LEFT_PX, 'xMinYMin'],
      ['right', TORN_SEED_RIGHT, TORN_TILE_RIGHT_PX, 'xMaxYMin'],
    ] as const
  ).map(([edge, seed, len, pin]) => ({ edge, len, pin, curve: tornCurve(seed, len, edge) }));

  // Width by height: the tile's length runs along its edge.
  const box = (edge: TornEdge, len: number, depth: number): [number, number] =>
    tornAlongX(edge) ? [len, depth] : [depth, len];

  const stroke = (colour: string) =>
    `fill='none' stroke='${colour}' stroke-width='${FIBRE_PX}' stroke-linejoin='round'`;

  const bands = (colour: string) =>
    [
      `  /* the fibre, derived from --slip: ${colour} */`,
      ...edges.map(
        ({ edge, len, curve }) =>
          `  --fibre-${edge}: ${edgeUri(fibrePath(curve, edge), ...box(edge, len, band), stroke(colour))};`,
      ),
    ].join('\n');

  return [
    '/* -------------------------------------------------------- the torn edge --- */',
    '/* Generated by tools/writing/build.ts from tools/writing/hand.js — the same',
    '   wander that draws the day rule, used here as a boundary rather than as a',
    '   stroke. The rules that consume these are on `.note` in page.css, above.',
    '',
    '   THE MASK IS ALPHA and is baked once, where the link tiles have to be baked',
    '   per palette. THE FIBRE BAND IS NOT: it is a colour, a background-image',
    '   cannot inherit currentColor, and so it is baked per scheme exactly like the',
    '   link tiles are. Both come off the same curve — see tornCurve in build.ts,',
    '   which is evaluated once per edge and read by both.',
    '',
    '   The seeds are fixed: this build is deterministic, and a page whose asides',
    '   tore differently on every run would be impossible to diff. */',
    ':root {',
    `  --torn: ${TORN_PX}px;`,
    `  --fibre-w: ${FIBRE_PX}px;`,
    ...edges.map(({ edge, len }) => `  --torn-tile-${edge}: ${len}px;`),
    ...edges.map(
      ({ edge, len, pin, curve }) =>
        `  --torn-${edge}: ${edgeUri(tornPath(curve, len, edge), ...box(edge, len, TORN_PX), "fill='#000'", pin)};`,
    ),
    bands(fibre.light),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    "  :root:where(:not([data-theme='light'])) {",
    bands(fibre.dark)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n'),
    '  }',
    '}',
    '',
    ":root[data-theme='dark'] {",
    bands(fibre.dark),
    '}',
  ].join('\n');
})();

/** How many figures fill their mount and how many sit smaller on it. Per article. */
let figureCounts = { full: 0, inset: 0 };

/**
 * Put the picture on its mount. Every figure, every time.
 *
 * There used to be two presentations and the build chose between them from the
 * file's own pixel width: wider than the mount's inside and the figure went
 * flush to the column, narrower and it was mounted at its own size. That is a
 * rule, but the thing it is keyed on — what resolution somebody's screen
 * recorder happened to grab in 2024 — is invisible to a reader and was never
 * anything they agreed to. So the page read as though some pictures reached the
 * edges and some did not for no reason, which is exactly what Tani said: *"I
 * don't understand if there's a convention here."*
 *
 * One convention now. One treatment, one edge, one left margin the whole way
 * down, and the picture sits centred on the mount at whatever size it honestly
 * is. What that costs is stated where it is paid: the slot is 794px rather than
 * the column's 860, so the thirty figures that used to go flush are 7.7 per cent
 * smaller than they were. What it buys is that a difference in size now reads as
 * a difference between the pictures instead of as a layout that cannot make its
 * mind up.
 *
 * The mount reserves its height from the picture's declared width and height,
 * like the picture itself does, so nothing here moves when the bytes land.
 */
function mount(width: number, media: string): string {
  if (width >= MOUNT_INNER_PX) figureCounts.full += 1;
  else figureCounts.inset += 1;
  return `<div class="mount">${media}</div>`;
}

/**
 * The embeds we do not host are the only part of a page that can rot,
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
async function checkRemoteEmbeds(urls: readonly string[]): Promise<void> {
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        process.stderr.write(`writing: could not reach ${url} (${why}); not checked\n`);
        return;
      }

      const type = response.headers.get('content-type') ?? '(none)';
      if (!response.ok || !type.startsWith('image/')) {
        throw new Error(
          `remote embed is no longer an image: ${url}\n` +
            `  answered ${response.status} ${response.statusText}, content-type ${type}\n` +
            '  repoint it or drop the figure from the article',
        );
      }
    }),
  );
}

/**
 * An aside is a line `<aside>`, Markdown, and a line `</aside>` — the shape
 * Notion wrote its callouts in, kept as the article syntax because it reads as
 * what it is. An emoji at the very start of the body is the note's icon.
 * markdown-it treats an HTML block as opaque up to the next blank line, which
 * would leave the links inside them — and the DRY aside is almost entirely
 * links — as raw markdown on the page. Putting a blank line after the open tag
 * hands the body back to the block parser, which is where it belongs: these are
 * the author's asides, not decoration.
 */
function unwrapAsides(markdown: string): string {
  return markdown.replace(/^<aside>\r?\n([\s\S]*?)\r?\n<\/aside>$/gm, (_all, inner: string) => {
    const icon = /^(\p{Extended_Pictographic}️?)\s*/u.exec(inner);
    const glyph = icon?.[1] ?? '';
    const body = icon ? inner.slice(icon[0].length) : inner;
    const iconHtml = glyph ? `<span class="note-icon" aria-hidden="true">${glyph}</span>\n` : '';
    return `<aside class="note">\n${iconHtml}\n${body.trim()}\n\n</aside>`;
  });
}

// ------------------------------------------------------------- highlighting ---

/**
 * A GDScript highlighter, in about a hundred lines and no dependency.
 *
 * The export tags every block `swift` and none of it is Swift, so the build used
 * to ship no language class at all — a wrong claim being worse than a missing
 * one. That was the right call while there was no highlighter; it is not a
 * reason not to have one. Eleven blocks of unhighlighted code in a
 * twenty-seven-minute article about writing code is a lot of grey.
 *
 * NO LIBRARY, AT EITHER END. The site ships `"dependencies": {}` and keeps it,
 * and a highlighter in the page would be a runtime dependency for something that
 * cannot change after the build. A build-time one would be a devDependency and
 * three hundred grammars for a language it does not have. One language, one
 * pass, here.
 *
 * SEVEN KINDS, THREE COLOURS. This emits the token kind it actually found and
 * lets the stylesheet decide how many of them share a colour, because the number
 * of hues is a design decision and the lexer should not be where it is made. See
 * the code-token block in page.css: grammar in the accent, the names and values
 * the author brought in a second earth hue, comments in `--muted`, everything
 * else plain ink.
 *
 * WHAT IT KNOWS ABOUT TYPES. A type is whatever follows `:`, `->`, `extends`,
 * `class_name`, `as` or `is`, plus whatever is inside the brackets of a
 * `Array[Node2D]`. That is a heuristic, not a parser, and it has one honest
 * failure mode: a dictionary literal whose value is a bare identifier —
 * `{"a": foo}` — would call `foo` a type. There are none in this article, and
 * being wrong about a colour there costs a colour.
 */
const GDSCRIPT_KEYWORDS = new Set([
  'and', 'as', 'assert', 'await', 'break', 'breakpoint', 'class', 'class_name',
  'const', 'continue', 'elif', 'else', 'enum', 'extends', 'false', 'for', 'func',
  'if', 'in', 'is', 'match', 'not', 'null', 'or', 'pass', 'preload', 'return',
  'self', 'signal', 'static', 'super', 'true', 'var', 'while', 'yield',
]);

/** After one of these, the next identifier names a type. */
const GDSCRIPT_TYPE_AFTER = new Set(['extends', 'class_name', 'as', 'is']);

function tok(kind: string, text: string): string {
  return `<span class="tk-${kind}">${escapeHtml(text)}</span>`;
}

function highlightGdscript(code: string): string {
  let out = '';
  let i = 0;
  // Set by `:`, `->` and the four keywords above; survives spaces and brackets,
  // cleared by anything that has been consumed as a token.
  let expectType = false;
  let afterType = false;

  const isWord = (c: string) => /[A-Za-z0-9_]/.test(c);

  while (i < code.length) {
    const ch = code[i] as string;

    // A comment runs to the end of its line, and `#` cannot open anything else.
    if (ch === '#') {
      const nl = code.indexOf('\n', i);
      const end = nl === -1 ? code.length : nl;
      out += tok('com', code.slice(i, end));
      i = end;
      expectType = afterType = false;
      continue;
    }

    // Strings. GDScript takes both quotes and escapes with a backslash; an
    // unterminated one runs to the end of the line rather than eating the file.
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch && code[j] !== '\n') {
        j += code[j] === '\\' ? 2 : 1;
      }
      const end = Math.min(code.length, code[j] === ch ? j + 1 : j);
      out += tok('str', code.slice(i, end));
      i = end;
      expectType = afterType = false;
      continue;
    }

    // Node paths: `$Sprite2D`, `$"Path With Spaces"`, `%Unique`. `%` is also
    // the modulo operator, so it is only a path when a name follows it directly.
    if ((ch === '$' || ch === '%') && isWord(code[i + 1] ?? '')) {
      let j = i + 1;
      while (j < code.length && /[A-Za-z0-9_/]/.test(code[j] as string)) j += 1;
      out += tok('path', code.slice(i, j));
      i = j;
      expectType = afterType = false;
      continue;
    }
    if (ch === '$' && (code[i + 1] === '"' || code[i + 1] === "'")) {
      const quote = code[i + 1] as string;
      let j = i + 2;
      while (j < code.length && code[j] !== quote && code[j] !== '\n') j += 1;
      const end = Math.min(code.length, j + 1);
      out += tok('path', code.slice(i, end));
      i = end;
      expectType = afterType = false;
      continue;
    }

    // Annotations: `@export`, `@export_range`, `@onready`, `@tool`.
    if (ch === '@' && /[A-Za-z_]/.test(code[i + 1] ?? '')) {
      let j = i + 1;
      while (j < code.length && isWord(code[j] as string)) j += 1;
      out += tok('ann', code.slice(i, j));
      i = j;
      expectType = afterType = false;
      continue;
    }

    // Numbers, including `0x1f`, `1_000`, `0.2` and `1e-3`.
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(code[i + 1] ?? ''))) {
      let j = i;
      while (j < code.length && /[0-9a-fA-FxX_.]/.test(code[j] as string)) j += 1;
      if ((code[j] === '+' || code[j] === '-') && /[eE]/.test(code[j - 1] ?? '')) j += 1;
      while (j < code.length && /[0-9]/.test(code[j] as string)) j += 1;
      out += tok('num', code.slice(i, j));
      i = j;
      expectType = afterType = false;
      continue;
    }

    // Words: a keyword, a type in a type position, or a plain identifier.
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < code.length && isWord(code[j] as string)) j += 1;
      const word = code.slice(i, j);
      if (expectType) {
        out += tok('type', word);
        expectType = false;
        afterType = true;
      } else if (GDSCRIPT_KEYWORDS.has(word)) {
        out += tok('key', word);
        expectType = GDSCRIPT_TYPE_AFTER.has(word);
        afterType = false;
      } else {
        out += escapeHtml(word);
        afterType = false;
      }
      i = j;
      continue;
    }

    if (ch === '-' && code[i + 1] === '>') {
      out += '-&gt;';
      i += 2;
      expectType = true;
      afterType = false;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
    if (ch === ':') {
      // `if x:` and `func f():` end their line here and have no type after them;
      // a newline is what clears the expectation rather than a lookahead.
      expectType = true;
      afterType = false;
    } else if (ch === '\n') {
      expectType = afterType = false;
    } else if (ch === '[' && afterType) {
      expectType = true;
      afterType = false;
    } else if (ch !== ' ' && ch !== '\t' && ch !== ']') {
      expectType = afterType = false;
    }
  }

  return out;
}

const md = new MarkdownIt({ html: true, linkify: false, typographer: false });

/**
 * Words that depend on the screen: `[[wide: …]]`, `[[band: …]]`, `[[menu: …]]`.
 *
 * WHY. The article tells the reader where the contents is, and where it is
 * depends on what they are reading on. Tani's note in the source asked for
 * exactly this — "can we show this just on big screens? Do-able?" — so the
 * markdown can now say each version and the page shows the one that is true:
 *
 *   If you'd rather skip to a specific section, the table of contents will
 *   take you there. [[wide: It is to the right of this text.]] [[band: It is
 *   just above this text.]] [[menu: The menu button will let you access it!]]
 *
 * THE THREE NAMES ARE THE THREE PLACES THE CONTENTS LIVES, not three screen
 * sizes, and page.css shows each one exactly where that is true:
 *
 *   wide   the gutter layout, 105rem and up: the contents is in the right gutter
 *   menu   below 105rem with the remote running — a phone or a laptop — where
 *          it is behind the menu button
 *   band   below 105rem WITHOUT the remote: no JavaScript, or a remote that
 *          could not start, where the fallback leaves it as a band above the
 *          article
 *
 * `phone` is an alias for `menu` and renders identically. It was the name when
 * only phones had the remote; laptops got it too, the name stopped being true,
 * and the alias is there so that a `[[phone: …]]` anywhere — an old copy, a
 * habit — still works rather than printing its brackets.
 *
 * They are keyed to the page's own breakpoints and to the boot class the remote
 * sets, so if either ever moves the sentence moves with it. The ones that are
 * not true are `display: none`, which takes them out of what a screen reader
 * reads as well as what is drawn. None of them prints: paper has no contents
 * rail to be to the left or right of.
 *
 * THE SYNTAX is double brackets, a name, a colon, then the text, all on one
 * line: easy to type, easy to see in the source, and nothing markdown already
 * means — a single `[` is a link, and `[[` followed by one of these three names
 * appears nowhere else in the article. A name that is not one of the three is
 * left alone and prints literally, which is the right failure: visible, and
 * obvious in the page. The text inside is ordinary markdown, so a link or
 * emphasis in it works — the rule hands the inside back to the inline parser,
 * the same way markdown-it's own link rule parses a link's label. It cannot
 * nest and cannot contain `]]`.
 *
 * The word count reads the `band` version only, since a reader only ever meets
 * one of the three and `band` is the one every reader can get — see `prose`.
 */
const SCREEN_VARIANTS = ['wide', 'band', 'menu', 'phone'] as const;
const SCREEN_CLASS: Record<string, string> = { phone: 'menu' };
const SCREEN_OPEN = new RegExp(`^\\[\\[(${SCREEN_VARIANTS.join('|')}):[ \\t]*`);

type InlineRule = Parameters<MarkdownIt['inline']['ruler']['before']>[2];

const screenRule: InlineRule = (state, silent) => {
  if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;
  const opened = SCREEN_OPEN.exec(state.src.slice(state.pos, state.posMax));
  if (!opened) return false;
  const start = state.pos + opened[0].length;
  const end = state.src.indexOf(']]', start);
  if (end < 0 || end > state.posMax) return false;

  if (!silent) {
    const open = state.push('screen_open', 'span', 1);
    const name = opened[1] ?? '';
    open.attrSet('class', `screen-${SCREEN_CLASS[name] ?? name}`);
    const oldMax = state.posMax;
    state.pos = start;
    state.posMax = end;
    state.md.inline.tokenize(state);
    state.posMax = oldMax;
    state.push('screen_close', 'span', -1);
  }

  state.pos = end + 2;
  return true;
};

md.inline.ruler.before('link', 'screen', screenRule);

/**
 * A fence's info string is its language, and the language is a claim the page
 * repeats — in the bar's label and in a `language-*` class — so it is only ever
 * the one the author wrote. The Notion export tagged every GDScript block
 * `swift`, and the build refused to emit that class for years because it would
 * have been a claim nothing checked; the article now says `gdscript`, which is
 * true, and is the one language with a highlighter (`HIGHLIGHTERS`). Any other
 * language is shown plain under its own name: a block with no colour is honest,
 * a block coloured by a lexer for some other language is not. An untagged block
 * is labelled "Code" and claims no language at all.
 *
 * `tabindex="0"` because these blocks scroll sideways: every one of them
 * overflows at 390px and at 320px, four do at 768px, and a scroll container that
 * is not focusable is a region a keyboard cannot reach at all — the widest block
 * hides 134px of itself on a 320px phone. Making it focusable is the whole fix;
 * the browser's own arrow keys do the rest.
 *
 * THE BAR IS A DELIBERATE EXCEPTION and it is worth saying so where it is built.
 * PRODUCT.md's first principle is that nothing here should look like the thing it
 * is, and every other surface on this page obeys it — the callouts are torn
 * paper, the dividers are drawn, there is not a card anywhere. A code block is
 * the one place that does not apply, because it is a tool rather than an
 * expression: a reader who has scrolled to a block of GDScript and wants it is
 * looking for a copy button, in a strip along the top, on the right. Tani asked
 * for exactly that — *"a little header bar, rounded corners, that just types out
 * that this is GDScript highlighted, and a copy button... make it look like a
 * code block, how usual connotation is."* Inventing a novel affordance here
 * would cost the reader the thing and buy the page nothing.
 *
 * The button ships `hidden` and code.js reveals it, the same contract the pause
 * and theme controls ship under: it needs the clipboard API, so with no script
 * — or on a browser that will not give it — the block is exactly the complete,
 * readable, selectable block it was before this existed. The status span next to
 * it is an empty live region, which is where the outcome of a press is said.
 */
const HIGHLIGHTERS: Readonly<Record<string, { readonly name: string; readonly highlight: (code: string) => string }>> = {
  gdscript: { name: 'GDScript', highlight: highlightGdscript },
};

/** What the bar calls a language with no highlighter. Unlisted ones show as written. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  bash: 'Shell', c: 'C', cpp: 'C++', cs: 'C#', csharp: 'C#', css: 'CSS', gdshader: 'Godot shader',
  glsl: 'GLSL', html: 'HTML', java: 'Java', js: 'JavaScript', javascript: 'JavaScript', json: 'JSON',
  py: 'Python', python: 'Python', rust: 'Rust', sh: 'Shell', shell: 'Shell', sql: 'SQL', text: 'Text',
  ts: 'TypeScript', typescript: 'TypeScript', yaml: 'YAML',
};

/** Per article, so each page's buttons are numbered from 1. */
let fenceCount = 0;

md.renderer.rules['fence'] = (tokens, idx) => {
  const token = tokens[idx];
  const info = (token?.info ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  if (!/^[a-z0-9+#_-]*$/.test(info)) {
    throw new Error(`a code block is tagged "${info}"; a language is one word of letters and digits`);
  }
  const highlighter = HIGHLIGHTERS[info];
  const name = highlighter?.name ?? LANGUAGE_NAMES[info] ?? (info || 'Code');
  const lang = info ? ` class="language-${escapeHtml(info)}"` : '';
  const code = token?.content ?? '';
  fenceCount += 1;
  return (
    '<div class="code">' +
    '<div class="code-bar">' +
    `<span class="code-lang">${escapeHtml(name)}</span>` +
    '<span class="code-said" role="status"></span>' +
    // The visible word is "Copy", and the name it is given starts with it —
    // WCAG 2.5.3 — then says which of the eleven this one is, because a
    // screen reader listing the page's buttons otherwise gets "Copy" eleven
    // times with nothing to tell them apart.
    `<button class="code-copy" type="button" hidden aria-label="Copy code block ${fenceCount}">Copy</button>` +
    '</div>' +
    `<pre tabindex="0"><code${lang}>` +
    `${highlighter ? highlighter.highlight(code) : escapeHtml(code)}</code></pre>` +
    '</div>\n'
  );
};

function inlineText(token: Token | undefined): string {
  if (!token?.children) return '';
  return md.renderer.renderInlineAsText(token.children, md.options, {});
}

// -------------------------------------------------------------- headings ---

interface TocEntry {
  readonly level: 1 | 2 | 3;
  readonly id: string;
  readonly label: string;
  readonly when?: string;
}

/** Per article: the ids already given out on the page being built. */
let usedIds = new Set<string>();

function uniqueId(base: string): string {
  let id = base || 'section';
  let n = 2;
  while (usedIds.has(id)) id = `${base}-${n++}`;
  usedIds.add(id);
  return id;
}

/**
 * `{#some-id}` at the end of any heading sets its anchor, instead of the one
 * derived from its words. It is taken off the heading before anything reads the
 * text, so it never reaches the page, the contents or the word count. Worth
 * using wherever a link to a section should outlive a change to its wording.
 */
const EXPLICIT_ID = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

function takeExplicitId(inline: Token | undefined): string | undefined {
  const last = inline?.children?.[inline.children.length - 1];
  if (!inline || last?.type !== 'text') return undefined;
  const found = EXPLICIT_ID.exec(last.content);
  if (!found) return undefined;
  last.content = last.content.slice(0, found.index);
  inline.content = inline.content.replace(EXPLICIT_ID, '');
  return found[1];
}

/**
 * A part heading — any `#` heading — is a label and, optionally, when:
 * `# Day 1 | June 19`, `# Epilogue | 21 July 2026`, `# Further reading`. The
 * label is the big index the drawn rule sits over, and the part after the
 * first ` | ` is the date line under it and the date beside it in the contents.
 *
 * This used to be read out of the devlog's own headings — `June 19, Day 1`,
 * a range for Days 5–8, a bare date for the epilogue — by a parser that knew
 * the shape of that one article. The rule an author can see is the better one.
 */
function readPartHeading(text: string): { label: string; when?: string } {
  const at = text.indexOf(' | ');
  if (at === -1) return { label: text.trim() };
  return { label: text.slice(0, at).trim(), when: text.slice(at + 3).trim() };
}

// --------------------------------------------------------------- figures ---

/**
 * A figure drawn in figures.ts, on the same mount as every other figure.
 *
 * `--fig-w` is the width it was drawn at, so on desktop it renders 1:1 and
 * below that it scales with the column like a picture would. The wrapper is the
 * hook a live figure's script finds it by.
 *
 * A figure's script goes inside its own <figure>, last, rather than among the
 * page's scripts at the foot: it is part of the figure, it finds the figure from
 * `document.currentScript`, and a <script> inside the <figure> cannot become a
 * sibling that breaks `.prose > x + y` spacing the way one between two
 * paragraphs would.
 */
function drawnFigureMarkup(fig: DrawnFigure, caption: string): string {
  if (fig.script && /<\/script|<!--/i.test(fig.script)) {
    throw new Error(`the script for the "${fig.name}" figure cannot be inlined as written`);
  }
  const script = fig.script ? `\n  <script>\n${fig.script.trimEnd()}\n  </script>` : '';
  return (
    `<figure class="fig fig-drawn" style="--fig-w:${fig.width}px">\n  ` +
    mount(fig.width, `<div class="drawn" data-figure="${fig.name}">${fig.render()}</div>`) +
    `${caption}${script}\n</figure>`
  );
}

/**
 * All the body needs to know about its article: where its media is and what
 * its URL is. The block editor renders blocks of an article whose front matter
 * may not be valid yet, so the body never reads the front matter.
 */
type ArticleRef = Pick<Article, 'slug' | 'dir'>;

/** What one article's figures needed, gathered while it renders. */
interface FigureContext {
  readonly article: ArticleRef;
  /** Remote URLs, checked after rendering — see `checkRemoteEmbeds`. */
  readonly remotes: string[];
  /** Files in media/ the page uses; anything else there is an error. */
  readonly referenced: Set<string>;
  /** Footer credits owed by the drawn figures on the page, in order of use. */
  readonly credits: Map<string, { readonly html: string; readonly note: string }>;
}

/**
 * `{width=480 height=269 animated}` straight after a remote image: the size
 * of a picture this build cannot measure, because it is on somebody else's
 * server and CI may have no network. A local file is measured off its own
 * header, so it takes no attributes.
 */
interface ImageAttrs {
  readonly width?: number;
  readonly height?: number;
  readonly animated?: boolean;
}

function readAttrs(text: string, where: string): ImageAttrs {
  const out: { width?: number; height?: number; animated?: boolean } = {};
  for (const part of text.trim().split(/\s+/).filter(Boolean)) {
    const kv = /^(width|height)=(\d+)$/.exec(part);
    if (kv) out[kv[1] as 'width' | 'height'] = Number(kv[2]);
    else if (part === 'animated') out.animated = true;
    else throw new Error(`${where}: unknown image attribute "${part}" (width=, height=, animated)`);
  }
  return out;
}

function figureMarkup(ctx: FigureContext, imageToken: Token, attrs: ImageAttrs | null): string {
  const { article } = ctx;
  const href = imageToken.attrGet('src') ?? '';
  // `content` is the raw alt, emphasis markers and all; an alt of
  // "I can be *efficient*." is read out with the asterisks in it.
  const alt = imageToken.children
    ? md.renderer.renderInlineAsText(imageToken.children, md.options, {})
    : imageToken.content;

  /**
   * THE TITLE IS THE CAPTION: `![alt](src "caption")`, and the caption is
   * Markdown, so emphasis and code in it render. Notion wrote every caption
   * twice — once as the image's alt, once as a paragraph under it — and the
   * build used to pair the two up and drop one. One place to write it is what
   * the source says now.
   *
   * Alt is the description for someone who cannot see the picture, and it is
   * normally left EMPTY on a captioned figure, deliberately: a screen reader
   * reads the figure's caption as its name, so alt text that repeats it is
   * heard twice. Write alt where it says what the caption does not — the
   * checkpoint clip, which has no caption, is described entirely by its alt.
   */
  const title = imageToken.attrGet('title');
  const captionHtml = title ? md.renderInline(title) : null;
  const caption = captionHtml ? `\n  <figcaption>${captionHtml}</figcaption>` : '';
  const where = `${article.slug}: ${href}`;

  // Drawn here rather than borrowed: figures.ts builds the SVG, and any alt
  // written on the reference is ignored because the drawing carries its own
  // description. See that file.
  if (href.startsWith('figure:')) {
    const drawn = DRAWN[href.slice('figure:'.length)];
    if (!drawn) {
      throw new Error(`${where}: no drawn figure by that name. There are: ${Object.keys(DRAWN).join(', ')}`);
    }
    if (attrs) throw new Error(`${where}: a drawn figure takes no attributes`);
    if (drawn.credit) ctx.credits.set(drawn.credit.html, drawn.credit);
    return drawnFigureMarkup(drawn, caption);
  }

  if (isRemote(href)) {
    // A remote embed is somebody else's image hosted elsewhere — in the devlog,
    // a Giphy reaction. Re-hosting it here would be republishing work that is
    // not his, so it stays where it is and stays attributed by its URL. It is
    // the only part of a page that can rot; everything else is on our own disk.
    //
    // What they get from us is the same treatment the local figures get: a
    // declared intrinsic size, so the browser reserves the box before the bytes
    // arrive and `--fig-w` stops a 480px GIF being blown up to fill the slot.
    if (!attrs?.width || !attrs.height) {
      throw new Error(`${where}: a remote image needs its size, as {width=… height=…} after it`);
    }
    ctx.remotes.push(href);
    // `remoteWidth` rather than `figureWidth`, and the difference is the one
    // thing we cannot do for this one: a local file that would take a shallow
    // downscale is re-transcoded until it does not, and there is no such lever on
    // somebody else's server. See embeds.ts.
    const shown = remoteWidth(attrs.width, attrs.height);
    // An animated GIF has no controls and cannot be paused, so it is the one
    // thing on the page the reader cannot stop. `data-motion` is what the
    // masthead's pause control looks for; see clips.js.
    const motion = attrs.animated ? ' data-motion' : '';
    return (
      `<figure class="fig fig-remote" style="--fig-w:${shown}px">\n  ` +
      mount(
        shown,
        `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"` +
          ` width="${attrs.width}" height="${attrs.height}"` +
          ` loading="lazy" decoding="async" referrerpolicy="no-referrer"${motion} />`,
      ) +
      `${caption}\n</figure>`
    );
  }

  if (attrs) throw new Error(`${where}: a local file is measured from its own header and takes no attributes`);

  // Local paths arrive percent-encoded by markdown-it; the file name does not.
  const file = mediaRef(article, decodeURIComponent(href));
  const media = (name: string) => mediaUrl(article.slug, name);
  const ext = extensionOf(file);

  if (ext === 'mp4') {
    // A clip is three files from one source, cut by media.ts: the H.264 the
    // reference names, a VP9 WebM beside it, and a WebP poster of the first
    // frame. The poster is required — it is what a reader with JavaScript off
    // sees, and its header is where the clip's size is read from — and the
    // WebM is used when it is there.
    const stem = file.slice(0, -'.mp4'.length);
    const poster = mediaRef(article, `${MEDIA_DIR}/${stem}.webp`, `${where} (its poster, ${stem}.webp)`);
    const hasWebm = existsSync(join(article.dir, MEDIA_DIR, `${stem}.webm`));
    const size = imageSize(readFileSync(join(article.dir, MEDIA_DIR, poster)), poster);
    for (const used of [file, poster, ...(hasWebm ? [`${stem}.webm`] : [])]) ctx.referenced.add(used);
    // `--fig-w` is the width the picture RENDERS at, not the width of the file;
    // see the same line for stills below.
    const shown = figureWidth(size.width, size.height);
    // WebM first: everything but Safari takes VP9, which is the smaller file,
    // and Safari falls through to H.264. `controls` is in the markup on purpose
    // and clips.js removes it — see that file.
    const label = alt ? ` aria-label="${escapeHtml(alt)}"` : '';
    return (
      `<figure class="fig" style="--fig-w:${shown}px">\n  ` +
      mount(
        shown,
        `<video class="clip" data-clip loop muted playsinline controls preload="none"\n` +
          `         poster="${media(poster)}" width="${size.width}" height="${size.height}"${label}>\n` +
          (hasWebm ? `    <source src="${media(`${stem}.webm`)}" type="video/webm" />\n` : '') +
          `    <source src="${media(file)}" type="video/mp4" />\n` +
          `  </video>`,
      ) +
      `${caption}\n</figure>`
    );
  }

  // No local GIFs: as an <img> one could not be paused, and as a file it is
  // ten times the size of the clip media.ts would cut from it.
  if (ext === 'gif') {
    throw new Error(`${where}: transcode a GIF into a clip with \`npm run writing:media\` and reference its .mp4`);
  }
  if (!['webp', 'png', 'jpg', 'jpeg'].includes(ext)) {
    throw new Error(`${where}: a figure is a WebP, PNG or JPEG still, or an .mp4 clip`);
  }
  ctx.referenced.add(file);
  const size = imageSize(readFileSync(join(article.dir, MEDIA_DIR, file)), file);
  // `--fig-w` is the width the picture RENDERS at, not the width of the file.
  // It used to be the file's own width with `max-width: 100%` doing the rest,
  // which is what put seven figures on a shallow non-integer downscale and what
  // let a near-square capture stand 794px tall. Both answers are one number and
  // it is computed in embeds.ts, from the same function `media.ts` transcodes
  // against — so the file on disk and the box on the page cannot disagree.
  // The `width` and `height` attributes stay the file's own, because that pair
  // is what reserves the box and keeps CLS at zero.
  const shown = figureWidth(size.width, size.height);
  return (
    `<figure class="fig" style="--fig-w:${shown}px">\n  ` +
    mount(
      shown,
      `<img src="${media(file)}" alt="${escapeHtml(alt)}"` +
        ` width="${size.width}" height="${size.height}" loading="lazy" decoding="async" />`,
    ) +
    `${caption}\n</figure>`
  );
}

/**
 * The lone image in a paragraph of its own, with its `{…}` attributes if it
 * has them, or nothing. The attribute text is taken out of the paragraph so it
 * is never counted as words.
 */
function soleImage(inline: Token | undefined, where: string): { image: Token; attrs: ImageAttrs | null } | null {
  if (inline?.type !== 'inline' || !inline.children) return null;
  const meaningful = inline.children.filter(
    (child) => !(child.type === 'text' && child.content.trim() === ''),
  );
  const only = meaningful[0];
  if (only?.type !== 'image') return null;
  if (meaningful.length === 1) return { image: only, attrs: null };
  const tail = meaningful[1];
  const braced = tail?.type === 'text' ? /^\{([^}]*)\}$/.exec(tail.content.trim()) : null;
  if (meaningful.length !== 2 || !braced || !tail) return null;
  inline.children = inline.children.filter((child) => child !== tail);
  return { image: only, attrs: readAttrs(braced[1] ?? '', where) };
}

// ---------------------------------------------------------------- reading ---

/**
 * The words a reader reads in the article: headings, prose, lists, asides and
 * captions. Not code — a code block is not read at reading speed — not alt text,
 * which a sighted reader never meets, not the masthead, and of the three
 * screen-dependent sentences only `band`, the one every reader can get (see
 * SCREEN_VARIANTS). Counted off the parsed article rather than off its source
 * text, so markup can never be mistaken for a word.
 */
function countWords(tokens: readonly Token[]): number {
  let text = '';
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children) continue;
    let hidden = false;
    for (const child of token.children) {
      if (child.type === 'screen_open') hidden = child.attrGet('class') !== 'screen-band';
      else if (child.type === 'screen_close') hidden = false;
      else if (hidden) continue;
      else if (child.type === 'text' || child.type === 'code_inline') text += child.content;
      else if (child.type === 'softbreak' || child.type === 'hardbreak') text += ' ';
      else if (child.type === 'image') text += ` ${child.attrGet('title') ?? ''} `;
    }
    text += ' ';
  }
  return text.split(/\s+/).filter((word) => /[a-z0-9]/i.test(word)).length;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function longDay(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
}

/** `June 19 – June 28, 2024`; one day is `June 19, 2024`; across years, both years. */
export function formatDateRange(date: { readonly start: string; readonly end: string }): string {
  const { start, end } = date;
  if (start === end) return longDay(start, true);
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${longDay(start, false)} – ${longDay(end, false)}, ${end.slice(0, 4)}`;
  }
  return `${longDay(start, true)} – ${longDay(end, true)}`;
}

// ------------------------------------------------------------------ render ---

export interface Rendered {
  readonly html: string;
  /** Remote image URLs on the page, for `checkRemoteEmbeds`. */
  readonly remotes: readonly string[];
  /** Files in the article's media/ the page uses. */
  readonly referenced: ReadonlySet<string>;
  readonly stats: {
    readonly words: number;
    readonly headings: number;
    readonly figures: { readonly full: number; readonly inset: number };
    readonly fences: number;
  };
}

/** What `renderBody` produced, and what it found while producing it. */
interface RenderedBody {
  readonly html: string;
  /** The parsed article, for the word count. */
  readonly tokens: readonly Token[];
  readonly toc: readonly TocEntry[];
  readonly ctx: FigureContext;
  /** Whether a paragraph here could be the standfirst, used or not. */
  readonly ledeCandidate: boolean;
  /** Whether a paragraph here was given the standfirst's class. */
  readonly ledeUsed: boolean;
}

/**
 * The Markdown of an article to the HTML inside its `<article class="prose">`:
 * the headings and their contents entries, the figures, the standfirst.
 * `lede: false` withholds the standfirst's class, for a fragment that is not
 * where the body starts — see `renderFragment`.
 */
function renderBody(article: ArticleRef, body: string, options: { readonly lede?: boolean } = {}): RenderedBody {
  const { slug } = article;
  figureCounts = { full: 0, inset: 0 };
  fenceCount = 0;
  usedIds = new Set<string>();

  const ctx: FigureContext = { article, remotes: [], referenced: new Set(), credits: new Map() };
  const tokens = md.parse(unwrapAsides(body), {});
  const toc: TocEntry[] = [];
  const out: Token[] = [];
  let ledeDone = options.lede === false;
  let ledeCandidate = false;
  let ledeUsed = false;
  let seenPart = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;

    // --- headings: ids, the part treatment, and the table of contents ---
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const explicit = takeExplicitId(inline);
      const text = inlineText(inline);

      if (token.tag === 'h1') {
        const part = readPartHeading(text);
        const id = uniqueId(explicit ?? slugify(part.label));
        toc.push({ level: 1, id, label: part.label, ...(part.when ? { when: part.when } : {}) });

        token.type = 'html_block';
        token.tag = '';
        token.nesting = 0;
        // The empty span is where drawn-rules.js draws the divider. It ships empty
        // and stays empty without JavaScript, which is why the heading carries a
        // plain hairline border underneath it either way — see page.css. It is
        // aria-hidden so a decoration cannot get into the heading's name.
        token.content =
          `<h1 id="${id}">` +
          `<span class="day-rule" aria-hidden="true"></span>` +
          `<span class="day-index">${escapeHtml(part.label)}</span>` +
          (part.when ? `<span class="day-date">${escapeHtml(part.when)}</span>` : '') +
          `</h1>\n`;
        out.push(token);
        seenPart = true;
        i += 2;
        continue;
      }

      // A heading that arrives before the first part — the devlog's "Before You
      // Read" is an h3 — has no parent to nest under. In the outline it is a
      // section in its own right; filing it three levels deep under nothing
      // would be a lie about the shape of the piece.
      const level = !seenPart ? 1 : token.tag === 'h2' ? 2 : 3;
      const id = uniqueId(explicit ?? slugify(text));
      token.attrSet('id', id);
      toc.push({ level, id, label: text });
      out.push(token);
      continue;
    }

    // --- figures: an image that is a paragraph of its own ---
    if (token.type === 'paragraph_open') {
      const sole = soleImage(tokens[i + 1], slug);
      if (sole) {
        token.type = 'html_block';
        token.tag = '';
        token.nesting = 0;
        token.content = `${figureMarkup(ctx, sole.image, sole.attrs)}\n`;
        out.push(token);
        i += 2;
        continue;
      }

      // The first paragraph of the article is the standfirst.
      ledeCandidate = true;
      if (!ledeDone) {
        token.attrJoin('class', 'lede');
        ledeDone = true;
        ledeUsed = true;
      }
    }

    // An image inside running text would be emitted as a bare <img> with an
    // unresolved path. Figures are blocks here; say so rather than ship that.
    if (token.type === 'inline' && token.children?.some((child) => child.type === 'image')) {
      throw new Error(`${slug}: an image has to be a paragraph of its own: "${token.content.slice(0, 80)}"`);
    }

    out.push(token);
  }

  return { html: md.renderer.render(out, md.options, {}), tokens, toc, ctx, ledeCandidate, ledeUsed };
}

/** One rendered piece of an article's body, for the block editor. */
export interface RenderedFragment {
  /** Exactly what the page would have at this point inside `.prose`. */
  readonly html: string;
  /** Files in the article's media/ this piece uses. */
  readonly referenced: readonly string[];
  readonly remotes: readonly string[];
  readonly ledeCandidate: boolean;
  readonly ledeUsed: boolean;
}

/**
 * A piece of an article's body, rendered by the same code as the page, for the
 * block editor (tools/writing/write/). `lede` says whether the standfirst
 * falls in this piece. Throws whatever the build would throw for it.
 */
export function renderFragment(article: ArticleRef, markdown: string, options: { readonly lede: boolean }): RenderedFragment {
  const body = renderBody(article, markdown, { lede: options.lede });
  return {
    html: body.html,
    referenced: [...body.ctx.referenced],
    remotes: body.ctx.remotes,
    ledeCandidate: body.ledeCandidate,
    ledeUsed: body.ledeUsed,
  };
}

/**
 * Everything inside the page's `<style>`: page.css, the link underline, the
 * band's plates when there is a band, and the torn edges. Exported for the
 * block editor, which draws its blocks with exactly this.
 */
export function pageStyles(plates?: { readonly light: string; readonly dark: string }): string {
  const band = plates ? `\n${bannerCss(plates.light, plates.dark)}\n` : '';
  return `${css.trimEnd()}\n\n${linkRuleCss}\n${band}\n${tornEdgeCss}`;
}

/** The drawn figures an article can ask for by name, for the editor's picker. */
export function drawnFigures(): ReadonlyArray<{ readonly name: string; readonly label: string; readonly width: number }> {
  return Object.values(DRAWN).map((fig) => ({ name: fig.name, label: fig.label, width: fig.width }));
}

/** One article to one page. Synchronous and deterministic; checks nothing remote. */
export function renderArticle(article: Article): Rendered {
  const { meta, slug } = article;
  const { html: bodyHtml, tokens, toc, ctx } = renderBody(article, article.body);

  // ----------------------------------------------------------------- masthead ---

  const wordCount = countWords(tokens);
  const readingMinutes = Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
  const dateRange = formatDateRange(meta.date);
  const canonical = meta.canonical ?? pageUrl(slug);
  const media = (ref: string) => {
    const file = mediaRef(article, ref);
    ctx.referenced.add(file);
    return mediaUrl(slug, file);
  };
  const image = meta.image ? `${SITE_ORIGIN}${media(meta.image)}` : undefined;
  const banner = meta.banner
    ? {
        art: media(meta.banner.art),
        plateLight: media(meta.banner.plateLight),
        plateDark: media(meta.banner.plateDark),
        options: bannerOptions(meta.banner.settings),
      }
    : undefined;

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

  const award = meta.award;
  const awardHtml = award
    ? escapeHtml(award.text) +
      (award.event
        ? `<span class="sep">·</span>${award.url ? `<a href="${escapeHtml(award.url)}">${escapeHtml(award.event)}</a>` : escapeHtml(award.event)}`
        : '')
    : '';
  const awardRow = award
    ? `
            <dt>Award</dt>
            <dd>${award.url && !award.event ? `<a href="${escapeHtml(award.url)}">${awardHtml}</a>` : awardHtml}</dd>`
    : '';
  const brief = `${award ? `${escapeHtml(award.text)}<span class="sep">·</span>` : ''}${readingMinutes} min`;

  const elsewhere = [{ label: 'imtani.dev', url: '/' }, ...meta.elsewhere]
    .map(
      (link) =>
        `            <li><a href="${escapeHtml(link.url)}" target="_blank" rel="noopener">${escapeHtml(link.label)}<span class="vh"> (opens in a new tab)</span></a></li>`,
    )
    .join('\n');

  const colophon = [{ label: 'imtani.dev', url: '/' }, ...meta.colophon]
    .map((link) => `<a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a>`)
    .join(' <span class="sep">·</span> ');

  const credits = [...ctx.credits.values()]
    .map((credit) => `\n        <!--${credit.note}-->\n        <p>${credit.html}</p>`)
    .join('');

  const source = relative(SITE_ROOT, join(article.dir, 'article.md')).replace(/\\/g, '/');

  const structured: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    description: meta.description,
    url: canonical,
    mainEntityOfPage: canonical,
    datePublished: meta.published,
    dateModified: meta.updated,
    ...(image ? { image } : {}),
    // Both are the Person node on the home page, by @id; the name and url are
    // repeated so a reader of this page's graph alone still knows who and where.
    author: { '@type': 'Person', '@id': `${SITE_ORIGIN}/#person`, name: meta.author, url: `${SITE_ORIGIN}/` },
    publisher: { '@id': `${SITE_ORIGIN}/#person`, name: SITE_OWNER, url: `${SITE_ORIGIN}/` },
    inLanguage: 'en',
    ...(meta.keywords.length ? { keywords: meta.keywords } : {}),
    ...(meta.about
      ? { about: { '@type': meta.about.type, name: meta.about.name, ...(meta.about.url ? { url: meta.about.url } : {}) } }
      : {}),
    ...(award ? { award: award.event ? `${award.text}, ${award.event}` : award.text } : {}),
  };

  const html = `<!doctype html>
<!--
  Generated by tools/writing/build.ts from ${source.startsWith('..') ? `the private repo's articles/drafts/${slug}/article.md` : source}.
  Do not edit by hand: change the article and run \`npm run writing\`, or change
  tools/writing/page.css for the styling.
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)} — ${escapeHtml(meta.author)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <meta name="author" content="${escapeHtml(meta.author)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <!--
      The favicon is deferred until the identity exists, so there is no icon to
      point at and /favicon.ico 404s on every load. An empty data URL is the
      one way to say "there is no icon" that costs no request; delete this line
      the day there is a real one.
    -->
    <link rel="icon" href="data:," />
    <!--
      The data-theme-color attribute is how theme.js finds these when the
      reader has picked a theme by hand: the media queries here are the
      machine's answer, and a forced-light page under dark browser chrome is
      the same mismatch this page fixed everywhere else.
    -->
    <meta name="theme-color" content="#111316" media="(prefers-color-scheme: dark)" data-theme-color="dark" />
    <meta name="theme-color" content="#faf6ee" media="(prefers-color-scheme: light)" data-theme-color="light" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
${image ? `    <meta property="og:image" content="${escapeHtml(image)}" />\n` : ''}    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />
    <!--
      The author is a reference to the Person node declared on the home page,
      not a second description of him. One @id across the site is what lets a
      search engine treat the article and the identity as the same graph
      instead of two pages that happen to share a name.
    -->
    <script type="application/ld+json">
${JSON.stringify(structured, null, 2)
  // `</script` inside a string would end the tag; JSON allows the escape.
  .replace(/<\//g, '<\\/')
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}
    </script>
    <!--
      The only script on this page allowed to block, and it blocks because the
      alternative is a flash of the wrong page: the attribute has to be on the
      element before the first paint, and a deferred script runs after it. Four
      lines, read once, in the head where you can see what is stopping the
      parser. Everything else about the theme is in theme.js, after the body.

      remote-boot.js shares the tag for the same reason and is shorter still:
      one class saying the remote is going to take the rail and the contents
      below the gutters, set before the first paint so a narrow page never draws them above the
      article and then pulls them out from under the reader. See that file.
    -->
    <script>
${themeBoot.trimEnd()}

${remoteBoot.trimEnd()}
    </script>
    <style>
${pageStyles(banner ? { light: banner.plateLight, dark: banner.plateDark } : undefined)}
    </style>
  </head>
  <body>
    <a class="skip" href="#article">Skip to the ${escapeHtml(meta.kind.toLowerCase())}</a>
    <div class="page">
      <header class="masthead">${
        banner
          ? `
        <!--
          The band. An empty div because banner.js owns everything inside it: it
          appends one canvas and sizes it to this box. With no JavaScript the
          box keeps the baked plate page.css gives it as a background, which is
          the same picture at the same offset — see banner-plate.ts. It carries
          no text at any point, so it is aria-hidden and out of the tab order by
          construction.
        -->
        <div class="band" aria-hidden="true"></div>`
          : ''
      }
        <!--
          The wrapper is what the rule under it can be positioned from: at the
          wide breakpoint page.css pads this block down to --head-rule so the
          slip's rule and the rule under Contents are one line across the
          gutter. Below that breakpoint it is an ordinary div doing nothing.
        -->
        <div class="masthead-id">
          <h1 class="title">${escapeHtml(meta.title)}</h1>
${meta.deck ? `          <p class="tagline">${escapeHtml(meta.deck)}</p>\n` : ''}          <p class="byline">by ${escapeHtml(meta.author)}${meta.handle ? ` <span class="handle">(${escapeHtml(meta.handle)})</span>` : ''}</p>
        </div>
        <!--
          The slip: everything the masthead states rather than says, in one
          two-column object instead of three paragraphs each with their own
          size, colour and leading. The term column is the same voice as the
          rail's 'Contents' label, which is what makes the two ends of the page
          read as one design.

          The empty span is where drawn-rules.js draws the masthead rule, the
          same way the day rules are drawn. It ships empty and stays empty if
          that script never runs, and the block keeps the plain hairline border
          underneath it either way — see page.css. It is aria-hidden because it
          is a line, and it stays a direct child of the ruled block because that
          is the box drawn-rules.js measures the line's span from.

          On a phone, with the remote running, the slip is one line: the brief
          below. Agreed with Tani: between the byline and the first sentence
          there is the prize and the length and nothing else. The full record
          is not deleted, it is moved — remote.js puts the dl at the top of the
          sheet — so the brief repeats two of its facts but never at the same
          time as them: while the sheet is shut the dl is inside a closed
          dialog, and while it is open the page the brief is on is inert. A
          screen reader meets one copy at a time. 'min' rather than 'about …
          minutes' because the long form does not fit one line of a phone's
          column at this size, and one line is the point. The brief ships
          display:none and only page.css's phone rule under the boot class
          shows it, so a laptop and a phone without JavaScript get the slip
          exactly as it was.
        -->
        <div class="slip">
          <span class="award-rule" aria-hidden="true"></span>
          <dl class="slip-record">${awardRow}
            <dt>${escapeHtml(meta.kind)}</dt>
            <dd>${escapeHtml(dateRange)}<span class="sep">·</span>${wordCount.toLocaleString('en-US')} words<span class="sep">·</span>about ${readingMinutes} ${readingMinutes === 1 ? 'minute' : 'minutes'}</dd>
          </dl>
          <p class="slip-brief">${brief}</p>
        </div>
      </header>

      <!--
        The left rail. The right gutter has the contents; a centred column pays
        for that gutter twice, and this is what the left one is for.

        Two groups because the row this replaced mixed four kinds of thing and
        said so with nothing: 'elsewhere' leaves the site, 'here' acts on this
        page. The labels are the distinction.

        Both controls ship hidden and their own script reveals them by setting
        'hidden' on the LI, because both are only true when that script is
        running. With JavaScript off, or under reduced motion, nothing starts by
        itself and every clip already has its own controls — a button offering
        to stop motion that is not happening would be the page lying about
        itself. The same goes for the theme: with no script there is nothing
        that can act on the button, and prefers-color-scheme goes on working
        exactly as it did before there was one. Nothing else in the rail depends
        on a script.

        Below the gutters none of this is here. remote.js moves the two groups
        and the contents into the sheet the remote opens — the same nodes, not
        copies, so there is one of everything for a screen reader and for the
        scripts that already drive the controls. At the wide breakpoint the rail
        is sticky, like the contents, so the same two groups stay to hand there.
      -->
      <!--
        The remote: a floating button that opens the page's options, wherever
        the gutters are gone — phones first, then laptops. Tani's words for it:
        "It only holds the menu for now, hides when you are scrolling. It's like
        a remote navbar." And later: "We can give smaller laptop screens the menu
        as well, the band isn't accessible at all times." Both elements ship
        inert — the button hidden, the dialog closed and empty — and remote.js is
        what brings them to life, so with no script the page is the page it was
        and the rail and contents stay in the flow below, where a reader can
        reach them. It sits here, where the rail starts, so that it takes the
        rail's place in the tab order too.

        The face is a placeholder; see REMOTE_FACE in build.ts. The accessible
        name is the hidden word beside it and does not depend on the face.
      -->
      <button class="remote" type="button" hidden data-remote aria-haspopup="dialog" aria-expanded="false" aria-controls="remote-sheet">
        <span class="remote-face" aria-hidden="true">${REMOTE_FACE}</span><span class="vh">Menu</span>
      </button>
      <dialog class="sheet" id="remote-sheet" aria-label="Menu">
        <div class="sheet-head">
          <button class="sheet-close" type="button" data-sheet-close>Close</button>
        </div>
        <div class="sheet-body" data-sheet-body></div>
      </dialog>
      <div class="rail">
        <nav class="rail-group" aria-labelledby="rail-elsewhere">
          <h2 class="rail-h" id="rail-elsewhere">Elsewhere</h2>
          <ul>
${elsewhere}
          </ul>
        </nav>
        <div class="rail-group">
          <h2 class="rail-h" id="rail-here">Here</h2>
          <ul aria-labelledby="rail-here">
            <li hidden>
              <button class="motion-button" type="button" data-motion-toggle>Pause the motion</button>
            </li>
            <li hidden>
              <button class="theme-button" type="button" data-theme-toggle>Theme: system</button>
            </li>
          </ul>
        </div>
      </div>

      <div class="layout">${
        meta.toc
          ? `
        <!--
          The empty span is the rail's half of the head rule, drawn by
          drawn-rules.js from the same seed and span as the masthead's so the two
          read as one line across the gutter. It ships empty, stays empty without
          JavaScript, and the label keeps its plain hairline border either way —
          see page.css. It is aria-hidden because it is a line, and it sits after
          the text so it cannot get into the heading's accessible name.
        -->
        <nav class="toc" aria-labelledby="contents">
          <h2 class="toc-h" id="contents">Contents<span class="toc-rule" aria-hidden="true"></span></h2>
${tocHtml}
        </nav>
`
          : ''
      }
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

      <!--
        Two links and nothing else. There used to be a paragraph above them
        about where the article was written, where it was first published and
        that the GIFs are video now — process trivia about our own migration,
        addressed to nobody. A reader who has just finished twenty-seven
        minutes wants a way out of the bottom of the page, which is what these
        are; the masthead's copies of them are four thousand words away.
      -->
      <footer class="colophon">
        <p>${colophon}</p>${credits}
      </footer>
    </div>
    <script>
${clipScript.trimEnd()}
    </script>
    <script>
${themeScript.trimEnd()}
    </script>
    <script>
${tocScript.trimEnd()}
    </script>
    <!--
      After the three scripts that own what it moves, though it does not depend
      on that: moving a node keeps its listeners, so the theme and motion
      buttons and the contents' place-marker work the same from inside the sheet.
    -->
    <script>
${remoteScript.trimEnd()}
    </script>
    <script>
${codeScript.trimEnd()}
    </script>
    <!--
      One script, two files: the generator and the two things it draws. They are
      wrapped in a single function rather than left at top level so that hand.js
      reaches drawn-rules.js without putting anything on the global object.
    -->
    <script>
(function () {
${handScript.trimEnd()}

${drawnRulesScript.trimEnd()}
})();
    </script>${
      banner
        ? `
    <!--
      The band, last: it is the only script on the page that paints something
      the reader can already see without it. The plate is behind the masthead
      from the first paint, and this replaces it with the identical first frame
      and then makes it move.
    -->
    <script>
(function () {
${bannerScript.trimEnd()}

${bannerBootScript
  .trimEnd()
  .replace("art: '__BANNER_ART__',", `art: '${banner.art}',`)
  .replace(/^__BANNER_OPTIONS__\n/m, banner.options ? `${banner.options}\n` : '')}
})();
    </script>`
        : ''
    }
  </body>
</html>
`;

  return {
    html,
    remotes: ctx.remotes,
    referenced: ctx.referenced,
    stats: { words: wordCount, headings: toc.length, figures: { ...figureCounts }, fences: fenceCount },
  };
}

// ---------------------------------------------------------------------- cli ---

/**
 * Files in an article's media/ that the page does not use. They would still be
 * deployed — the whole folder is served — so on a published article that is an
 * error; on a draft, which is allowed to be untidy, a warning.
 */
function unreferenced(article: Article, referenced: ReadonlySet<string>): string[] {
  const dir = join(article.dir, MEDIA_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !name.startsWith('.') && !referenced.has(name));
}

async function main(argv: readonly string[]): Promise<void> {
  const drafts = argv.includes('--drafts') || process.env['WRITING_DRAFTS'] === '1';
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt === -1 ? undefined : argv[onlyAt + 1];

  const { articles, warnings } = discover({ drafts });
  for (const warning of warnings) process.stderr.write(`writing: ${warning}\n`);
  const chosen = only ? articles.filter((a) => a.slug === only) : articles;
  if (only && chosen.length === 0) throw new Error(`no article "${only}"${drafts ? '' : ' (drafts not included)'}`);

  mkdirSync(OUT_DIR, { recursive: true });
  // writing/ is generated and nothing else lives there, so a page for an
  // article that has gone — or a draft from the last `npm run dev` — is removed
  // rather than left for Vite to find. Not on `--only`, which is one page.
  if (!only) {
    const keep = new Set(articles.map((a) => `${a.slug}.html`));
    for (const name of readdirSync(OUT_DIR)) {
      if (name.endsWith('.html') && !keep.has(name)) rmSync(join(OUT_DIR, name));
    }
  }

  for (const article of chosen) {
    const rendered = renderArticle(article);
    await checkRemoteEmbeds(rendered.remotes);

    const stray = unreferenced(article, rendered.referenced);
    if (stray.length) {
      const message =
        `${article.slug}: media/ holds ${stray.length} file(s) the article does not use, ` +
        `and they would be deployed: ${stray.join(', ')}`;
      if (article.source === 'published') throw new Error(message);
      process.stderr.write(`writing: ${message}\n`);
    }

    writeFileSync(join(OUT_DIR, `${article.slug}.html`), rendered.html, 'utf8');
    const { words, headings, figures, fences } = rendered.stats;
    process.stdout.write(
      `writing: ${article.source === 'drafts' ? 'DRAFT ' : ''}writing/${article.slug}.html — ` +
        `${words.toLocaleString('en-US')} words, ${headings} headings, ` +
        `${rendered.referenced.size} local media files, ` +
        `${figures.full + figures.inset} mounted figures ` +
        `(${figures.full} filling the slot, ${figures.inset} inset), ` +
        `${fences} code blocks\n`,
    );
  }
}

// `import.meta.url === 'file://' + argv[1]` is one slash out on Windows, so
// the comparison is made on real paths rather than on URL spelling.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
