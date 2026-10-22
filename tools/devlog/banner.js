/* Rise&Shine devlog — the screen behind the masthead.
 *
 * =====================================================================
 * WHAT THIS IS
 * =====================================================================
 *
 * An ordered-dither screen, quantised to the page's own earth palette,
 * laid over a picture that pans vertically as the reader scrolls.
 *
 * The one idea it exists to protect: THE SCREEN DOES NOT MOVE. The Bayer
 * lattice is anchored to the band, in viewport space, and stays there.
 * What moves is the picture underneath it. Each cell therefore re-resolves
 * — picks a different tone out of the palette — as the tone beneath it
 * changes, and the result reads as a crawl rather than a slide. If you
 * ever find this file translating an already-screened bitmap, the effect
 * has been replaced by the generic parallax it was chosen instead of.
 *
 * That is also why the picture is never pre-screened, never cached as a
 * screened bitmap, and never scaled after screening. A dither is a fixed
 * pixel grid; resampling one beats against the sampling lattice and bands.
 * The source is reduced to ONE INK VALUE PER CELL and screened fresh.
 *
 * Ink is not brightness. Since 22 October 2026 it is how far a pixel's
 * colour is from the picture's own background, measured in OKLab, and it is
 * counted in palette steps away from the page's paper in BOTH themes — so
 * the figure is what prints, on the light page and the dark one alike. The
 * reasoning and the arithmetic are at bInkField.
 *
 * =====================================================================
 * THE API
 * =====================================================================
 *
 *   var screen = createBannerScreen(options) -> controller
 *
 * OPTIONS — what the caller must provide
 *
 *   host      (required) Element. The band. The module appends one <canvas>
 *             to it and sizes that canvas to the host's content box. The
 *             CALLER owns the host's size, position and stacking; nothing
 *             here reads or writes layout on anything else. If the host
 *             computes to `position: static` it is set to `relative`, since
 *             an absolutely positioned canvas needs a containing block and
 *             a silently mispositioned band is worse than a mutation.
 *
 *   art       (required) A URL string, or an already-decoded
 *             HTMLImageElement / HTMLCanvasElement / ImageBitmap, or a raw
 *             { data, width, height } (RGBA, as from getImageData). A URL
 *             is fetched; `ready` resolves when it has been reduced.
 *
 * OPTIONS — the five the owner chose by looking, on 16 Aug 2026
 *
 *   grain      0.85   how far a Bayer cell may push a pixel, in palette steps
 *   levels     6      palette steps, sampled out of the six-tone token ramp
 *   ramp       0.67   where the fade sits, 0..1 (see rampSpace)
 *   rampWidth  0.88   how long the fade takes, in the same units
 *   cell       2      the screen's period, in CSS px
 *
 * OPTIONS — geometry
 *
 *   artScale   1      CSS px per source pixel. 1 = native, no resampling.
 *                     2 = integer double. 'cover' = fill the band's width,
 *                     whatever fraction that takes.
 *   anchorX    1      0 = art at the band's left edge, 1 = at its right.
 *   focus      0.35   which part of the art's surplus height sits in the
 *                     band at rest, 0 = the top rows, 1 = the bottom.
 *   travel     null   CSS px the picture pans across the whole scroll
 *                     range. `null` means "all of the surplus height",
 *                     which is the only value that shows the reader the
 *                     entire picture. See THE PAN RATE below. When the
 *                     travel is shorter than the surplus, `focus` decides
 *                     which part of the surplus it runs through.
 *   direction  -1     -1 means the picture LAGS the page: it drifts down
 *                     inside the band as the band rises, so its velocity in
 *                     the viewport is slower than the page's and it reads
 *                     as depth. +1 makes it outrun the page, which reads as
 *                     the band sliding off and is almost certainly wrong.
 *   rampSpace  'band' 'band' measures `ramp` and `rampWidth` across the
 *                     band, which is what the owner's numbers were chosen
 *                     against. 'art' measures them across the picture, so
 *                     the fade keeps its relationship to the picture's own
 *                     left edge at every band width. See THE FADE below.
 *   feather    4      cells over which the picture's hard left edge is
 *                     dissolved, for the case where the fade has not
 *                     already done it.
 *
 * OPTIONS — motion
 *
 *   follow     120    ms. The time constant the picture's DISPLAYED offset
 *                     follows its target with — the target being where the
 *                     scroll position and the pointer say it should be. See
 *                     THE FOLLOWER below. 0 snaps straight to the target.
 *   wiggle     6      CSS px. The most the pointer can move the picture, in
 *                     any direction — reached only when the pointer is one
 *                     picture-radius from the picture's centre, and fading
 *                     away either side of that. See THE POINTER below. It
 *                     is also GEOMETRY: the picture is cropped by this much
 *                     at its anchored edge to make the room (see bGeometry),
 *                     so change it and the no-JS plate must be re-baked.
 *                     0 turns the pointer off and crops nothing. Only ever
 *                     live under `(hover: hover) and (pointer: fine)`; a
 *                     finger has no resting position to lean toward.
 *   wiggleSign 1      +1 leans the picture TOWARD the pointer, -1 away.
 *   pivot      null   an Element whose TEXT the lean pivots on: the centre
 *                     of its words, with half their width as the pull's
 *                     radius. Measured outside the loop, on resize, on the
 *                     element resizing and when the fonts land. `null`
 *                     pivots on the picture's own visible centre instead.
 *   fps        null   an optional cap on the render clock. `null` renders
 *                     every animation frame while the picture is moving,
 *                     which is the shipped state; 12 restores the on-twos
 *                     clock this module was first built with. The POSITION
 *                     is continuous either way.
 *   progress   null   () => number in 0..1. `null` uses the band's own
 *                     scroll position: 0 when the page is at the top, 1
 *                     when the band's bottom edge has passed the viewport's
 *                     top edge. Nothing here calls getBoundingClientRect
 *                     inside the render loop.
 *   motion     null   true / false to force the crawl on or off, `null` to
 *                     follow `prefers-reduced-motion`. Under `reduce` the
 *                     band renders ONE static frame at rest, the follower
 *                     never starts and the pointer listener is never
 *                     attached — it is not a slowed crawl. (The scroll
 *                     listener is attached regardless, and returns at once;
 *                     see the art section for why.)
 *
 * OPTIONS — palette
 *
 *   tokens     the six custom properties the ramp is read from, in role
 *              order paper -> ink. Defaults to
 *              ['--paper','--rule','--rule-strong','--underline','--accent','--ink'].
 *              They are read off the document element with getComputedStyle,
 *              so both colour schemes and the [data-theme] override are
 *              followed for free, and page.css stays the only place the
 *              earth palette is decided. The ramp is asserted to be
 *              monotonic in luminance; if a token is retuned so that it is
 *              not, the ramp is sorted and `controller.warnings` says so.
 *
 * CONTROLLER
 *
 *   .ready         Promise, resolves once the art is decoded and the first
 *                  frame is on screen. Rejects if the art fails to load.
 *   .render(p)     paint once at progress p (default: the current progress),
 *                  with no pointer term, and leave the follower there
 *   .set(params)   change any option above except `host` and `art`; repaints
 *   .params        the live resolved parameters. Read them; change them with
 *                  `.set()`, which is what rebuilds the geometry.
 *   .geometry()    W, H, cell, cellDev, gw, gh, artScale, artLeftCss,
 *                  artWidthCss, surplusCss, travelCss, scrollBudgetCss,
 *                  panRate, rampFootCss, rampHeadCss, wiggleCss, cropCss,
 *                  pivotXCss, pivotYCss, pivotRCss, dark
 *   .palette()     the resolved ramp, lightest first, as [r,g,b] triples
 *   .envelope(o)   THE CONTRAST ANSWER. See below.
 *   .stats         { frames, lastFrameMs, meanFrameMs, worstFrameMs }
 *   .warnings      array of strings; empty is the expected state
 *   .destroy()     removes the canvas and every listener
 *
 * ASSUMPTIONS
 *
 *   - The host has a non-zero size when this is called, or gains one; a
 *     ResizeObserver rebuilds the geometry, debounced, and a zero-sized
 *     host simply paints nothing.
 *   - The art is at least as tall as the band once scaled. If it is not,
 *     there is no surplus, `travel` clamps to 0, and the band is static.
 *   - Canvas 2D is available. If it is not, nothing is appended and the
 *     no-JS fallback below is what the reader keeps.
 *
 * =====================================================================
 * THE CONTRAST ANSWER — .envelope()
 * =====================================================================
 *
 * This is motion behind type, so the worst case is not at rest; it is
 * somewhere in the travel, and it is not the same somewhere for every
 * column. `.envelope({ rows, steps, stepsX, fg })` sweeps EVERY OFFSET THE
 * PICTURE CAN REACH — the scroll travel widened by the wiggle vertically,
 * and ±wiggle horizontally, every combination of the two — and returns, FOR
 * EVERY GRID COLUMN, the worst tone that ever appears in that column within
 * `rows`, and the contrast of `fg` against it:
 *
 *   { columns: Float64Array,   // contrast of fg vs the worst tone, per cell
 *     tones: Uint8Array,       // that tone, rgb triples
 *     offsetsCss: [lo, hi],    // the vertical offsets it swept
 *     offsetsXCss: [lo, hi],   // ... and the horizontal ones
 *     worstUpTo(xCss),         // the worst contrast anywhere left of xCss
 *     worstBeyond(xCss) }      // ... and anywhere right of it
 *
 * `worstUpTo` is the number the masthead pass needs: with the type block
 * ending at x, the worst pixel any glyph can ever land on is that. It is
 * an envelope over every offset and every row in the band, so it is a
 * bound rather than a sample — no glyph position can beat it. The steps
 * default to a quarter of a cell apart on both axes.
 *
 * It stays a bound under the follower for a reason worth stating: the
 * displayed offset is clamped to exactly the range swept here (`bReach`),
 * and the follower is first-order, so it can never overshoot out of it
 * either. The clamp would hold without that; the two together mean there is
 * no frame — mid-ease, mid-flick, cursor at the window's edge — that the
 * envelope did not already look at.
 *
 * =====================================================================
 * THE PAN RATE — the constraint that actually bites
 * =====================================================================
 *
 * The band sits at the top of the page and is a few hundred pixels tall,
 * so it leaves the viewport after `bandTop + bandHeight` of scroll. That
 * is the entire budget. Showing the picture's whole surplus height inside
 * it means panning `surplus` px of picture across that budget, and the
 * rate is simply `surplus / budget`. `.geometry()` reports both, and the
 * harness that came with this file renders the filmstrip so the rate can
 * be judged rather than argued. Rates above roughly 0.6 read as a lurch on
 * a flick scroll; the fix is a smaller `travel`, which costs picture.
 *
 * =====================================================================
 * THE FOLLOWER — and why the clock is no longer on twos
 * =====================================================================
 *
 * This module first rendered on a 12fps clock with a continuous position,
 * on the reasoning in PRODUCT.md's Motion section: stepped motion reads as
 * drawn. On this element the owner overrode that on 22 October 2026 — "the
 * scroll animation on the frame isn't very smooth, can we tween it" — and
 * he was right about why. A picture panning at 0.39 of the scroll speed,
 * observed twelve times a second, moves 1000 * 0.39 / 12 / 2 = 16 cells
 * between frames under a 1000px/s flick. That is not a cell re-resolving on
 * twos; it is the whole picture hopping, which is exactly the slide-wearing-a-dither the
 * header above exists to rule out, arrived at through the clock instead of
 * through the position. So now: every animation frame while it moves, and
 * nothing at all once it has stopped.
 *
 * The displayed offset is eased toward its target by a first-order
 * exponential follower,
 *
 *     shown += (target - shown) * (1 - exp(-dt / follow))
 *
 * which is frame-rate independent (a 144Hz display and a 60Hz one trace the
 * same curve) and was chosen over a critically damped spring for three
 * reasons. It starts moving the instant the target does, so it reads as a
 * soft follow rather than as lag; a spring spends its first frames
 * accelerating, and on a background that is already moving slower than the
 * page that reads as the picture being late. It cannot overshoot — the
 * offset is always a weighted average of targets it has been given — so a
 * flick reversed mid-ease never carries the picture past where either end
 * of the scroll would put it, and the contrast envelope stays a bound. And
 * it has one state variable per axis rather than two, so "settled" is one
 * comparison per axis. Both axes share the time constant, so a pull that is
 * diagonal stays diagonal on the way there.
 *
 * `follow: 120` puts 63% of any change on screen in 120ms and 95% in 360ms.
 * Under a steady scroll the picture trails its target by 120ms of its own
 * motion, which is invisible: there is nothing in the band for that
 * position to be compared against except the scroll itself, and the band
 * moves with the page exactly. The loop stops once the gap is under
 * SETTLE (a tenth of a cell; see where it is defined for why not less) and
 * there is no pointer input, so a still page costs nothing.
 *
 * =====================================================================
 * THE POINTER — a lean toward it, pivoting on the title
 * =====================================================================
 *
 * The owner's brief, 22 October 2026: "ensure that the image has a little
 * wiggle room, and calculate the distance from the image's central pivot,
 * the farther the cursor, the subtler the movement, this way it's a fun
 * gimmick and not very prominent." Then, having tried it: "shift the pivot
 * to the center of the title rather than the center of just the banner." So
 * the picture leans toward the pointer (`wiggleSign: 1`; -1 makes it shy
 * away instead), along the line from the TITLE's centre to the pointer, by
 * an amount that depends only on how far from that centre the pointer is:
 *
 *     displacement = wiggle * (v / r) * exp((1 - |v|² / r²) / 2)
 *
 * with v the pivot-to-pointer vector and r the pull's radius. bPull has the
 * reasoning for the curve; in short it is zero at the pivot and passes
 * through it smoothly, peaks at exactly `wiggle` one radius out, and is gone
 * by three radii. The pivot is the `pivot` option — the centre of that
 * element's text, not of its column-wide box — and falls back to the
 * picture's own presence-weighted centre (bPivot) when there is none.
 *
 * THE RADIUS IS HALF THE TITLE'S WIDTH, AND ROUND. The obvious alternative
 * is an ellipse fitted to the title's box, and it is wrong for this title:
 * "Rise&Shine Devlog" is 459 x 52px, nearly 9:1, so the ellipse's vertical
 * radius is 26px. The peak would sit on the title's own top and bottom edge,
 * the pull would be 5% by 80px above or below it, and the whole effect would
 * live in a strip one line of type tall — the picture itself, 150px lower
 * and 475px to the right, would sit at 1%. A circle as wide as the title
 * keeps the curve exactly as specified, puts the peak on a ring through the
 * title's two ends, and leaves the picture inside the pull's reach.
 *
 * Measured on this page: pivot 229px into the band and 75px down, r = 229px.
 * The peak (100% of `wiggle`) is at either end of the title, and at the
 * band's bottom edge straight below its middle; the end of the byline gets
 * 90%; the picture's own centre 38%; the band's right edge 10%; the title's
 * middle exactly nothing. So the reader who points at the words gets the
 * most, and the one exploring the picture gets a gentler version of it.
 *
 * THE PIVOT IS CACHED, in band coordinates: measured when the geometry is
 * built, on resize, when the pivot element resizes (a rewrap) and when the
 * fonts finish loading (which changes the text's width without resizing any
 * box). The loop adds `scrollY` to it and reads no layout. So a still pointer
 * over a scrolling page changes the pull as the masthead passes under it,
 * which is correct.
 *
 * SIDEWAYS IS EXACT, NOT STEPPED. The picture moves by fractions of a cell on
 * both axes, through the same aperture integral the vertical pan always used
 * — see bScreen for how, and bReduceSource for what it cost: one pass over
 * the source's 635 columns per grid row instead of over the grid's 430, for a
 * frame that measures the same as before because the per-row work it
 * replaced was about the same size. Whole-cell steps would have been a slide
 * in 2px jumps, which is the thing this file exists to avoid.
 *
 * THE FADE DOES NOT MOVE. Presence is fixed in the band (see bPresenceRow)
 * and the picture slides underneath it, so no pointer position brings the
 * ramp's dark end a cell closer to the type. That is why `.envelope()` over
 * the whole wiggle comes out the same as without it.
 *
 * =====================================================================
 * THE FADE, AND THE TWO EDGES
 * =====================================================================
 *
 * The owner's 0.67 / 0.88 are measured across the BAND, and were chosen
 * against a 700px one. At 700px that puts the fade's foot at 161px and the
 * picture's left edge at 66px, so the picture runs out inside ground that
 * has already faded to nothing and its edge is never visible. Widen the
 * band and those two move apart — at 1040px the picture starts at 406px
 * where the fade is already 9% open, and its left edge becomes a faint
 * vertical cut. `rampSpace: 'art'` measures the fade across the picture
 * instead, which holds the relationship at every width; the equivalent of
 * the owner's numbers in that space is ramp 0.636 / width 0.97, which is
 * identical at 700px and better everywhere else.
 *
 * The band's RIGHT edge is hard by construction, because that is where the
 * fade is most open. Nothing here can soften it without eating the picture.
 * The masthead has to either bleed the band off the viewport or accept a
 * cut; that is a layout decision, not a screen one.
 *
 * =====================================================================
 * WITH JAVASCRIPT OFF
 * =====================================================================
 *
 * Nothing here runs, so the band keeps whatever its CSS gives it. The
 * companion `banner-plate.ts` bakes the identical screen — same code path,
 * the pure half of this file is what it imports — into a pair of PNG
 * plates, light and dark, at the rest offset. Used as a
 * `background-image` at natural size with `image-rendering: pixelated`,
 * they are pixel-identical to the first frame this module paints, at any
 * device pixel ratio, because the screen is only ever scaled by whole
 * numbers. The reader with no JavaScript gets the picture, screened,
 * still. What they lose is the crawl, which is the correct thing to lose.
 *
 * =====================================================================
 * WHY THE FILE IS SHAPED LIKE THIS
 * =====================================================================
 *
 * `export` at column zero, no type annotations, ES5-shaped: `build.ts`
 * strips the exports and pastes this into a <script> tag, exactly as it
 * already does with hand.js, while `banner-plate.ts` imports the same file
 * as a module at build time. Two consumers, one source, so the static
 * plate cannot drift from the live render. `banner.d.ts` beside it is what
 * the compiler reads.
 *
 * The first half is pure — no DOM, no canvas, no globals — because that is
 * the half Node runs.
 */

