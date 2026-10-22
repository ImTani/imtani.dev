/**
 * Bake an article's masthead band plates: the static screen a reader with no
 * JavaScript keeps.
 *
 *     npm run writing:banner -- <slug>
 *     node tools/writing/banner-plate.ts <slug>
 *
 * Run by hand, output committed, exactly like `media.ts`. It is not part of
 * `npm run build` because it writes bytes that only change when the art or
 * the screen settings do. Everything it needs is the article's own: the
 * `banner:` block of its front matter names the art and the two plate files
 * (all three in its media/ folder) and gives the settings. It finds the slug
 * among published articles first and then drafts.
 *
 * WHY IT EXISTS. With JavaScript off, `banner.js` never runs and the band
 * would be flat paper. This bakes the identical screen — it imports the pure
 * half of `banner.js` rather than reimplementing it, so the two cannot drift
 * — into one PNG per colour scheme, at the rest offset. Dropped in as a
 * `background-image` at natural size with `image-rendering: pixelated`, the
 * plate is pixel-identical to the first frame the module paints, at any
 * device pixel ratio, because a screen is only ever scaled by whole numbers.
 *
 * WHAT THE READER LOSES. The crawl, and nothing else. That is the correct
 * thing to lose: the crawl is the part that needs a clock.
 *
 * WHAT THE PLATE CANNOT DO. The fade is measured across the BAND, and a
 * plate does not know how wide the band will be. It is baked at
 * `--plate-width` and anchored right, so at wider bands the fade's foot
 * lands further right than the live render would put it. At the widths this
 * page actually uses the difference is a few cells of extra quiet on the
 * left, which is the harmless direction to be wrong in.
 *
 * ZERO DEPENDENCIES. PNG is inflate plus a per-row filter byte, and node has
 * inflate. The decoder handles the one shape the source art is (8-bit truecolour,
 * non-interlaced) plus its two near neighbours; the encoder writes an indexed
 * PNG, which is what a six-tone image should be and is about a twentieth of
 * the size of the truecolour equivalent.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Article, readArticle } from './articles.ts';
import { DRAFTS_DIR, MEDIA_DIR, PUBLISHED_DIR } from './config.ts';
import {
  BANNER_TOKENS,
  DEFAULTS,
  bGeometry,
  bPresenceRow,
  bReduceSource,
  bResolveRamp,
  bScreen,
  bOffset,
  bParseColor,
} from './banner.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The band the plate is baked for, and it is the masthead's real one: the
 * reading column, `--measure` wide, `--head-rule` tall. The live module reads
 * the size off the element, so these two only decide the plate — but the plate
 * has to be pixel-identical to the module's first frame, which means they have
 * to be the numbers page.css actually gives `.band`.
 *
 * 860 x 304 at cell 2 is a 430 x 152 plate, which the stylesheet blows back up
 * by exactly 2. Right-anchored, it is also correct at every NARROWER band,
 * because `rampSpace: 'art'` locks the fade to the picture rather than to the
 * band: a narrower band simply shows less of the plate's quiet left-hand end,
 * which is what the live render does too.
 */
const PLATE_WIDTH = 860;
const PLATE_HEIGHT = 304;

/**
 * What the plate is screened with: the article's banner settings over
 * banner.js's DEFAULTS, merged the way `createBannerScreen` merges them, so the
 * plate and the live band's first frame are made from the same numbers by
 * construction rather than by two lists kept in step. `wiggle` is among them
 * and matters here although it is a pointer setting: it is also GEOMETRY — the
 * live band crops that much off the picture's anchored edge to give the lean
 * somewhere to go (see WIGGLE ROOM in banner.js) — so the plate has to crop the
 * same or it stops being the live band's first frame.
 */
export interface PlateSettings {
  grain: number;
  levels: number;
  ramp: number;
  rampWidth: number;
  cell: number;
  artScale: number | 'cover';
  anchorX: number;
  focus: number;
  travel: number | null;
  direction: number;
  rampSpace: 'band' | 'art';
  feather: number;
  wiggle: number;
}

export function plateSettings(article: Article): PlateSettings {
  const given = article.meta.banner?.settings ?? {};
  const merged = { ...DEFAULTS, ...given } as typeof DEFAULTS;
  return {
    grain: merged.grain,
    levels: merged.levels,
    ramp: merged.ramp,
    rampWidth: merged.rampWidth,
    cell: merged.cell,
    artScale: merged.artScale,
    anchorX: merged.anchorX,
    focus: merged.focus,
    travel: merged.travel,
    direction: merged.direction,
    rampSpace: merged.rampSpace,
    feather: merged.feather,
    wiggle: merged.wiggle,
  };
}

