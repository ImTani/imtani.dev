/**
 * How big a figure is: the sizing maths every article's media shares.
 *
 * `build.ts` writes each figure's `--fig-w` from `figureWidth`, and `media.ts`
 * transcodes each source against `encodeWidth`, which is computed from the
 * same function — so the bytes on disk and the box on the page cannot drift
 * apart. Nothing in here is about any one article. (It held the Rise&Shine
 * export's filename table until the article's Markdown became its own source
 * and started naming its media directly; see articles/README.md.)
 */

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

export function isRemote(src: string): boolean {
  return /^https?:\/\//.test(src);
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}