/* ============================================================== pure === */

/* Written as `!(v > a)` rather than `v < a` so that NaN lands on the low
   bound instead of passing straight through. A NaN progress — which is what
   `s / (steps - 1)` hands you when steps is 1 — otherwise reaches the prefix
   sum as an index, and the band paints a frame of undefined. */
export function bClamp(v, a, b) {
  if (!(v > a)) return a;
  return v > b ? b : v;
}

export function bSmoothstep(e0, e1, x) {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  var t = bClamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/* The 8x8 ordered Bayer matrix, written out rather than generated. Three
   lines of recursion nobody can read afterwards buys nothing, and it should
   be obvious on inspection that this is a real matrix and not a table of
   random numbers. Values 0..63. */
export var BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/* The ramp, by role rather than by hex. Six earth tokens that happen to be
   monotonic in luminance in BOTH schemes, which is the property that lets
   one role order serve light and dark without a second table:
       light  .80  .65  .50  .24  .115 .038
       dark   .010 .030 .056 .163 .312 .83
   `--paper` is first because the fade has to resolve to the page's own
   ground — that is what makes the graphic vanish rather than fade to a pale
   rectangle sitting on the page. `--ink` is last and is deliberately in the
   ramp: a background tone equal to the text colour is a contrast of 1, and
   the only thing keeping it away from the type is the fade. That is a real
   dependency and `.envelope()` is how it is checked rather than assumed. */
export var BANNER_TOKENS = [
  '--paper',
  '--rule',
  '--rule-strong',
  '--underline',
  '--accent',
  '--ink',
];

export function bParseColor(s) {
  if (!s) return null;
  s = String(s).trim();
  if (s.charAt(0) === '#') {
    var h = s.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  var m = s.match(/-?[\d.]+/g);
  if (!m || m.length < 3) return null;
  return [+m[0], +m[1], +m[2]];
}

function chan(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
export function bLuminance(rgb) {
  return 0.2126 * chan(rgb[0]) + 0.7152 * chan(rgb[1]) + 0.0722 * chan(rgb[2]);
}

/** WCAG contrast ratio, 1..21. */
export function bContrast(a, b) {
  var la = bLuminance(a);
  var lb = bLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Resolve the six role tones into a `levels`-step ramp, ordered LIGHTEST
 * FIRST, plus which end the page's ground sits at.
 *
 * Orientation is derived rather than declared: whichever end `--paper` is,
 * that is the end the fade resolves to. So the same code serves light and
 * dark and neither scheme is the special case.
 */
export function bResolveRamp(tones, levels) {
  var warnings = [];
  var six = tones.slice(0, 6);
  var lums = six.map(bLuminance);
  var ascending = lums[5] > lums[0];
  var monotonic = true;
  for (var i = 1; i < 6; i += 1) {
    if (ascending ? lums[i] <= lums[i - 1] : lums[i] >= lums[i - 1]) monotonic = false;
  }
  if (!monotonic) {
    warnings.push(
      'banner: the six ramp tokens are no longer monotonic in luminance; the ramp has been ' +
        'sorted to keep the screen from folding. Retune the tokens or the token list.',
    );
    var pairs = six.map(function (c, j) {
      return { c: c, l: lums[j] };
    });
    pairs.sort(function (a, b) {
      return b.l - a.l;
    });
    six = pairs.map(function (p) {
      return p.c;
    });
    ascending = false;
  }
  // Lightest first. `dark` is true when the ground is the DARK end, which is
  // the case the fade has to resolve downward in.
  var ordered = ascending ? six.slice().reverse() : six.slice();
  var dark = ascending;

  var n = Math.max(2, Math.min(6, Math.round(levels)));
  var pal = [];
  for (var k = 0; k < n; k += 1) pal.push(ordered[Math.round((k * 5) / (n - 1))]);
  return { pal: pal, dark: dark, warnings: warnings };
}

/**
 * The band's geometry, in cells. One cell is `cell` CSS px, and the whole
 * of the rest of this file thinks in cells so that nothing has to remember
 * whether a number is a CSS pixel, a device pixel or a source pixel.
 *
 *   k          cells per source pixel. Integer or the reciprocal of one
 *              means the source lands on the grid without a beat; anything
 *              else is only safe because the sampler below integrates over
 *              the cell's aperture rather than picking one pixel out of it.
 *   xa         where `anchorX` puts the picture's left edge, in cells,
 *              possibly negative. The fade is measured from here.
 *   x0         where the picture's left edge actually is at rest: `xa`
 *              pushed outward past the anchored band edge by the wiggle's
 *              reach, rounded up to whole cells. See WIGGLE ROOM below.
 *   slack      the wiggle's reach, in cells — how far the pointer may move
 *              the picture in any direction
 *   surplus    cells of picture taller than the band — the travel budget
 *
 * WIGGLE ROOM. The picture is anchored flush to the band's right edge, so it
 * has no width to spare: move it left by a cell and the band's last cell
 * has no picture under it. Vertically the surplus already provides the
 * room. Horizontally it has to be made, and the only honest way to make it
 * is to crop: the anchored edge is pushed `ceil(slack)` cells past the band's
 * edge, where it can slide back in without ever arriving. With the anchor at
 * the right that hides the picture's rightmost `ceil(slack)` cells at rest —
 * 6px of 635 at the shipped settings — and nothing else moves: the fade is
 * still measured from `xa`, and `bPresenceRow` keeps the picture's own
 * extent where it was.
 */
export function bGeometry(o) {
  var W = o.W;
  var H = o.H;
  var cell = o.cell;
  var gw = Math.max(1, Math.ceil(W / cell));
  var gh = Math.max(1, Math.ceil(H / cell));
  var artScale = o.artScale === 'cover' ? W / o.AW : o.artScale;
  var k = artScale / cell;
  var aw = o.AW * k;
  var ah = o.AH * k;
  var anchor = bClamp(o.anchorX, 0, 1);
  var xa = Math.round((gw - aw) * anchor);
  var slack = Math.max(0, +o.wiggle || 0) / cell;
  // Outward from whichever edge the picture is anchored to; a centred
  // picture has an edge to spare on neither side and is not moved.
  var x0 = xa + (anchor > 0.5 ? Math.ceil(slack) : anchor < 0.5 ? -Math.ceil(slack) : 0);
  var surplus = Math.max(0, ah - gh);
  var travelCells = o.travel === null || o.travel === undefined ? surplus : o.travel / cell;
  travelCells = bClamp(travelCells, 0, surplus);
  return {
    W: W,
    H: H,
    cell: cell,
    gw: gw,
    gh: gh,
    artScale: artScale,
    k: k,
    aw: aw,
    ah: ah,
    xa: xa,
    x0: x0,
    slack: slack,
    surplus: surplus,
    travelCells: travelCells,
  };
}

/**
 * Where the picture sits, in cells, at a given progress.
 *
 * The window into the picture is `gh` cells tall and the picture is
 * `gh + surplus` cells tall, so `surplus` is the whole travel budget and
 * nothing is thrown away — the band is a viewport panning through the
 * picture, not a crop of it. `travel` may be shorter than the budget, and
 * then `focus` says which part of the picture that shorter run covers.
 *
 * `direction` of -1 runs the offset DOWN as progress rises, which moves the
 * picture down inside a band that is itself moving up. Net: the picture
 * crosses the viewport more slowly than the page does, which is what makes
 * it read as something behind the page rather than something stuck to it.
 */
export function bOffset(g, focus, direction, progress) {
  var travel = g.travelCells;
  var t = direction < 0 ? 1 - progress : progress;
  return bClamp(bTravelFrom(g, focus) + travel * t, 0, g.surplus);
}

/* Where the scroll travel starts, in cells. Shared by bOffset and bReach so
   that the range the envelope sweeps and the offsets the band paints are the
   same arithmetic, not two copies of it. */
export function bTravelFrom(g, focus) {
  var rest = g.surplus * bClamp(focus, 0, 1);
  return bClamp(rest - g.travelCells / 2, 0, Math.max(0, g.surplus - g.travelCells));
}

/**
 * Every offset the picture can be displayed at, in cells, as [lo, hi]: the
 * scroll travel widened by `slack` cells each way — the pointer's reach —
 * and clamped to the picture, which has no rows beyond its surplus.
 *
 * The band clamps its displayed offset to this and `.envelope()` sweeps
 * exactly this, which is what keeps the envelope a bound once a pointer and
 * a follower are both adding motion the scroll never asked for.
 */
export function bReach(g, focus, slack) {
  var from = bTravelFrom(g, focus);
  var s = Math.max(0, slack || 0);
  return [Math.max(0, from - s), Math.min(g.surplus, from + g.travelCells + s)];
}

/**
 * Presence: how much of the picture is allowed through, per column.
 *
 * Two things multiplied. The fade — the owner's ramp — and the picture's own
 * horizontal extent, feathered so that a hard vertical edge never appears
 * where the picture runs out. In `rampSpace: 'art'` the fade is measured
 * across the picture instead of across the band, which keeps its foot in the
 * same place relative to the picture's left edge at every band width; in
 * 'band' it is measured across the band, which is what the owner's 0.67 /
 * 0.88 were chosen against at a 700px band.
 *
 * Presence is what makes the picture's edges invisible AND what keeps the
 * ramp's dark end away from the type, so it is one array and not two ideas.
 *
 * IT IS FIXED IN THE BAND, and the wiggle slides the picture underneath it.
 * That is the property that makes a sideways wiggle safe in front of type:
 * the fade's foot is measured from the ANCHOR (`xa`), not from wherever the
 * picture currently is, so no pointer position can bring the dark end of
 * the ramp a single cell closer to the title. The picture's extent is the
 * same idea from the other side: it is taken as the span the picture covers
 * at EVERY reachable offset — its rest extent shrunk by the slack at both
 * ends — so a column with any presence always has picture under it, and the
 * sampler never has to invent the pixels past the art's edge.
 */
export function bPresenceRow(g, o) {
  var gw = g.gw;
  var row = new Float32Array(gw);
  var span = o.rampSpace === 'art' ? g.aw : gw;
  var base = o.rampSpace === 'art' ? g.xa : 0;
  var foot = base + (o.ramp - o.rampWidth / 2) * span;
  var head = base + (o.ramp + o.rampWidth / 2) * span;
  var feather = Math.max(0, o.feather);
  var slack = g.slack || 0;
  var left = g.x0 + slack;
  var right = g.x0 + g.aw - slack;
  for (var x = 0; x < gw; x += 1) {
    var u = x + 0.5;
    var p = bSmoothstep(foot, head, u);
    // The picture's own extent. Zero outside it, feathered at both edges, so
    // the sampler never has to invent pixels and the reader never sees a cut.
    var cover = bSmoothstep(left - feather, left + feather, u) * (1 - bSmoothstep(right - feather, right + feather, u));
    row[x] = p * cover;
  }
  return { row: row, footCss: foot * g.cell, headCss: head * g.cell };
}

/* sRGB byte -> linear light, all 256 of them, built on first use. The same
   arithmetic as `chan`, so the OKLab below is the textbook one, without a
   million calls to Math.pow per picture. */
var LINEAR = null;
function linearLut() {
  if (!LINEAR) {
    LINEAR = new Float64Array(256);
    for (var i = 0; i < 256; i += 1) LINEAR[i] = chan(i);
  }
  return LINEAR;
}

/* The q-quantile of a list: the nearest-rank element of a Float32 copy, as
   if sorted. Deterministic to the bit on every engine — which matters,
   because the ground and the normaliser below are both quantiles and both
   are baked into the no-JS plate.

   Found by SELECTION rather than by sorting, and that is a load-time
   decision, not a style one: sorting the picture's 317,500 distances was
   most of a 100ms task on the main thread, and an order statistic does not
   need the order of anything else. A three-way partition, because pixel art
   is mostly runs of identical colours and a two-way one degrades on
   duplicates. The k-th smallest value is the same value whichever way it is
   found, so this returns exactly what the sort did. */
function quantile(arr, q) {
  var a = Float32Array.from(arr);
  var k = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))));
  var lo = 0;
  var hi = a.length - 1;
  while (lo < hi) {
    var pivot = a[(lo + hi) >> 1];
    var lt = lo;
    var gt = hi;
    var i = lo;
    while (i <= gt) {
      var v = a[i];
      if (v < pivot) {
        a[i] = a[lt];
        a[lt] = v;
        lt += 1;
        i += 1;
      } else if (v > pivot) {
        a[i] = a[gt];
        a[gt] = v;
        gt -= 1;
      } else {
        i += 1;
      }
    }
    if (k < lt) hi = lt - 1;
    else if (k > gt) lo = gt + 1;
    else return pivot;
  }
  return a[k];
}