// ------------------------------------------------------------------ png ---

type Raster = { data: Uint8ClampedArray; width: number; height: number };

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Paeth, verbatim from the spec. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a non-interlaced, 8-bit PNG in colour type 0, 2, 4 or 6 to RGBA.
 * Anything else throws rather than guessing — a silently mis-decoded source
 * would be a screen of the wrong picture, which is much worse than a crash.
 */
export function decodePng(bytes: Buffer): Raster {
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('banner-plate: not a PNG');
  let p = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let ctype = 0;
  const idat: Buffer[] = [];
  while (p < bytes.length) {
    const len = bytes.readUInt32BE(p);
    const type = bytes.toString('ascii', p + 4, p + 8);
    const body = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8]!;
      ctype = body[9]!;
      if (body[12] !== 0) throw new Error('banner-plate: interlaced PNG is not supported');
      if (depth !== 8) throw new Error(`banner-plate: only 8-bit PNG is supported, got ${depth}`);
      if (![0, 2, 4, 6].includes(ctype)) {
        throw new Error(`banner-plate: colour type ${ctype} is not supported`);
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }

  const channels = ctype === 0 ? 1 : ctype === 2 ? 3 : ctype === 4 ? 2 : 4;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(stride);
  const prior = new Uint8Array(stride);
  let q = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[q];
    q += 1;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[q + i]!;
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prior[i]!;
      const c = i >= channels ? prior[i - channels]! : 0;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`banner-plate: unknown row filter ${filter}`);
      line[i] = v & 0xff;
    }
    q += stride;
    const o = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const i = x * channels;
      if (channels === 1) {
        out[o + x * 4] = line[i]!;
        out[o + x * 4 + 1] = line[i]!;
        out[o + x * 4 + 2] = line[i]!;
        out[o + x * 4 + 3] = 255;
      } else if (channels === 2) {
        out[o + x * 4] = line[i]!;
        out[o + x * 4 + 1] = line[i]!;
        out[o + x * 4 + 2] = line[i]!;
        out[o + x * 4 + 3] = line[i + 1]!;
      } else if (channels === 3) {
        out[o + x * 4] = line[i]!;
        out[o + x * 4 + 1] = line[i + 1]!;
        out[o + x * 4 + 2] = line[i + 2]!;
        out[o + x * 4 + 3] = 255;
      } else {
        out[o + x * 4] = line[i]!;
        out[o + x * 4 + 1] = line[i + 1]!;
        out[o + x * 4 + 2] = line[i + 2]!;
        out[o + x * 4 + 3] = line[i + 3]!;
      }
    }
    prior.set(line);
  }
  return { data: out, width, height };
}

/**
 * Encode RGBA to an indexed PNG when it has 256 tones or fewer, which a
 * screened band always does, and to truecolour when it does not. Rows are
 * filtered with `up`, which is the right filter for a horizontally striped
 * screen and costs one pass.
 */
export function encodePng(r: Raster): Buffer {
  const { data, width, height } = r;
  const index = new Map<number, number>();
  const plte: number[] = [];
  const px = new Uint8Array(width * height);
  let indexed = true;
  for (let i = 0; i < width * height; i += 1) {
    const key = (data[i * 4]! << 16) | (data[i * 4 + 1]! << 8) | data[i * 4 + 2]!;
    let k = index.get(key);
    if (k === undefined) {
      if (index.size >= 256) {
        indexed = false;
        break;
      }
      k = index.size;
      index.set(key, k);
      plte.push(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
    }
    px[i] = k;
  }

  const channels = indexed ? 1 : 3;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  const prior = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    if (indexed) {
      line.set(px.subarray(y * width, y * width + width));
    } else {
      for (let x = 0; x < width; x += 1) {
        line[x * 3] = data[(y * width + x) * 4]!;
        line[x * 3 + 1] = data[(y * width + x) * 4 + 1]!;
        line[x * 3 + 2] = data[(y * width + x) * 4 + 2]!;
      }
    }
    const o = y * (stride + 1);
    raw[o] = 2; // up
    for (let i = 0; i < stride; i += 1) raw[o + 1 + i] = (line[i]! - prior[i]!) & 0xff;
    prior.set(line);
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = indexed ? 3 : 2;

  const parts: Uint8Array[] = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  if (indexed) parts.push(chunk('PLTE', Uint8Array.from(plte)));
  parts.push(chunk('IDAT', deflateSync(Buffer.from(raw), { level: 9 })));
  parts.push(chunk('IEND', new Uint8Array(0)));
  return Buffer.concat(parts.map((u) => Buffer.from(u)));
}

// ---------------------------------------------------------------- plate ---

/**
 * Read the six ramp tokens out of page.css for one scheme.
 *
 * page.css declares each of them four times — light `:root`, the
 * `prefers-color-scheme` block, the `[data-theme='dark']` block, and print —
 * in that order, and the two dark blocks are documented duplicates. This is
 * the same contract `paletteToken` in build.ts relies on and it is asserted
 * here for the same reason: a silent parse of the wrong block is a plate in
 * the wrong colours.
 */
export function readTokens(css: string, scheme: 'light' | 'dark'): number[][] {
  return BANNER_TOKENS.map((name) => {
    const found = [...css.matchAll(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, 'g'))].map(
      (m) => m[1] as string,
    );
    if (found.length !== 4) {
      throw new Error(
        `banner-plate: expected four declarations of ${name} in page.css, found ${found.length}.`,
      );
    }
    if (found[1] !== found[2]) {
      throw new Error(
        `banner-plate: the two dark declarations of ${name} disagree (${found[1]}, ${found[2]}).`,
      );
    }
    const hex = scheme === 'light' ? found[0]! : found[1]!;
    const rgb = bParseColor(hex);
    if (!rgb) throw new Error(`banner-plate: could not parse ${name}: ${hex}`);
    return rgb;
  });
}

