/**
 * The Rise&Shine devlog's embedded media, named.
 *
 * The Notion export calls twenty-two of its images `Untitled 7.png` and the
 * rest things like `1be2c78e-b495-4ebe-a4c6-29228a590eff.png`. None of that may
 * reach a URL, so every file gets a hand-written slug here. This table is the
 * single point of agreement between `media.ts`, which transcodes the files, and
 * `build.ts`, which writes the `<img>` and `<video>` tags — if a slug only
 * existed in one of them the page would 404 its own pictures.
 *
 * `build.ts` fails the build on any embed missing from `SLUGS`, so adding an
 * image to the export without naming it here is a loud error rather than a
 * broken link.
 */

/** The export directory, as a path relative to the site root. */
export const SOURCE_DIR_REL = '../rise-and-shine-devlog';

export const SOURCE_MARKDOWN = 'Rise&Shine Devlog 5aed9b9b966a49abaf401e560ceccd6a.md';

/** Where transcoded media lands. Under `public/`, so Vite copies it verbatim. */
export const OUT_DIR_REL = 'public/writing/rise-and-shine';

/** The public path the page references its media by. */
export const PUBLIC_BASE = '/writing/rise-and-shine';

/** Written by `media.ts`, read by `build.ts`. Committed. */
export const MEDIA_MANIFEST_REL = 'tools/devlog/media.json';

/**
 * The reading column, in CSS pixels. Mirrors `--measure: 53.75rem` in
 * `page.css` at the default root size.
 */
export const MEASURE_PX = 860;

/**
 * `.mount`'s padding at its clamp's ceiling — `clamp(1.25rem, 4vw, 2rem)` — and
 * its hairline, both in CSS pixels, both from `page.css`.
 */
export const MOUNT_PAD_PX = 32;
export const MOUNT_BORDER_PX = 1;

/**
 * THE SLOT: the mount's inner width, and now the only width a figure is ever
 * offered.
 *
 * This used to be a threshold. A figure wider than it went flush and took the
 * whole column; a narrower one was mounted at its own size. The rule was the
 * source capture's own resolution — invisible to a reader, who therefore met a
 * page where some pictures reached the column edges and some did not with
 * nothing on the page to explain which. Tani read that as no convention at all,
 * and he was right: a rule nobody can see is not one.
 *
 * So there is one presentation now. Every figure is mounted, every mount is the
 * column wide, and the picture sits centred on it at whatever size it honestly
 * is. That is also the scrapbook answer — every photograph is pasted onto the
 * page the same way — and it turns the differences between the pictures into
 * differences between the pictures rather than into an inconsistent layout.
 *
 * Derived rather than written down, so that changing the mount's padding in
 * `page.css` and here cannot leave this pointing at the old hole. It has been
 * 634, 574, 674 and is now 794, once per change to the column.
 */
export const MOUNT_INNER_PX = MEASURE_PX - 2 * (MOUNT_PAD_PX + MOUNT_BORDER_PX);

/**
 * The tallest a figure is allowed to render, in CSS pixels.
 *
 * Several of the clips are near-square, and at the slot a square figure is 794px
 * tall — taller than two thirds of most laptop viewports, so it arrives as an
 * event rather than as an illustration and the reader loses the thread of the
 * paragraph it belongs to. His words: *"it feels a little too big against the
 * text."*
 *
 * 544 is 34rem, and it is chosen by looking rather than derived: it is about two
 * thirds of the ~800px content viewport a 1440x900 laptop has, so the tallest
 * figure on the page plus its caption still leaves prose visible above and
 * below it. It bites on four figures — the shader editor, the cartesian plane,
 * the mind map and the GeeksforGeeks diagram — and every one of them was over
 * 650px before. It bit on a fifth, the player script, until that screenshot
 * became a code block.
 *
 * The cap acts on the WIDTH, not on the height, which is the whole reason there
 * is no `object-fit` anywhere near it: a figure that would be too tall is made
 * narrower until it fits, so it is never cropped, never squashed, and never
 * letterboxed inside a box bigger than itself. It simply sits smaller on its
 * mount, which is exactly what the mount is for.
 */
export const FIG_MAX_H_PX = 544;

/**
 * Below this ratio a downscale is worth what it costs; above it, it is not.
 *
 * A picture rendered between about 0.80 and 1.00 of its own size takes all the
 * softening of a resample and none of the size change — the reader pays for the
 * blur and gets nothing back. `figureWidth` and `encodeWidth` between them
 * guarantee that no figure on this page lands in that band.
 */
export const SHALLOW_FLOOR = 0.79;

/**
 * The width a figure renders at, given the file's own pixel size.
 *
 * The slot, unless the file is smaller than the slot, or unless filling the slot
 * would make it taller than the cap. This is the only place the answer is
 * computed: `build.ts` writes it into `--fig-w` and `media.ts` transcodes
 * against it, so the bytes on disk and the pixels on screen cannot drift apart.
 */