/**
 * The picture's INK, one value per source pixel, 0..1: how far that pixel's
 * colour is from the picture's own ground.
 *
 * WHY THIS AND NOT BRIGHTNESS — decided 22 October 2026. The screen used to
 * spend ink on luminance: on dark, the brightest paint landed furthest from
 * the page and read as the subject; on light the same rule turned over, so
 * the gold sank into the paper and the night sky behind the figure carried
 * the most ink. The picture was a negative of itself on one of the two
 * pages. Of the candidates laid out side by side in
 * `reference/banner-light.html`, Tani chose this one — "b", distance from
 * the picture's own ground — for BOTH themes, "so the system remains
 * coherent": one rule, and on either page the figure is what differs from
 * its background and so it is what gets the ink.
 *
 * THE GROUND is the per-channel OKLab median of a 12px ring round the art's
 * edge — for this picture the night, #1f141a. The ring is mostly sky, and a
 * median ignores the bits of hood and column that reach the edge. INK is the
 * OKLab distance from it, in any direction: lighter, darker and more
 * colourful all count, which is why the black inside the hood still prints.
 * It is normalised so that the 98th percentile is full ink — the brightest
 * two percent clip, rather than one stray pixel deciding the scale for the
 * whole picture.
 *
 * Both constants are per picture and computed once, at load, as order
 * statistics — see `quantile` for why that is deterministic and cheap. Every intermediate is held
 * in Float32 exactly as the specimen page does it, so the two agree to the
 * byte rather than to the eye.
 */