/** Screen one band, at one progress, with one palette. Pure. */
export function plate(
  art: Raster,
  tones: number[][],
  opts: PlateSettings & { W: number; H: number; progress: number },
): Raster {
  const g = bGeometry({
    W: opts.W,
    H: opts.H,
    cell: opts.cell,
    AW: art.width,
    AH: art.height,
    artScale: opts.artScale,
    anchorX: opts.anchorX,
    travel: opts.travel,
    wiggle: opts.wiggle,
  });
  const pres = bPresenceRow(g, opts);
  const src = bReduceSource(art);
  const { pal, dark } = bResolveRamp(tones, opts.levels);
  const buf = new Uint8ClampedArray(g.gw * g.gh * 4);
  bScreen(
    buf, src, g, pres.row, pal, opts.grain, dark,
    0, bOffset(g, opts.focus, opts.direction, opts.progress),
  );

  // One pixel per cell. The CSS blows it up by a whole number, so the plate
  // is stored at the screen's own resolution and never at the band's.
  return { data: buf, width: g.gw, height: g.gh };
}

// ----------------------------------------------------------------- main ---

// `import.meta.url === 'file://' + argv[1]` is one slash out on Windows, so
// the comparison is made on real paths rather than on URL spelling.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const slug = process.argv[2];
  if (!slug) throw new Error('usage: node tools/writing/banner-plate.ts <slug>');
  const dir = [join(PUBLISHED_DIR, slug), join(DRAFTS_DIR, slug)].find((d) => existsSync(d));
  if (!dir) throw new Error(`no article "${slug}" in ${PUBLISHED_DIR} or ${DRAFTS_DIR}`);
  const article = readArticle(dir, dir.startsWith(PUBLISHED_DIR) ? 'published' : 'drafts');
  const banner = article.meta.banner;
  if (!banner) throw new Error(`${slug} has no banner: block in its front matter`);
  const media = (ref: string) => join(article.dir, MEDIA_DIR, ref.slice(MEDIA_DIR.length + 1));

  const artBytes = readFileSync(media(banner.art));
  const art = decodePng(artBytes);
  const css = readFileSync(join(here, 'page.css'), 'utf8').replace(/\r\n/g, '\n');
  const settings = plateSettings(article);

  const lines: string[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const tones = readTokens(css, scheme);
    const r = plate(art, tones, {
      ...settings,
      W: PLATE_WIDTH,
      H: PLATE_HEIGHT,
      progress: 0,
    });
    const png = encodePng(r);
    const out = scheme === 'light' ? banner.plateLight : banner.plateDark;
    writeFileSync(media(out), png);
    lines.push(`${out} — ${r.width}x${r.height} cells, ${png.length} bytes`);
  }

  process.stdout.write(
    `banner ${slug}: ${banner.art} — ${art.width}x${art.height}, ${artBytes.length} bytes\n` +
      `  ${lines.join('; ')}\n` +
      `  baked for a ${PLATE_WIDTH}x${PLATE_HEIGHT} band at cell ${settings.cell}px.\n` +
      `  CSS: background:url(...) right top/${PLATE_WIDTH}px ${PLATE_HEIGHT}px no-repeat;` +
      ` image-rendering: pixelated;\n` +
      '  The plates are served immutable: if these bytes changed, rename the files\n' +
      '  in the banner block rather than reusing the old names.\n',
  );
}