export function figureWidth(width: number, height: number): number {
  const byHeight = Math.round((FIG_MAX_H_PX * width) / height);
  return Math.min(width, MOUNT_INNER_PX, byHeight);
}

/**
 * The same answer for a file we do not host and therefore cannot re-encode.
 *
 * `encodeWidth` keeps every local figure out of the shallow band by transcoding
 * it to a width that makes the render exact. The remote embed has no
 * such lever — re-hosting somebody else's GIF to sharpen it is not a trade we
 * get to make — so the only thing left is to render the picture smaller until
 * the resample is worth what it costs.
 *
 * Inert at today's numbers: the one remote embed left, a 480px Giphy reaction,
 * is narrower than the slot. (The GeeksforGeeks diagram this was written for is
 * drawn in figures.ts now.) It is here because the next remote embed could land
 * in the band, and a picture quietly going soft is not a failure anything would
 * catch.
 */
export function remoteWidth(width: number, height: number): number {
  const fit = figureWidth(width, height);
  if (fit < width && fit > width * SHALLOW_FLOOR) return Math.round(width * 0.75);
  return fit;
}

/**
 * Video is capped below the slot's 2x. These are screen recordings encoded at
 * CRF 30, where resolution stopped being the limiting factor a long way before
 * 1588px, and the fifteen clips are most of the page's payload — 1280 renders
 * at 1.61x on the slot and 0.62 is nowhere near the shallow band, so the extra
 * three hundred pixels would buy a difference nobody can see at a cost the
 * whole page pays.
 */
export const VIDEO_MAX_PX = 1280;

/**
 * The width to transcode a source at, so that the render is either exactly 1:1
 * or a downscale deep enough to be worth its own softness.
 *
 * Three cases, and the middle one is the whole point:
 *
 *   at least twice the render width -> exactly twice it. A 2x file for a retina
 *     screen, and a clean 0.50 on a 1x one.
 *   comfortably above it            -> left at its own size. Anything from 0.50
 *     to 0.79 is a downscale that pays for itself; throwing away those pixels
 *     would cost a retina reader detail for nothing.
 *   just above it                   -> brought down to it exactly. This is the
 *     band. Lanczos once, here, beats the browser's resampler every time, and
 *     afterwards the browser is not resampling at all.
 *
 * Nothing is ever enlarged: `fit` is never wider than the source.
 */
export function encodeWidth(width: number, height: number, video: boolean): number {
  const rendered = figureWidth(width, height);
  const ceiling = video ? Math.min(VIDEO_MAX_PX, 2 * rendered) : 2 * rendered;

  if (width >= ceiling) return ceiling;
  if (rendered <= width * SHALLOW_FLOOR) return width;
  return rendered;
}

/**
 * Source filename in the export -> published slug. Document order.
 *
 * THE `-2` SUFFIX IS A CACHE INSTRUCTION, NOT A NAME. `public/_headers` serves
 * everything under `/writing/rise-and-shine/` with `immutable` for a year, and
 * these filenames are not content-hashed, so a file that is re-encoded under
 * its old slug hands returning readers the old bytes until 2027. The rule
 * written into `_headers` is that re-encoding means renaming, and this table is
 * where that is done: the suffix is an edition number, bumped on the nine files
 * whose pixels changed when every figure became mounted and the transcode
 * targets moved with it. Nine of thirty-seven; the other twenty-eight are byte
 * for byte what they were and keep both their names and their caches.
 *
 * FOUR EMBEDS ARE NOT HERE BECAUSE THEY ARE DRAWN. `Untitled 1.png` (the
 * interpolation plot), the `ccb28002-….png` coordinate grid, `Untitled 7.png`
 * (inheritance) and the `1be2c78e-….png` composition slide were borrowed
 * diagrams, and figures.ts draws their replacements as inline SVG. Naming them
 * here as well would have media.ts transcoding pictures nothing shows; build.ts
 * refuses a source that is in both tables.
 */