export function bInkField(art) {
  var AW = art.width;
  var AH = art.height;
  var N = AW * AH;
  var data = art.data;
  var lin = linearLut();
  var OL = new Float32Array(N);
  var OA = new Float32Array(N);
  var OB = new Float32Array(N);
  for (var i = 0; i < N; i += 1) {
    var lr = lin[data[i * 4]];
    var lg = lin[data[i * 4 + 1]];
    var lb = lin[data[i * 4 + 2]];
    var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    OL[i] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    OA[i] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    OB[i] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  }

  // The ring, in raster order, and its median per channel.
  var R = 12;
  var ringL = [];
  var ringA = [];
  var ringB = [];
  for (var y = 0; y < AH; y += 1) {
    for (var x = 0; x < AW; x += 1) {
      if (x >= R && x < AW - R && y >= R && y < AH - R) continue;
      var j = y * AW + x;
      ringL.push(OL[j]);
      ringA.push(OA[j]);
      ringB.push(OB[j]);
    }
  }
  var G = [quantile(ringL, 0.5), quantile(ringA, 0.5), quantile(ringB, 0.5)];

  var dist = new Float32Array(N);
  for (var k = 0; k < N; k += 1) dist[k] = Math.hypot(OL[k] - G[0], OA[k] - G[1], OB[k] - G[2]);
  var scale = quantile(dist, 0.98);
  var ink = new Float32Array(N);
  for (var n = 0; n < N; n += 1) ink[n] = scale > 0 ? bClamp(dist[n] / scale, 0, 1) : 0;
  return { ink: ink, ground: G, scale: scale };
}

/**
 * Reduce the source to a per-column vertical prefix sum of INK (see
 * bInkField), at SOURCE resolution.
 *
 * This is the whole performance story, and it changed when the picture
 * learned to move sideways. It used to be reduced to GRID columns, which
 * made the horizontal half of every cell's integral free — and fixed the
 * picture's horizontal position for good. Now it is kept one source column
 * wide, so a cell's aperture can land anywhere across them. What it costs is
 * one pass over the source's columns per grid row instead of over the grid's
 * (see bScreen); what it buys is that the reduction no longer depends on the
 * band at all, so it is paid once per picture rather than once per resize.
 * The ink scoring rides along in the same once: the OKLab conversion and the
 * two sorts happen here, at load, and the frame never sees them.
 *
 * Area sampling only. The aperture integral is what a halftone physically
 * does, it is what makes a fractional scale harmless — an irregular source
 * grid is averaged away before it is ever screened — and now it is also what
 * makes a fractional HORIZONTAL offset exact. A nearest-pixel sampler has no
 * fractional positions to offer; it would step the picture sideways in whole
 * source pixels, which is the slide this file exists to prevent.
 *
 * Returns { prefix, width, rows, ground, scale } where prefix has
 * (rows + 1) * width entries and prefix[(r + 1) * width + c] -
 * prefix[r * width + c] is the ink of source pixel (c, r), 0..1, and
 * `ground` (OKLab) and `scale` are the two constants it was scored against.
 * Float32 is enough: no column sums to more than its height, a few hundred,
 * which keeps ~5 significant digits after the point.
 */
export function bReduceSource(art) {
  var AW = art.width;
  var AH = art.height;
  var f = bInkField(art);
  var ink = f.ink;
  var prefix = new Float32Array((AH + 1) * AW);
  for (var r = 0; r < AH; r += 1) {
    var rowBase = r * AW;
    var out = (r + 1) * AW;
    var prev = r * AW;
    for (var c = 0; c < AW; c += 1) prefix[out + c] = prefix[prev + c] + ink[rowBase + c];
  }
  return { prefix: prefix, width: AW, rows: AH, ground: f.ground, scale: f.scale };
}

/**
 * Screen one frame into an RGBA buffer.
 *
 * `ox` and `oy` are the picture's offset in CELLS — `ox` positive moves it
 * right, `oy` positive moves the window DOWN the picture, which moves the
 * picture up — and both are CONTINUOUS, on whatever clock they are observed:
 * the follower hands them fractions of a cell every frame, and that is the
 * point. A cell's ink is the exact area integral of the source under
 * it, so a sub-cell movement changes every cell's value a little and they
 * re-resolve individually. Snapping either offset to whole cells instead
 * would shift the entire picture by a cell at once, which is a slide wearing
 * a dither.
 *
 * HOW THE INTEGRAL IS TAKEN, exactly, at any fractional offset. Per grid row,
 * one pass over the source columns interpolates each column's vertical
 * prefix at the row's top and bottom edge — the column's integral across the
 * row — and accumulates those left to right into a horizontal prefix. Each
 * cell's integral is then two interpolated reads of that prefix at its left
 * and right edge. Interpolating a prefix of box-shaped pixels is not an
 * approximation: inside one pixel the running integral IS linear. The cell
 * edges in source space move only with `ox`, so they are resolved once per
 * frame rather than once per row.
 *
 * The Bayer index is taken from the GRID coordinate and never from the
 * source coordinate. That single line is what pins the screen to the
 * viewport while the picture moves through it — in both directions now.
 */
export function bScreen(out, src, g, pres, pal, grain, dark, ox, oy, scratch) {
  var gw = g.gw;
  var gh = g.gh;
  var V = src.prefix;
  var AW = src.width;
  var rows = src.rows;
  var perCell = 1 / g.k; // source pixels per cell, on each axis
  var invArea = g.k * g.k;
  var top = pal.length - 1;

  // Every buffer this needs is hoisted into a scratch object the caller owns,
  // because allocating typed arrays sixty times a second is how a 1ms frame
  // acquires a 20ms garbage-collection spike sitting on top of it.
  var sc = scratch || {};
  if (!sc.hp || sc.hp.length !== AW + 1) sc.hp = new Float64Array(AW + 1);
  if (!sc.ei || sc.ei.length !== gw + 1) {
    sc.ei = new Int32Array(gw + 1);
    sc.ef = new Float64Array(gw + 1);
    sc.ev = new Float64Array(gw + 1);
  }
  if (!sc.pr || sc.pr.length !== pal.length) {
    sc.pr = new Float32Array(pal.length);
    sc.pg = new Float32Array(pal.length);
    sc.pb = new Float32Array(pal.length);
    sc.palRef = null;
  }
  if (sc.palRef !== pal) {
    for (var q = 0; q < pal.length; q += 1) {
      sc.pr[q] = pal[q][0];
      sc.pg[q] = pal[q][1];
      sc.pb[q] = pal[q][2];
    }
    sc.palRef = pal;
  }
  var pr = sc.pr;
  var pg = sc.pg;
  var pb = sc.pb;
  var hp = sc.hp; // horizontal prefix of one grid row, per source column edge
  var ei = sc.ei; // each cell edge's source column ...
  var ef = sc.ef; // ... and how far into it
  var ev = sc.ev; // the prefix at each cell edge

  // Cell edges in source space. Off the art they clamp, and contribute
  // nothing — presence is zero there anyway; see bPresenceRow.
  for (var e = 0; e <= gw; e += 1) {
    var xs = (e - g.x0 - ox) * perCell;
    if (!(xs > 0)) {
      ei[e] = 0;
      ef[e] = 0;
    } else if (xs >= AW) {
      ei[e] = AW - 1;
      ef[e] = 1;
    } else {
      var xi = Math.floor(xs);
      ei[e] = xi;
      ef[e] = xs - xi;
    }
  }

  hp[0] = 0;
  for (var gy = 0; gy < gh; gy += 1) {
    // The row's top and bottom edge in source rows, clamped like the columns.
    // Out of range is why the caller keeps the picture taller than the band.
    var y0 = (gy + oy) * perCell;
    var y1 = y0 + perCell;
    y0 = y0 < 0 ? 0 : y0 > rows ? rows : y0;
    y1 = y1 < 0 ? 0 : y1 > rows ? rows : y1;
    var i0 = Math.floor(y0);
    if (i0 >= rows) i0 = rows - 1;
    var f0 = y0 - i0;
    var i1 = Math.floor(y1);
    if (i1 >= rows) i1 = rows - 1;
    var f1 = y1 - i1;
    var a0 = i0 * AW;
    var a1 = i1 * AW;
    var acc = 0;
    for (var c = 0; c < AW; c += 1) {
      var t0 = V[a0 + c];
      var t1 = V[a1 + c];
      acc += t1 + (V[a1 + AW + c] - t1) * f1 - (t0 + (V[a0 + AW + c] - t0) * f0);
      hp[c + 1] = acc;
    }
    for (var e2 = 0; e2 <= gw; e2 += 1) {
      var h = hp[ei[e2]];
      ev[e2] = h + (hp[ei[e2] + 1] - h) * ef[e2];
    }

    var brow = (gy & 7) << 3;
    var o = gy * gw * 4;
    for (var gx = 0; gx < gw; gx += 1) {
      // Ink, 0 at the picture's own ground and 1 at full ink — see
      // bInkField. Off the art the integral is empty, which is 0, which is
      // paper, on either page.
      var s = (ev[gx + 1] - ev[gx]) * invArea * pres[gx];
      // Fade toward the ground BEFORE quantising, which is what multiplying
      // by presence does. As presence falls the source runs out of tonal
      // range, the screen runs out of levels to spend on it, and the pattern
      // thins to isolated cells and then to nothing. Fading after quantising
      // would instead fade a solid dither toward the ground, which is a
      // translucent picture, not a screen running out.
      //
      // Ink is counted in palette steps FROM THE PAPER END, in both themes.
      // The palette is lightest first and `dark` says the paper is its
      // last step, so on dark more ink means lighter and on light it means
      // darker: in either case, further from the page. `(1 - (1 - s))` is
      // not a typo — it is the order of operations the specimen page uses,
      // kept so the two round identically.
      var v = (dark ? (1 - s) * top : (1 - (1 - s)) * top) + (BAYER8[brow + (gx & 7)] / 64 - 0.5) * grain;
      var kIdx = v < 0 ? 0 : v > top ? top : Math.round(v);
      var oi = o + gx * 4;
      out[oi] = pr[kIdx];
      out[oi + 1] = pg[kIdx];
      out[oi + 2] = pb[kIdx];
      out[oi + 3] = 255;
    }
  }
}

/**
 * The pointer's pull, as the factor that turns the pivot-to-pointer vector
 * into the picture's displacement:
 *
 *     displacement = peak * (v / r) * exp((1 - |v|² / r²) / 2)
 *
 * which is the gradient of a Gaussian bump centred on the picture, scaled so
 * its magnitude peaks at exactly `peak` when the pointer is exactly `r` away.
 * Its magnitude is d/r · exp((1 - d²/r²)/2): it rises linearly from ZERO at
 * the pivot, so a pointer crossing the centre passes through rest rather than
 * flipping the picture from one side to the other; it peaks at the picture's
 * own radius; and it is gone by three radii (5% at 3r, 0.2% at 4r), so a
 * pointer out at the far side of the page leaves the picture alone. Smooth
 * everywhere, including at the pivot — no kink for the eye to catch.
 *
 * A Gaussian rather than an exponential tail because "the farther the
 * cursor, the subtler" should end somewhere: an exponential still has 40%
 * left at 3r, a Gaussian 5%, so a pointer down in the article or out past the
 * page's edge leaves the picture alone instead of holding it a little off
 * centre for as long as the band is on screen.
 *
 * Returns the factor f such that displacement = peak * f * v / r, taking the
 * SQUARED distance so the caller never needs a square root.
 */
export function bPull(d2, r) {
  return Math.exp(0.5 - d2 / (2 * r * r));
}

/**
 * The picture's centre and radius, in cells, as the reader sees it: the
 * presence-weighted centroid of the band's columns, at mid-height, and the
 * radius of a disc with the area presence lets through. Weighted rather than
 * geometric because a third of the art sits under a fade that has already
 * gone to nothing, and a pivot out there would be the centre of something
 * nobody can see.
 */