export const SLUGS: Readonly<Record<string, string>> = {
  // Day 1
  // 918 -> 794: re-cut to the slot, where it used to be resampled to 0.937 by
  // the browser. Every `-2` below is that same story at a different width.
  'Untitled.png': 'kenney-pixel-platformer-pack-2',
  'Recording_2024-06-24_at_03.27.19.gif': 'jittery-camera',
  'Recording_2024-06-24_at_03.31.14.gif': 'smoother-camera',
  'Recording_2024-06-24_at_05.56.20.gif': 'placing-tiles-by-hand',
  'Recording_2024-06-24_at_06.07.49.gif': 'auto-tiling',
  'Recording_2024-06-24_at_05.46.16.gif': 'parallax-background',
  // Day 2
  'Untitled 2.png': 'a-very-stationary-cloud',
  'Untitled 3.png': 'godot-visual-shader-editor',
  'Untitled 4.png': 'multiplying-time-by-wave-speed',
  'Recording_2024-06-24_at_14.35.12.gif': 'working-sin-function-2',
  '2efcf48a-2a08-4732-a6a7-1f45c3c76a65.png': 'vertex-node',
  'Untitled 5.png': 'making-a-new-vector2-2',
  'Recording_2024-06-30_at_06.06.45.gif': 'slightly-not-stationary-cloud',
  'Untitled 6.png': 'wave-intensity-parameter',
  'Recording_2024-06-30_at_06.16.47.gif': 'cloud-having-violent-seizures',
  'Recording_2024-06-30_at_06.25.24.gif': 'cloud-waving-gently',
  // Day 3
  // The Real Python title image and the ECS diagram were dropped on 22 Oct 2026:
  // one was someone else's illustration, the other a third explanation of the
  // same idea sitting next to Tani's own component tree.
  'Untitled 9.png': 'player-with-components',
  // `Untitled 10.png` was a screenshot of the player script, and it is not here
  // because it is a code block now — see CODE_SCREENSHOT in build.ts. Naming a
  // file here is what makes `media.ts` transcode it into `public/`, so a slug
  // for a picture nothing references would keep shipping 35KB nothing reads.
  'Recording_2024-07-03_at_08.51.27.gif': 'modular-player-moving',
  'Untitled 11.png': 'mind-map-for-items',
  'Untitled 12.png': 'item-scene-hierarchy',
  'Untitled 13.png': 'key-scene-2',
  // Day 4
  'Recording_2024-07-03_at_10.21.13.gif': 'checkpoint-animation',
  'Untitled 14.png': 'spikes-scene-2',
  'Recording_2024-07-03_at_10.34.07.gif': 'spikes-working-perfectly',
  'Recording_2024-07-03_at_10.50.12.gif': 'holding-throwing-hurt-respawn',
  // Day 9
  'Recording_2024-07-03_at_23.24.27.gif': 'newer-look-different-feel',
  'Untitled 15.png': 'neuron-activation',
  'Untitled 16.png': 'door-scene-2',
  'covefr.png': 'rise-and-shine-cover',
  // Day 10
  'Recording_2024-07-04_at_00.46.54.gif': 'lovely-blue-flame',
};

/**
 * Alt text the export did not supply, written from the surrounding prose.
 *
 * Notion writes the filename into the alt slot when a block has no caption, so
 * `Recording 2024-07-03 at 10.21.13.gif` is what a screen reader would
 * otherwise be told this clip contains.
 */
export const ALT_OVERRIDES: Readonly<Record<string, string>> = {
  'Recording_2024-07-03_at_10.21.13.gif':
    'The player walks into the checkpoint flag and it raises; a pink test hazard sits nearby and the key and diamond bob up and down on the wave shader.',
};

/**
 * The embeds that are not ours, named the same way the local ones are. One now:
 * the other two — a sine-wave GIF and a GeeksforGeeks coordinate-grid GIF — are
 * drawn in figures.ts instead, so they are keyed there rather than here and
 * build.ts refuses a URL in both.
 *
 * They stay on their own hosts: re-hosting them here would be republishing work
 * that is not his, and the URL is the attribution. What they cannot do is stay
 * anonymous — without an intrinsic size the figure has no `--fig-w` to cap it
 * and a 480px reaction GIF gets blown up to 864px, and without a declared size
 * the browser reserves no box for it and the page shifts when it lands.
 *
 * So each one is measured once, here, and `build.ts` asserts that every remote
 * `src` in the export has an entry — an unrecognised remote URL is a build
 * error rather than an unsized image. `build.ts` also checks each `url` is
 * reachable and still an image, which is how the Steemit mirror the sine GIF
 * came through was caught: it answered 200 with a 67-byte JSON body saying
 * "not found", so nothing that watches status codes would ever have noticed.
 *
 * Keyed by the URL as the export writes it; `url` is what the page publishes.
 * They differed only for the Steemit mirror, and the field stays for the next
 * dead copy.
 */
export interface RemoteEmbed {
  /** What the page links. Differs from the key when the export's copy is dead. */
  readonly url: string;
  /** Intrinsic pixels, measured with ffprobe. */
  readonly width: number;
  readonly height: number;
  /** An animated GIF cannot be paused, so the page has to offer to stop it. */
  readonly animated: boolean;
  /** Only where the export's alt slot is unusable. */
  readonly alt?: string;
}

export const REMOTE_EMBEDS: Readonly<Record<string, RemoteEmbed>> = {
  'https://media1.giphy.com/media/3oEjI6hkw6nbYNQkz6/giphy.gif?cid=7941fdc60st08kq1i53t52pl71w5cozq3thsyow45u1mv6t2&ep=v1_gifs_search&rid=giphy.gif&ct=g':
    {
      url: 'https://media1.giphy.com/media/3oEjI6hkw6nbYNQkz6/giphy.gif?cid=7941fdc60st08kq1i53t52pl71w5cozq3thsyow45u1mv6t2&ep=v1_gifs_search&rid=giphy.gif&ct=g',
      width: 480,
      height: 269,
      animated: true,
    },
};

export function isRemote(src: string): boolean {
  return /^https?:\/\//.test(src);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