export function bPivot(g, pres) {
  var sum = 0;
  var moment = 0;
  for (var x = 0; x < g.gw; x += 1) {
    sum += pres[x];
    moment += pres[x] * (x + 0.5);
  }
  if (!(sum > 0)) return { x: g.gw / 2, y: g.gh / 2, r: Math.max(1, Math.min(g.gw, g.gh) / 2) };
  return { x: moment / sum, y: g.gh / 2, r: Math.max(1, Math.sqrt((sum * g.gh) / Math.PI)) };
}

/* ============================================================ browser === */

var DEFAULTS = {
  grain: 0.85,
  levels: 6,
  ramp: 0.67,
  rampWidth: 0.88,
  cell: 2,
  artScale: 1,
  anchorX: 1,
  focus: 0.35,
  travel: null,
  direction: -1,
  rampSpace: 'band',
  feather: 4,
  follow: 120,
  wiggle: 6,
  wiggleSign: 1,
  pivot: null,
  fps: null,
  progress: null,
  motion: null,
  tokens: BANNER_TOKENS,
};

/** The follower stops once the displayed offset is this close to its target,
    in cells, and snaps the rest. An exponential never arrives, and its tail
    is not motion anyone sees as motion: below a cell it is scattered single
    cells flipping as their integrated tone drifts across a threshold, which
    reads as twinkle rather than as the picture settling. A tenth of a cell
    cuts that tail to about τ·ln(10) — 280ms at follow 120 — after the gap
    falls under one cell, and the final snap moves each cell's tone by a
    tenth of the step between two source rows, which flips almost nothing. */
var SETTLE = 0.1;
/** The longest frame the follower will integrate over, in ms. A tab that
    stalls for a second should resume easing, not land the whole way at once. */
var MAX_DT = 100;
/** Resize is debounced by this much; the reduction is not cheap. */
var RESIZE_MS = 150;

export function createBannerScreen(options) {
  var host = options.host;
  if (!host) throw new Error('banner: options.host is required');

  var p = {};
  for (var key in DEFAULTS) p[key] = DEFAULTS[key];
  for (var k2 in options) if (k2 !== 'host' && k2 !== 'art') p[k2] = options[k2];

  var warnings = [];
  var stats = { frames: 0, lastFrameMs: 0, meanFrameMs: 0, worstFrameMs: 0 };

  var canvas = document.createElement('canvas');
  canvas.className = 'banner-screen';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;';
  var ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      ready: Promise.reject(new Error('banner: no 2d context')),
      render: function () {},
      set: function () {},
      params: Object.freeze(p),
      geometry: function () {
        return null;
      },
      palette: function () {
        return [];
      },
      envelope: function () {
        return null;
      },
      stats: stats,
      warnings: ['banner: canvas 2d is unavailable; the static plate stands'],
      destroy: function () {},
      canvas: null,
    };
  }
  ctx.imageSmoothingEnabled = false;

  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  // The screen is built on a small offscreen canvas — one pixel per cell —
  // and blitted up by a whole number. That is the only scaling that ever
  // touches a screened pixel, and a whole number cannot beat against the
  // device grid.
  var off = document.createElement('canvas');
  var octx = off.getContext('2d');

  var art = null; // { data, width, height }
  var src = null; // the reduced source; see bReduceSource
  var geom = null;
  var presence = null;
  var pal = null;
  var isDark = false;
  var frame = null; // ImageData
  var scratch = {}; // reused per-frame buffers; see bScreen
  var lastW = -1;
  var lastH = -1;
  var scrollTop = 0; // the band's document offset
  var scrollSpan = 1; // how much scroll the band survives
  var viewH = 1; // the viewport's height, cached beside them for the same reason
  var bandLeft = 0; // the band's left edge in the viewport; the page never scrolls sideways
  var pivotX = 0; // the picture's pivot, CSS px from the band's left edge ...
  var pivotY = 0; // ... and from its top; see bPivot
  var pivotR = 1; // and its radius, CSS px
  var reachLo = 0; // every vertical offset the picture may be shown at, in cells
  var reachHi = 0;
  var shownX = 0; // the offset on screen now, in cells — the follower's state
  var shownY = 0;
  var wantX = 0; // the target, written by targetOffset() so it allocates nothing
  var wantY = 0;
  var paintedX = NaN; // the offset the canvas last received
  var paintedY = NaN;
  var pointerIn = false; // a pointer has been seen and has not left the window
  var pointerX = 0; // its last position, viewport px
  var pointerY = 0;
  var destroyed = false;

  var reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  function wantsMotion() {
    return p.motion === null || p.motion === undefined ? !reduceMQ.matches : !!p.motion;
  }

  /* ---- palette, read out of the stylesheet ---------------------------- */

  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    var tones = [];
    for (var i = 0; i < p.tokens.length; i += 1) {
      var c = bParseColor(cs.getPropertyValue(p.tokens[i]));
      if (!c) {
        warnings.push('banner: ' + p.tokens[i] + ' did not resolve to a colour');
        c = [128, 128, 128];
      }
      tones.push(c);
    }
    var r = bResolveRamp(tones, p.levels);
    pal = r.pal;
    isDark = r.dark;
    for (var w = 0; w < r.warnings.length; w += 1) {
      if (warnings.indexOf(r.warnings[w]) < 0) warnings.push(r.warnings[w]);
    }
  }

  /* ---- geometry ------------------------------------------------------- */

  function rebuild() {
    if (!art) return;
    var W = host.clientWidth;
    var H = host.clientHeight;
    lastW = W;
    lastH = H;
    if (W <= 0 || H <= 0) {
      geom = null;
      return;
    }
    geom = bGeometry({
      W: W,
      H: H,
      cell: p.cell,
      AW: art.width,
      AH: art.height,
      artScale: p.artScale,
      anchorX: p.anchorX,
      travel: p.travel,
      // Cropped for the wiggle whether or not motion is wanted, so that the
      // reduced-motion frame, the moving band at rest and the no-JS plate are
      // all the same picture in the same place.
      wiggle: p.wiggle,
    });
    var pr = bPresenceRow(geom, p);
    presence = pr.row;
    geom.rampFootCss = pr.footCss;
    geom.rampHeadCss = pr.headCss;
    frame = octx.createImageData(geom.gw, geom.gh);
    off.width = geom.gw;
    off.height = geom.gh;

    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var cellDev = Math.max(1, Math.round(p.cell * dpr));
    geom.cellDev = cellDev;
    canvas.width = geom.gw * cellDev;
    canvas.height = geom.gh * cellDev;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // Cached once, so the render loop never reads layout.
    var r = host.getBoundingClientRect();
    scrollTop = r.top + window.scrollY;
    scrollSpan = Math.max(1, scrollTop + r.height);
    viewH = Math.max(1, window.innerHeight);
    bandLeft = r.left;
    measurePivot(r);

    // The vertical range the scroll and the wiggle can put the picture in
    // between them. The follower is clamped to this and `.envelope()` sweeps
    // exactly this; see bReach. The horizontal range is ±slack.
    var span = bReach(geom, p.focus, geom.slack);
    reachLo = span[0];
    reachHi = span[1];
  }

  /* What the pointer leans the picture toward, and how far its pull reaches:
     band-relative and in CSS px, so the loop only has to add the band's
     cached position. Called with the band's rect from wherever layout is
     already being read — the rebuild, a resize, the pivot element resizing,
     the fonts arriving — and never from the loop.

     With a `pivot` element, it is the centre of that element's TEXT, not of
     its box: a heading is a block as wide as the column, and the middle of
     the column is not the middle of the words. The radius is half the text's
     width, isotropic — see THE POINTER in the header for why not an ellipse.
     Without one, it is the picture itself; see bPivot. */
  function measurePivot(bandRect) {
    var el = p.pivot;
    if (el && el.isConnected) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var rects = range.getClientRects();
      var L = Infinity;
      var R = -Infinity;
      var T = Infinity;
      var B = -Infinity;
      for (var i = 0; i < rects.length; i += 1) {
        if (rects[i].width <= 0) continue;
        if (rects[i].left < L) L = rects[i].left;
        if (rects[i].right > R) R = rects[i].right;
        if (rects[i].top < T) T = rects[i].top;
        if (rects[i].bottom > B) B = rects[i].bottom;
      }
      if (R > L) {
        pivotX = (L + R) / 2 - bandRect.left;
        pivotY = (T + B) / 2 - bandRect.top;
        pivotR = Math.max(1, (R - L) / 2);
        return;
      }
    }
    if (!geom) return;
    var pv = bPivot(geom, presence);
    pivotX = pv.x * geom.cell;
    pivotY = pv.y * geom.cell;
    pivotR = pv.r * geom.cell;
  }

  function currentProgress() {
    if (p.progress) return bClamp(p.progress(), 0, 1);
    return bClamp(window.scrollY / scrollSpan, 0, 1);
  }

  /* Where the picture should be, in cells, written into wantX / wantY: the
     scroll's offset, plus the pointer's pull toward (or away from) itself —
     see THE POINTER in the header, and bPull for the curve. The pivot is
     band-relative, so the scroll moving the band under a still pointer
     changes the pull too, which is correct: the picture moved, the pointer
     did not. */
  function targetOffset() {
    var oy = bOffset(geom, p.focus, p.direction, currentProgress());
    var ox = 0;
    var slack = geom.slack;
    if (pointerIn && slack > 0) {
      var vx = pointerX - (bandLeft + pivotX);
      var vy = pointerY - (scrollTop - window.scrollY + pivotY);
      // Cells of displacement per px of pivot-to-pointer vector. `slack` is
      // the peak; bPull is 1 at the radius, so this peaks at exactly slack.
      var f = ((p.wiggleSign < 0 ? -1 : 1) * slack * bPull(vx * vx + vy * vy, pivotR)) / pivotR;
      ox = f * vx;
      // Down the screen is UP the picture: a larger oy moves it up.
      oy -= f * vy;
    }
    wantX = bClamp(ox, -slack, slack);
    wantY = bClamp(oy, reachLo, reachHi);
  }

  /* The one frame reduced motion ever gets, and the frame the plate is. */
  function restOffset() {
    wantX = 0;
    wantY = bOffset(geom, p.focus, p.direction, 0);
  }

  /* ---- one frame ------------------------------------------------------ */

  function paint(ox, oy) {
    if (!geom || !src || !frame) return;
    var t0 = performance.now();
    paintedX = ox;
    paintedY = oy;
    bScreen(frame.data, src, geom, presence, pal, p.grain, isDark, ox, oy, scratch);
    octx.putImageData(frame, 0, 0);
    ctx.drawImage(
      off,
      0,
      0,
      geom.gw,
      geom.gh,
      0,
      0,
      geom.gw * geom.cellDev,
      geom.gh * geom.cellDev,
    );
    var dt = performance.now() - t0;
    stats.frames += 1;
    stats.lastFrameMs = dt;
    stats.meanFrameMs += (dt - stats.meanFrameMs) / stats.frames;
    if (dt > stats.worstFrameMs) stats.worstFrameMs = dt;
  }

  /* ---- the follower --------------------------------------------------- */

  var running = false;
  var onScreen = false;
  var lastTickAt = -1; // -1: the next tick is the first since the loop started
  var lastPaintAt = -1e9;
  var rafId = 0;

  /* One animation frame. Ease, paint if anything moved, and stop the moment
     there is nothing left to ease — see THE FOLLOWER in the header. Nothing
     in here reads layout: scrollY, the cached band position and the
     pointer's last reported position are all it looks at. */
  function tick(now) {
    rafId = 0;
    if (destroyed) return;
    if (!onScreen || document.hidden || !wantsMotion() || !geom) {
      running = false;
      return;
    }
    // The rAF timestamp, not performance.now(): it is the frame's own time,
    // so the step is the step the display actually took. The first tick
    // after a start has no previous frame, and gets one frame's worth.
    var dt = lastTickAt < 0 ? 1000 / 60 : bClamp(now - lastTickAt, 0, MAX_DT);
    lastTickAt = now;

    // One follower, two axes, the same time constant on both — so the
    // picture travels in a straight line toward where it is going rather
    // than arriving on one axis first.
    targetOffset();
    var a = p.follow > 0 ? 1 - Math.exp(-dt / p.follow) : 1;
    shownX += (wantX - shownX) * a;
    shownY += (wantY - shownY) * a;
    var settled = Math.abs(wantX - shownX) < SETTLE && Math.abs(wantY - shownY) < SETTLE;
    if (settled) {
      shownX = wantX;
      shownY = wantY;
    }

    // `fps` is a cap, off by default. The settling frame is always painted
    // whatever the cap says, or a capped band could stop a fraction short.
    if (settled || !(p.fps > 0) || now - lastPaintAt >= 1000 / p.fps - 1) {
      if (shownX !== paintedX || shownY !== paintedY) paint(shownX, shownY);
      lastPaintAt = now;
    }
    if (settled) {
      running = false;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function kick() {
    if (running || destroyed) return;
    if (!onScreen || document.hidden || !wantsMotion() || !geom) return;
    running = true;
    lastTickAt = -1;
    rafId = requestAnimationFrame(tick);
  }

  /* Put the picture where it should be, now, with no ease. For the moments
     the reader did not watch it travel — the band coming back on screen, a
     resize, a change of settings — where easing would show them a journey
     that never happened. Paints only if that is somewhere new. */
  function snap(force) {
    if (!geom) return;
    if (wantsMotion()) targetOffset();
    else restOffset();
    shownX = wantX;
    shownY = wantY;
    if (force || shownX !== paintedX || shownY !== paintedY) paint(shownX, shownY);
  }

  /* The band's own extent, from the cached offsets, widened by a margin.
     This is what the old 64px rootMargin was for: having the right frame
     on the canvas BEFORE the band is visible, rather than painting it on the
     first frame it already is. IntersectionObserver reports a frame late by
     design, which on a jump straight to the top (Home, a contents link) is a
     frame of the picture sixty cells from where it belongs. */
  function nearView() {
    var y = window.scrollY;
    return y < scrollSpan + 64 && y + viewH > scrollTop - 64;
  }

  function onScroll() {
    if (onScreen) kick();
    else if (geom && wantsMotion() && nearView()) snap(false);
  }

  // No rootMargin: "on screen" means on screen. Nothing eases and no pointer
  // listener exists unless some of the band is actually in the viewport;
  // `nearView` above does the preparing that the margin used to.
  var io = new IntersectionObserver(function (entries) {
    var was = onScreen;
    for (var i = 0; i < entries.length; i += 1) {
      onScreen = entries[i].isIntersecting;
    }
    // Back on screen without the reader having watched it get here: snap,
    // then let the follower take it from wherever it now is. Under reduced
    // motion there is nothing to do; the one frame is already up.
    if (onScreen && !was && wantsMotion()) snap(false);
    syncPointer();
    kick();
  });

  /* ---- the pointer ---------------------------------------------------- */

  var fineMQ = matchMedia('(hover: hover) and (pointer: fine)');
  var pointerOn = false;

  /* The whole of what a pointer event costs: two stores, then the loop is
     asked to run if it is not already. rAF coalesces however many of these
     arrive into the one frame that reads them. */
  function onPointer(e) {
    if (e.pointerType === 'touch') return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerIn = true;
    kick();
  }

  // The pointer leaving the window leaves nothing to lean toward; ease home.
  function onPointerLeave() {
    pointerIn = false;
    kick();
  }

  /* A resize can move the band sideways (the column is centred) without
     resizing it, which the ResizeObserver never hears about. Reading layout
     is fine here — this is an event, not the loop. */
  function onViewport() {
    viewH = Math.max(1, window.innerHeight);
    var r = host.getBoundingClientRect();
    bandLeft = r.left;
    scrollTop = r.top + window.scrollY;
    scrollSpan = Math.max(1, scrollTop + r.height);
    measurePivot(r);
  }

  /* The pivot moved or changed size without the band doing either — a title
     rewrapping, a webfont replacing its fallback. Re-measure, and let the
     follower carry the picture to wherever the new pull puts it. */
  function onPivotChange() {
    if (destroyed || !geom) return;
    measurePivot(host.getBoundingClientRect());
    kick();
  }

  /* The pointer listeners exist only while they could matter: the band on
     screen, the tab visible, motion wanted, a pointer that hovers, and a
     wiggle to spend. Everything else REMOVES them rather than leaving them
     to return early, so a reader scrolled into the article pays nothing for
     a picture they cannot see. */
  function syncPointer() {
    var slack = geom ? geom.slack : 0;
    var want = !destroyed && onScreen && !document.hidden && wantsMotion() && slack > 0 && fineMQ.matches;
    // A device that has stopped being a hovering one has no resting position
    // left; its last one should not hold the picture off centre.
    if (!fineMQ.matches || !(slack > 0)) pointerIn = false;
    if (want === pointerOn) return;
    pointerOn = want;
    var root = document.documentElement;
    if (want) {
      onViewport();
      addEventListener('pointermove', onPointer, { passive: true });
      addEventListener('resize', onViewport, { passive: true });
      root.addEventListener('pointerleave', onPointerLeave);
    } else {
      removeEventListener('pointermove', onPointer);
      removeEventListener('resize', onViewport);
      root.removeEventListener('pointerleave', onPointerLeave);
    }
  }

  function onFineChange() {
    syncPointer();
    kick();
  }

  /* ---- what changes underneath it ------------------------------------- */

  var resizeTimer = 0;
  // ResizeObserver fires once on observe(), reporting the size the first
  // paint already used. Rebuilding on that is a wasted rebuild and a second
  // frame nobody asked for — which under reduced motion is the difference
  // between one static frame and two.
  var ro = new ResizeObserver(function (entries) {
    if (destroyed) return;
    for (var i = 0; i < entries.length; i += 1) {
      if (entries[i].target !== host) onPivotChange();
    }
    if (host.clientWidth === lastW && host.clientHeight === lastH) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (destroyed) return;
      if (host.clientWidth === lastW && host.clientHeight === lastH) return;
      rebuild();
      // A new geometry is a new cell space; the old offset means nothing in
      // it, so there is nothing to ease from.
      snap(true);
      syncPointer();
    }, RESIZE_MS);
  });

  function onScheme() {
    readPalette();
    // Same place, new inks. If the follower is mid-ease it carries on from
    // here on its next frame.
    if (geom) paint(shownX, shownY);
  }

  var schemeMQ = matchMedia('(prefers-color-scheme: dark)');
  var themeObserver = new MutationObserver(onScheme);

  function onReduceChange() {
    snap(true);
    syncPointer();
    kick();
  }

  function onVisibility() {
    syncPointer();
    if (!document.hidden) kick();
  }

  /* ---- the art -------------------------------------------------------- */

  function reduceSource(src) {
    if (src && src.data && src.width && src.height) return src;
    var c = document.createElement('canvas');
    c.width = src.naturalWidth || src.width;
    c.height = src.naturalHeight || src.height;
    var cc = c.getContext('2d', { willReadFrequently: true });
    cc.drawImage(src, 0, 0);
    return cc.getImageData(0, 0, c.width, c.height);
  }

  function loadArt(a) {
    if (typeof a !== 'string') return Promise.resolve(reduceSource(a));
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () {
        resolve(reduceSource(img));
      };
      img.onerror = function () {
        reject(new Error('banner: could not load ' + a));
      };
      img.src = a;
    });
  }

  var ready = loadArt(options.art).then(function (decoded) {
    if (destroyed) return;
    art = decoded;
    // Once per picture: the reduction no longer depends on the band.
    src = bReduceSource(art);
    readPalette();
    rebuild();
    snap(true);

    io.observe(host);
    ro.observe(host);
    // The pivot element's box, for a rewrap; the fonts, for the change in the
    // text's width that a rewrap-free font swap makes without resizing any
    // box at all. Both are layout reads in callbacks, never in the loop.
    if (p.pivot && p.pivot.nodeType === 1) ro.observe(p.pivot);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onPivotChange);
    // The listener goes on unconditionally and `kick` is what refuses to
    // start the clock. Attaching it only when motion is currently wanted
    // would strand a reader who turns `prefers-reduced-motion` off after the
    // page has loaded: the band would stay on its one static frame forever
    // with nothing left to wake it. The POINTER listener is the opposite
    // case — it is cheap to re-attach, so `syncPointer` keeps it off the
    // page entirely whenever it could not matter.
    addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    if (schemeMQ.addEventListener) schemeMQ.addEventListener('change', onScheme);
    if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduceChange);
    if (fineMQ.addEventListener) fineMQ.addEventListener('change', onFineChange);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  });

  /* ---- the contrast envelope ------------------------------------------ */

  function envelope(o) {
    o = o || {};
    if (!geom || !src) return null;
    var fg = o.fg || bParseColor(getComputedStyle(document.documentElement).getPropertyValue('--ink')) || [0, 0, 0];
    var rowFrom = Math.max(0, Math.floor((o.rows ? o.rows[0] : 0) / p.cell));
    var rowTo = Math.min(geom.gh, Math.ceil((o.rows ? o.rows[1] : geom.H) / p.cell));
    var gw = geom.gw;
    var worst = new Float64Array(gw);
    var tones = new Uint8Array(gw * 3);
    for (var i = 0; i < gw; i += 1) worst[i] = Infinity;

    // The reach, not the travel: every offset the scroll AND the pointer can
    // put the picture at, which is the range the follower is clamped to —
    // vertically the travel widened by the slack, horizontally ±slack. That
    // rectangle is a superset of what can really happen (the pull's vector is
    // at most `slack` long, so its corners are unreachable), which keeps the
    // answer a bound. Under reduced motion there is one offset, the rest
    // frame, and that is all that is measured.
    var slack = geom.slack;
    var moving = wantsMotion() && (reachHi > reachLo || slack > 0);
    var n = moving ? o.steps || Math.max(48, Math.ceil((reachHi - reachLo) * 4) + 1) : 1;
    var nx = moving && slack > 0 ? o.stepsX || Math.ceil(slack * 4) + 1 : 1;
    restOffset();
    var restY = wantY;

    // Every pixel is one of `levels` tones, so contrast is asked of each
    // tone once — keyed on the bytes as written, so a token that resolved to
    // a fractional channel is simply asked once on first sight — rather than
    // of each pixel at each step.
    var toneContrast = {};

    var buf = new Uint8ClampedArray(gw * geom.gh * 4);
    var envScratch = {};
    for (var s = 0; s < n * nx; s += 1) {
      var sy = s % n;
      var sx = (s - sy) / n;
      var oy = n === 1 ? (moving ? reachLo : restY) : reachLo + ((reachHi - reachLo) * sy) / (n - 1);
      var ox = nx === 1 ? 0 : -slack + (2 * slack * sx) / (nx - 1);
      bScreen(buf, src, geom, presence, pal, p.grain, isDark, ox, oy, envScratch);
      for (var gy = rowFrom; gy < rowTo; gy += 1) {
        var base = gy * gw * 4;
        for (var gx = 0; gx < gw; gx += 1) {
          var bi = base + gx * 4;
          var key = (buf[bi] << 16) | (buf[bi + 1] << 8) | buf[bi + 2];
          var c = toneContrast[key];
          if (c === undefined) c = toneContrast[key] = bContrast(fg, [buf[bi], buf[bi + 1], buf[bi + 2]]);
          if (c < worst[gx]) {
            worst[gx] = c;
            tones[gx * 3] = buf[bi];
            tones[gx * 3 + 1] = buf[bi + 1];
            tones[gx * 3 + 2] = buf[bi + 2];
          }
        }
      }
    }

    return {
      columns: worst,
      tones: tones,
      cell: p.cell,
      offsetsCss: moving ? [reachLo * p.cell, reachHi * p.cell] : [restY * p.cell, restY * p.cell],
      offsetsXCss: nx > 1 ? [-slack * p.cell, slack * p.cell] : [0, 0],
      worstUpTo: function (xCss) {
        var to = Math.min(gw, Math.ceil(xCss / p.cell));
        var m = Infinity;
        for (var i2 = 0; i2 < to; i2 += 1) if (worst[i2] < m) m = worst[i2];
        return m;
      },
      worstBeyond: function (xCss) {
        var from = Math.max(0, Math.floor(xCss / p.cell));
        var m = Infinity;
        for (var i3 = from; i3 < gw; i3 += 1) if (worst[i3] < m) m = worst[i3];
        return m;
      },
    };
  }

  /* ---- the controller ------------------------------------------------- */

  return {
    ready: ready,
    canvas: canvas,
    stats: stats,
    warnings: warnings,
    params: p,
    // Paints the SCROLL offset for `prog`, with no pointer term, and moves the
    // follower there too — so the next input eases on from this frame rather
    // than from wherever the band was before a harness took it.
    render: function (prog) {
      if (!geom) return;
      shownX = 0;
      shownY = bOffset(geom, p.focus, p.direction, prog === undefined ? currentProgress() : bClamp(prog, 0, 1));
      paint(shownX, shownY);
    },
    set: function (next) {
      for (var kk in next) if (kk !== 'host' && kk !== 'art') p[kk] = next[kk];
      if (next.pivot && next.pivot.nodeType === 1) ro.observe(next.pivot);
      readPalette();
      rebuild();
      snap(true);
      syncPointer();
    },
    geometry: function () {
      if (!geom) return null;
      return {
        W: geom.W,
        H: geom.H,
        cell: geom.cell,
        cellDev: geom.cellDev,
        gw: geom.gw,
        gh: geom.gh,
        artScale: geom.artScale,
        artLeftCss: geom.x0 * geom.cell,
        artWidthCss: geom.aw * geom.cell,
        surplusCss: geom.surplus * geom.cell,
        travelCss: geom.travelCells * geom.cell,
        scrollBudgetCss: scrollSpan,
        panRate: scrollSpan > 0 ? (geom.travelCells * geom.cell) / scrollSpan : 0,
        rampFootCss: geom.rampFootCss,
        rampHeadCss: geom.rampHeadCss,
        wiggleCss: geom.slack * geom.cell,
        cropCss: Math.abs(geom.x0 - geom.xa) * geom.cell,
        pivotXCss: pivotX,
        pivotYCss: pivotY,
        pivotRCss: pivotR,
        dark: isDark,
      };
    },
    palette: function () {
      return pal ? pal.slice() : [];
    },
    envelope: envelope,
    destroy: function () {
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      clearTimeout(resizeTimer);
      io.disconnect();
      ro.disconnect();
      themeObserver.disconnect();
      removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      if (schemeMQ.removeEventListener) schemeMQ.removeEventListener('change', onScheme);
      if (reduceMQ.removeEventListener) reduceMQ.removeEventListener('change', onReduceChange);
      if (fineMQ.removeEventListener) fineMQ.removeEventListener('change', onFineChange);
      syncPointer(); // `destroyed` is set, so this removes the pointer listeners
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
