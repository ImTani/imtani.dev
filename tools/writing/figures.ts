/**
 * Drawn figures: diagrams made here rather than borrowed.
 *
 * Four of the export's pictures were somebody else's diagrams — a Wikipedia
 * plot, a stock infographic, a Has-A slide that had the relationship
 * backwards, and a looping GIF on a server we do not control. They are redrawn here as inline SVG, generated at BUILD time, so
 * the page still ships no framework and no runtime and every figure is in the
 * HTML before any script runs.
 *
 * SELECTED BY NAME. `DRAWN` is a registry shared by every article: an article
 * asks for one with `![](figure:<name> "caption")`, and build.ts puts the
 * figure on a mount like any picture, with the title as its figcaption. A name
 * that is not here is a build error. The devlog's six are here because the
 * devlog drew them; nothing about them is devlog-only except their subjects.
 *
 * WHAT A FIGURE IS MADE OF — the sine wave is the first to add a script, and
 * the coordinate grid will be the next:
 *
 *   - `width` is the size it is drawn at, in CSS px, and is the viewBox width.
 *     On desktop it renders 1:1; narrower, the SVG scales down with the column.
 *   - Every colour is a class, and every class is a rule in page.css that reads
 *     a palette token. Nothing in here is a hex value, so the figures take the
 *     light, dark and print palettes the same way the prose does.
 *   - Text is `<text>` in the page's own faces — the serif for the names of
 *     things, the mono label face for numbers — so it is real, selectable type.
 *     It never wobbles, and nothing with text in it sits crooked (PRODUCT.md,
 *     "How far the scrapbook goes").
 *   - Lines that are rules — axes, connectors — are drawn by `handLine`, the
 *     same pen as the day rule and the link underlines, baked here with fixed
 *     seeds so the committed page is byte-stable between builds. Lines that are
 *     DATA — the curve, the boxes — are exact, because a wobble in a measurement
 *     is a wrong measurement.
 *   - The wrapper carries `data-figure="<name>"`, and plots carry their mapping
 *     from data to drawing as `data-*` attributes. That is the whole hook for
 *     progressive enhancement: a figure adds a small inlined script that
 *     finds its wrapper by name, reads the mapping, and moves things. With the
 *     script absent the SVG is the complete figure, which is the rule.
 *
 * TEXT SIZE ON A PHONE. A viewBox scales its text with everything else, so a
 * label drawn at 14px on desktop is 7px on a 278px phone mount. The box
 * diagrams are drawn small enough (440 wide) that their 20px names come out at
 * 12px at a 360px viewport. The plot cannot be — its tick numbers would be 20px
 * on desktop — so its numbers are lifted by container queries in page.css
 * instead, into margins left wide enough to take them. The plot's key is HTML
 * beneath the SVG for the same reason: it wraps.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handLine, mulberry32 } from './hand.js';

const here = dirname(fileURLToPath(import.meta.url));

export interface DrawnFigure {
  /** For the wrapper's `data-figure` and the page.css hooks. */
  readonly name: string;
  /** Drawn width in CSS px; the viewBox width and the desktop render width. */
  readonly width: number;
  /** What a screen reader is told the picture shows. Not the caption again. */
  readonly label: string;
  /** The inside of the mount: the SVG and anything that goes with it. */
  readonly render: () => string;
  /**
   * Plain ES5 that makes the figure live, inlined after it inside the same
   * <figure>, where it finds its own wrapper from `document.currentScript`.
   * Optional, and never load-bearing: `render()` alone is the whole figure.
   */
  readonly script?: string;
  /**
   * Attribution a figure owes, printed once in the page's footer when the
   * figure is on the page. `note` is the HTML comment written above it there,
   * which is where the reason for the credit is said.
   */
  readonly credit?: { readonly html: string; readonly note: string };
}

// ------------------------------------------------------------ the shared pen ---

const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * A ruled line from (x1, y1) to (x2, y2), drawn by hand. Axis-aligned only:
 * these are diagrams, and a diagonal is not a thing any of them needs.
 *
 * The day rule's pen, held a little lighter: a connector a few dozen pixels
 * long has no room for the rule's 16 and 40px tapers, which would leave it all
 * taper and no line.
 */
function ruled(x1: number, y1: number, x2: number, y2: number, seed: number, cls: string): string {
  const vertical = x1 === x2;
  if (!vertical && y1 !== y2) throw new Error('ruled(): lines are horizontal or vertical');
  const len = vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1);
  const d = handLine({
    rnd: mulberry32(seed),
    len,
    wobble: 0.9,
    weight: 1.5,
    taperIn: Math.min(6, len / 4),
    taperOut: Math.min(10, len / 4),
    taperFloor: 0.35,
    xDigits: 1,
  });
  const at = vertical
    ? `translate(${f(x1)} ${f(Math.min(y1, y2))}) rotate(90)`
    : `translate(${f(Math.min(x1, x2))} ${f(y1)})`;
  return `<path class="${cls}" transform="${at}" d="${d}"/>`;
}

function svgOpen(fig: DrawnFigure, height: number): string {
  return (
    `<svg viewBox="0 0 ${fig.width} ${height}" width="${fig.width}" height="${height}"` +
    ` role="img" aria-label="${fig.label}">`
  );
}

// ------------------------------------------------ 1. smooth interpolation ---

/**
 * Seven samples of a wave, the curve through them, and — faint, behind it —
 * the staircase a camera follows when nobody interpolates.
 *
 * The samples are sin(x) at x = 0…6, which is what the borrowed plot showed.
 * The curve is a natural cubic spline through them, computed here and written
 * out as one Bézier per interval: an honest interpolation of the seven points,
 * not sin(x) drawn again, because the passage is about inferring the in-between
 * from what you have.
 *
 * The staircase holds each sample until the next one arrives. That is what "no
 * interpolation" means for a camera reading a physics body: the position is
 * only known at each tick, so the camera sits still and then jumps — the jitter
 * in the next clip. Straight lines between the points would have been the
 * easier drawing and the wrong one: joining the dots IS interpolation, just
 * linear.
 */
const SAMPLES = [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: Math.sin(x) }));

/** Second derivatives of the natural cubic spline through `SAMPLES` (h = 1). */
function splineMoments(ys: readonly number[]): number[] {
  const n = ys.length - 1;
  const m = new Array<number>(n + 1).fill(0);
  // Thomas algorithm on M[i-1] + 4M[i] + M[i+1] = 6(y[i+1] - 2y[i] + y[i-1]).
  const c: number[] = [];
  const d: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const rhs = 6 * ((ys[i + 1] ?? 0) - 2 * (ys[i] ?? 0) + (ys[i - 1] ?? 0));
    const denom = 4 - (i > 1 ? (c[i - 2] ?? 0) : 0);
    c.push(1 / denom);
    d.push((rhs - (i > 1 ? (d[i - 2] ?? 0) : 0)) / denom);
  }
  for (let i = n - 1; i >= 1; i -= 1) {
    m[i] = (d[i - 1] ?? 0) - (c[i - 1] ?? 0) * (m[i + 1] ?? 0);
  }
  return m;
}

const PLOT = {
  width: 560,
  height: 284,
  // Data -> drawing. x 0..6 across, y -1..1 up.
  x0: 72,
  xUnit: 76,
  y0: 128,
  yUnit: 92,
  axisX: 56,
  axisY: 238,
} as const;

const px = (x: number): number => PLOT.x0 + x * PLOT.xUnit;
const py = (y: number): number => PLOT.y0 - y * PLOT.yUnit;

const interpolation: DrawnFigure = {
  name: 'interpolation',
  width: PLOT.width,
  label:
    'A graph of seven data points at whole-number steps from 0 to 6, rising from 0 to about 0.9 and ' +
    'falling to about minus 1. A smooth curve passes through every point. Behind it, faintly, a ' +
    'staircase holds each point’s value until the next one: the path a camera follows without ' +
    'interpolation.',
  render() {
    const ys = SAMPLES.map((s) => s.y);
    const m = splineMoments(ys);

    let curve = `M${f(px(0))} ${f(py(ys[0] ?? 0))}`;
    for (let i = 0; i < SAMPLES.length - 1; i += 1) {
      const ya = ys[i] ?? 0;
      const yb = ys[i + 1] ?? 0;
      const ma = m[i] ?? 0;
      const mb = m[i + 1] ?? 0;
      const slopeA = yb - ya - (2 * ma + mb) / 6;
      const slopeB = yb - ya + (ma + 2 * mb) / 6;
      curve +=
        `C${f(px(i + 1 / 3))} ${f(py(ya + slopeA / 3))} ` +
        `${f(px(i + 2 / 3))} ${f(py(yb - slopeB / 3))} ` +
        `${f(px(i + 1))} ${f(py(yb))}`;
    }

    let held = `M${f(px(0))} ${f(py(ys[0] ?? 0))}`;
    for (let i = 1; i < SAMPLES.length; i += 1) {
      held += `H${f(px(i))}V${f(py(ys[i] ?? 0))}`;
    }

    const xTicks = SAMPLES.map(
      (s) =>
        `<line class="fd-tick" x1="${f(px(s.x))}" y1="${PLOT.axisY}" x2="${f(px(s.x))}" y2="${PLOT.axisY + 6}"/>` +
        `<text class="fd-num fd-num-x" x="${f(px(s.x))}" y="${PLOT.axisY + 12}">${s.x}</text>`,
    ).join('');
    const yTicks = [1, 0, -1]
      .map(
        (v) =>
          `<line class="fd-tick" x1="${PLOT.axisX - 6}" y1="${f(py(v))}" x2="${PLOT.axisX}" y2="${f(py(v))}"/>` +
          `<text class="fd-num fd-num-y" x="${PLOT.axisX - 12}" y="${f(py(v))}">${v < 0 ? '−' : ''}${Math.abs(v)}</text>`,
      )
      .join('');

    const points = SAMPLES.map(
      (s) => `<circle cx="${f(px(s.x))}" cy="${f(py(s.y))}" r="5.5"/>`,
    ).join('');

    const right = px(6) + 14;
    const svg =
      svgOpen(this, PLOT.height) +
      `<g class="fd-plot" data-x0="${PLOT.x0}" data-x-unit="${PLOT.xUnit}" data-y0="${PLOT.y0}" data-y-unit="${PLOT.yUnit}">` +
      `<line class="fd-zero" x1="${PLOT.axisX}" y1="${f(py(0))}" x2="${f(right)}" y2="${f(py(0))}"/>` +
      ruled(PLOT.axisX, py(1) - 16, PLOT.axisX, PLOT.axisY, 0x5eed01, 'fd-pen') +
      ruled(PLOT.axisX, PLOT.axisY, right, PLOT.axisY, 0x5eed02, 'fd-pen') +
      xTicks +
      yTicks +
      `<path class="fd-held" d="${held}"/>` +
      `<path class="fd-curve" d="${curve}"/>` +
      `<g class="fd-points">${points}</g>` +
      '</g></svg>';

    // The key is HTML, not SVG text, so that it wraps on a phone rather than
    // shrinking with the drawing. Its swatches are drawn with the same classes
    // as the marks they stand for, so they cannot disagree on colour.
    const swatch = (body: string): string =>
      `<svg class="fd-swatch" viewBox="0 0 28 14" width="28" height="14" aria-hidden="true" focusable="false">${body}</svg>`;
    const key =
      '<ul class="fd-key">' +
      `<li>${swatch('<g class="fd-points"><circle cx="14" cy="7" r="4.5"/></g>')}data points</li>` +
      `<li>${swatch('<path class="fd-curve" d="M2 10C9 10 9 4 14 4S20 10 26 10"/>')}smooth interpolation</li>` +
      `<li>${swatch('<path class="fd-held" d="M2 11H10V3H18V9H26"/>')}no interpolation</li>` +
      '</ul>';

    return svg + key;
  },
};

// ------------------------------------------- 2 and 3. is a, and has a ---

/**
 * A PAIR, AND THE PAIR IS THE LESSON. Inheritance and composition are drawn
 * with the same box, the same type and the same scale, so the only thing that
 * differs between the two figures is their shape: a tree for "is a", where Car
 * hangs beneath Vehicle, and containment for "has a", where the Pages are
 * physically inside the Book. A reader who looks from one to the other sees the
 * difference before reading either caption.
 *
 * The borrowed composition slide drew an arrow from Page to Book labelled
 * Has-A, which says a Page has a Book. Containment cannot be read backwards.
 *
 * Every name is a word from Tani's own paragraphs: Vehicle, Car, Motorcycle;
 * Book, Pages.
 */
const BOX_H = 44;
const PAIR_W = 440;

function box(cx: number, top: number, w: number, name: string): string {
  return (
    `<rect class="fd-box" x="${f(cx - w / 2)}" y="${top}" width="${w}" height="${BOX_H}"/>` +
    `<text class="fd-name" x="${f(cx)}" y="${top + BOX_H / 2}">${name}</text>`
  );
}

const inheritance: DrawnFigure = {
  name: 'inheritance',
  width: PAIR_W,
  label:
    'A tree. Vehicle sits at the top; Car and Motorcycle sit beneath it, each joined to Vehicle ' +
    'by a line marked “is a”. A Car is a Vehicle, and a Motorcycle is a Vehicle.',
  render() {
    const parent = { cx: 220, top: 14 };
    const kids = [
      { cx: 110, name: 'Car' },
      { cx: 330, name: 'Motorcycle' },
    ];
    const kidTop = 146;
    const bus = 98;
    const w = 150;
    const under = parent.top + BOX_H;

    // The arrowhead is at the parent's end, because the sentence runs from the
    // child up: a Car is a Vehicle.
    const head =
      `<path class="fd-head" d="M${parent.cx - 6} ${under + 9}L${parent.cx} ${under + 1}` +
      `L${parent.cx + 6} ${under + 9}"/>`;

    return (
      svgOpen(this, kidTop + BOX_H + 14) +
      ruled(parent.cx, under + 1, parent.cx, bus, 0x1a4e01, 'fd-pen') +
      ruled(kids[0]?.cx ?? 0, bus, kids[1]?.cx ?? 0, bus, 0x1a4e02, 'fd-pen') +
      kids
        .map(
          (k, i) =>
            ruled(k.cx, bus, k.cx, kidTop, 0x1a4e03 + i, 'fd-pen') +
            `<text class="fd-rel" x="${k.cx + 10}" y="${(bus + kidTop) / 2 + 1}">is a</text>`,
        )
        .join('') +
      head +
      box(parent.cx, parent.top, w, 'Vehicle') +
      kids.map((k) => box(k.cx, kidTop, w, k.name)).join('') +
      '</svg>'
    );
  },
};

const composition: DrawnFigure = {
  name: 'composition',
  width: PAIR_W,
  label:
    'A large box labelled Book, marked “has a”, with three smaller boxes labelled Page drawn ' +
    'inside it. The Book has Pages; it is made up of them.',
  render() {
    const outer = { x: 14, y: 14, w: PAIR_W - 28 };
    const pageW = 112;
    const gap = 16;
    const rowW = 3 * pageW + 2 * gap;
    const rowTop = outer.y + 58;
    const outerH = rowTop - outer.y + BOX_H + 22;
    const first = PAIR_W / 2 - rowW / 2 + pageW / 2;

    return (
      svgOpen(this, outer.y + outerH + 14) +
      `<rect class="fd-box" x="${outer.x}" y="${outer.y}" width="${outer.w}" height="${outerH}"/>` +
      // "has a" runs on from the Book's name in the same muted italic as the
      // tree's "is a", so the two figures say their relationship the same way
      // and only the shape differs. A tspan, so it sits after the word however
      // wide the serif sets it.
      `<text class="fd-name fd-name-head" x="${outer.x + 18}" y="${outer.y + 29}">` +
      'Book<tspan class="fd-rel-run" dx="10">has a</tspan></text>' +
      [0, 1, 2].map((i) => box(first + i * (pageW + gap), rowTop, pageW, 'Page')).join('') +
      '</svg>'
    );
  },
};

// ------------------------------------------------------- the sine wave ---

/**
 * A point going round a circle, and its height drawn out against time.
 *
 * It replaces a GIF on somebody else's server, which played for ever whether
 * anybody was looking or not and could only be stopped by taking it off the
 * page. This one is a still frame first: the point a third of the way round,
 * the wave traced as far as the point has gone, the height carried across by a
 * dashed line. That frame is correct on its own, prints, and is all a reader
 * with no JavaScript or reduced motion gets.
 *
 * figure-sine.js, inlined after it, makes it go: the point travels while the
 * figure is on screen and the page's motion is on, and the reader can take hold
 * of it — drag it, or tab to it and use the arrow keys.
 *
 * THE ANGLE ON THE CIRCLE IS THE POSITION ON THE TIME AXIS. One turn of the
 * circle is one length of the axis, so the wave under the point is exactly the
 * path its height has taken so far, and when the point comes round again the
 * trace starts again. That is the passage's own idea — `time` is "the fuel
 * that keeps it cycling" — drawn rather than said. The full cycle sits under
 * the trace, faint, so the restart is a pen going back to the start of a line
 * that is already there rather than a picture blinking out.
 *
 * Both halves share one vertical scale: the circle's radius is the wave's
 * amplitude, which is what lets the projection be a horizontal line.
 */
const SINE = {
  width: 560,
  height: 252,
  cx: 112,
  cy: 112,
  r: 80,
  x0: 248,
  // One turn across 282px: 2π radians.
  xUnit: 282 / (2 * Math.PI),
  // The still frame: a third of a turn.
  angle: (2 * Math.PI) / 3,
  arcR: 22,
} as const;

/** sin over [from, to] as one Bézier per eighth of a turn, from its own slopes. */
function sinePath(from: number, to: number): string {
  const sx = (t: number): number => SINE.x0 + t * SINE.xUnit;
  const sy = (v: number): number => SINE.cy - v * SINE.r;
  // Control points are in data units along x, so the slope's run is h/3 too.
  const steps = Math.max(1, Math.round((to - from) / (Math.PI / 4)));
  const h = (to - from) / steps;
  let d = `M${f(sx(from))} ${f(sy(Math.sin(from)))}`;
  for (let i = 0; i < steps; i += 1) {
    const a = from + i * h;
    const b = a + h;
    d +=
      `C${f(sx(a + h / 3))} ${f(sy(Math.sin(a) + (h / 3) * Math.cos(a)))} ` +
      `${f(sx(b - h / 3))} ${f(sy(Math.sin(b) - (h / 3) * Math.cos(b)))} ` +
      `${f(sx(b))} ${f(sy(Math.sin(b)))}`;
  }
  return d;
}

/** The readouts, written the same way here and in figure-sine.js. */
function degrees(angle: number): number {
  return Math.round((angle * 180) / Math.PI) % 360;
}

function height(angle: number): string {
  const v = Math.sin(angle);
  return `${v < -0.005 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
}

const sine: DrawnFigure = {
  name: 'sine',
  width: SINE.width,
  label:
    'A point on a circle, a third of the way round, with its height carried across by a ' +
    'dashed line to a sine wave drawn against time. One turn of the circle draws one cycle ' +
    'of the wave.',
  script: readFileSync(join(here, 'figure-sine.js'), 'utf8'),
  render() {
    const { cx, cy, r, x0, xUnit, angle, arcR } = SINE;
    const turnEnd = x0 + 2 * Math.PI * xUnit;
    const px = cx + r * Math.cos(angle);
    const py = cy - r * Math.sin(angle);
    const tx = x0 + angle * xUnit;
    const arcLen = 2 * Math.PI * arcR;
    const wave = sinePath(0, 2 * Math.PI);
    const quarters = [1, 2, 3, 4]
      .map((q) => {
        const x = f(x0 + (q * Math.PI * xUnit) / 2);
        return `<line class="fd-tick" x1="${x}" y1="${cy}" x2="${x}" y2="${cy + 6}"/>`;
      })
      .join('');
    const yTicks = [1, 0, -1]
      .map(
        (v) =>
          `<line class="fd-tick" x1="${x0 - 6}" y1="${cy - v * r}" x2="${x0}" y2="${cy - v * r}"/>` +
          `<text class="fd-num fd-num-y" x="${x0 - 12}" y="${cy - v * r}">${v < 0 ? '−' : ''}${Math.abs(v)}</text>`,
      )
      .join('');
    const at = (cls: string, x: number, y: number, rr: number): string =>
      `<circle class="${cls}" cx="${f(x)}" cy="${f(y)}" r="${rr}"/>`;

    return (
      svgOpen(this, SINE.height) +
      `<defs><clipPath id="fd-sine-trace"><rect x="${x0 - 2}" y="0"` +
      ` width="${f(angle * xUnit + 2)}" height="${SINE.height}"/></clipPath></defs>` +
      `<g class="fd-sine" data-cx="${cx}" data-cy="${cy}" data-r="${r}" data-x0="${x0}"` +
      ` data-x-unit="${f(xUnit)}" data-angle="${f(angle)}" data-arc-r="${arcR}">` +
      // The ground: the zero line through the circle's centre and across to the
      // axis, the circle itself, and the two ruled axes.
      `<line class="fd-zero" x1="${cx - r - 10}" y1="${cy}" x2="${x0}" y2="${cy}"/>` +
      `<circle class="fd-circle" cx="${cx}" cy="${cy}" r="${r}"/>` +
      ruled(x0, cy - r - 14, x0, cy + r + 14, 0x5111e1, 'fd-pen') +
      ruled(x0, cy, turnEnd + 14, cy, 0x5111e2, 'fd-pen') +
      `<path class="fd-head" d="M${f(turnEnd + 8)} ${cy - 5}L${f(turnEnd + 14)} ${cy}L${f(turnEnd + 8)} ${cy + 5}"/>` +
      quarters +
      `<g aria-hidden="true">${yTicks}` +
      `<text class="fd-num fd-num-end" x="${f(turnEnd + 14)}" y="${cy - 12}">time</text></g>` +
      // The wave: one whole cycle faint, and the part traced so far over it.
      `<path class="fd-track" d="${wave}"/>` +
      `<path class="fd-curve" clip-path="url(#fd-sine-trace)" d="${wave}"/>` +
      // The angle: an arc from the zero line round to the radius. A circle
      // flipped upright so its dash runs anticlockwise the way the angle does,
      // and revealed by its dash offset — one number to move it.
      `<circle class="fd-arc" transform="translate(${cx} ${cy}) scale(1 -1)" r="${arcR}"` +
      ` stroke-dasharray="${f(arcLen)} ${f(arcLen)}" stroke-dashoffset="${f(arcLen - angle * arcR)}"/>` +
      `<line class="fd-radius" x1="${cx}" y1="${cy}" x2="${f(px)}" y2="${f(py)}"/>` +
      `<line class="fd-proj" x1="${f(px)}" y1="${f(py)}" x2="${f(tx)}" y2="${f(py)}"/>` +
      at('fd-tip', tx, py, 4) +
      // The handle. The hit area is invisible and inert until the script
      // switches the figure live; the ring is its focus indicator.
      '<g class="fd-handle">' +
      at('fd-hit', px, py, 22) +
      at('fd-ring', px, py, 12) +
      `<g class="fd-points">${at('fd-dot', px, py, 7)}</g>` +
      '</g>' +
      '<g aria-hidden="true">' +
      `<text class="fd-num fd-read fd-read-angle" x="${cx}" y="${cy + r + 22}">angle ${degrees(angle)}°</text>` +
      `<text class="fd-num fd-read fd-read-height" x="${f(x0 + Math.PI * xUnit)}" y="${cy + r + 22}">height ${height(angle)}</text>` +
      '</g></g></svg>'
    );
  },
};

// ------------------------------------------------- the coordinate grid ---

/**
 * One grid, drawn twice: an explorer the reader moves a point round, and a
 * demonstration that walks a point out to (4, 3) — "the point (4, 3) on the
 * grid above" in the paragraph between them.
 *
 * ±10 on both axes, because the prose's other example is (4, −8). A unit grid,
 * every fifth line a step stronger so a coordinate can be counted rather than
 * guessed. The axes are ruled by hand like every rule on the page; the grid is
 * exact, because it is the measurement.
 *
 * THE GODOT SWITCH. The paragraph above the second grid says Godot flips its
 * Y-axis, and the switch beside the first grid shows it. The mode is one class
 * on the root element — `fd-godot-y` — so both grids follow it without either
 * script knowing the other exists, and every visual consequence of it is CSS:
 * the Y arrow turns over, the Y-axis numbers change sign, the Y label moves
 * to the bottom. Both sets of numbers and both Y labels are in the markup, and
 * the stylesheet shows one or the other, in one frame. What the scripts do is
 * the one thing that is the lesson: the point stays exactly where it is on
 * screen and its y value changes sign.
 *
 * Without JavaScript neither grid has a switch, the root never gets the class,
 * and both are ordinary Cartesian planes — the explorer's point at (−3, 2), the
 * demonstration's at (4, 3), each with its projections to the axes.
 */
const GRID = {
  size: 460,
  o: 230,
  c: 20,
  n: 10,
} as const;

const minus = (v: number): string => (v < 0 ? `−${-v}` : String(v));

/** "(−3, 2)" — the readout, in the page's own minus sign. */
function coordinate(x: number, y: number): string {
  return `(${minus(x)}, ${minus(y)})`;
}

/**
 * Where the readout sits beside the point: up and to the right, unless that
 * would run it off the grid. figure-grid.js makes the same choice.
 */
function readoutAt(gx: number, gy: number): { x: number; y: number; anchor: string; base: string } {
  const px = GRID.o + gx * GRID.c;
  const py = GRID.o - gy * GRID.c;
  const right = gx < 6;
  const above = gy < 8;
  return {
    x: right ? px + 12 : px - 12,
    y: above ? py - 12 : py + 14,
    anchor: right ? 'start' : 'end',
    base: above ? 'auto' : 'hanging',
  };
}

const quip = ((): string => {
  const text = JSON.parse(readFileSync(join(here, 'figure-text.json'), 'utf8')) as {
    grid?: { godotQuip?: string };
  };
  return (text.grid?.godotQuip ?? '').trim();
})();

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The icon's own file carries its licence; the page gets the drawing only. */
const godotIcon = readFileSync(join(here, 'godot-icon.svg'), 'utf8')
  .replace(/<!--[\s\S]*?-->\s*/g, '')
  .replace('<svg ', '<svg class="fd-godot-icon" aria-hidden="true" focusable="false" ')
  .trim();

const gridScript = readFileSync(join(here, 'figure-grid.js'), 'utf8');

interface GridOptions {
  readonly name: string;
  readonly role: 'explore' | 'demo';
  readonly start: { readonly x: number; readonly y: number };
  readonly label: string;
}

function gridFigure(opts: GridOptions): DrawnFigure {
  return {
    name: opts.name,
    width: GRID.size,
    label: opts.label,
    script: gridScript,
    // Only the explorer draws the switch, so only the explorer carries the logo.
    ...(opts.role === 'explore' ? { credit: GODOT_CREDIT } : {}),
    render() {
      const { size, o, c, n } = GRID;
      const lo = o - n * c;
      const hi = o + n * c;
      let minor = '';
      let major = '';
      for (let i = -n; i <= n; i += 1) {
        if (i === 0) continue;
        const at = o + i * c;
        const d = `M${at} ${lo}V${hi}M${lo} ${at}H${hi}`;
        if (i % 5 === 0) major += d;
        else minor += d;
      }

      const xNums = [-10, -5, 5, 10]
        .map((v) => `<text class="fd-gnum fd-gnum-x" x="${o + v * c}" y="${o + 6}">${minus(v)}</text>`)
        .join('');
      // Two sets of Y numbers at the same places: the Cartesian set, and the
      // Godot set with every sign turned over. The stylesheet shows one.
      const yNums = (sign: number, cls: string): string =>
        `<g class="${cls}">` +
        [-10, -5, 5, 10]
          .map((v) => `<text class="fd-gnum fd-gnum-y" x="${o - 10}" y="${o - v * c}">${minus(sign * v)}</text>`)
          .join('') +
        '</g>';

      const { x, y } = opts.start;
      const px = o + x * c;
      const py = o - y * c;
      const read = readoutAt(x, y);
      const dot = (cls: string, r: number): string => `<circle class="${cls}" cx="0" cy="0" r="${r}"/>`;

      const svg =
        svgOpen(this, size) +
        `<g class="fd-grid" data-o="${o}" data-c="${c}" data-n="${n}" data-x="${x}" data-y="${y}"` +
        ` data-role="${opts.role}">` +
        `<path class="fd-gline" d="${minor}"/>` +
        `<path class="fd-gline fd-gline-major" d="${major}"/>` +
        ruled(lo - 8, o, hi + 8, o, 0x6e1d01, 'fd-pen') +
        ruled(o, lo - 8, o, hi + 8, 0x6e1d02, 'fd-pen') +
        `<path class="fd-head" d="M${hi + 2} ${o - 5}L${hi + 8} ${o}L${hi + 2} ${o + 5}"/>` +
        // The Y arrow is drawn about the origin so that turning it over is one
        // scale with nothing to work out — see `.fd-yhead` in page.css.
        `<g transform="translate(${o} ${o})"><path class="fd-head fd-yhead"` +
        ` d="M-5 ${-(n * c) - 2}L0 ${-(n * c) - 8}L5 ${-(n * c) - 2}"/></g>` +
        '<g aria-hidden="true">' +
        xNums +
        yNums(1, 'fd-yset fd-yset-up') +
        yNums(-1, 'fd-yset fd-yset-godot') +
        `<text class="fd-gnum fd-gnum-0" x="${o - 6}" y="${o + 6}">0</text>` +
        `<text class="fd-gaxis fd-gaxis-x" x="${hi + 6}" y="${o - 9}">X</text>` +
        `<text class="fd-gaxis fd-gaxis-y fd-yset-up" x="${o + 9}" y="${lo - 6}">Y</text>` +
        `<text class="fd-gaxis fd-gaxis-yd fd-yset-godot" x="${o + 9}" y="${hi + 6}">Y</text>` +
        '</g>' +
        // The projections: down to the X-axis and across to the Y-axis.
        `<line class="fd-gproj fd-gproj-x" x1="${px}" y1="${py}" x2="${px}" y2="${o}"/>` +
        `<line class="fd-gproj fd-gproj-y" x1="${px}" y1="${py}" x2="${o}" y2="${py}"/>` +
        `<g class="fd-handle" transform="translate(${px} ${py})">` +
        dot('fd-hit', 22) +
        dot('fd-ring', 12) +
        `<g class="fd-points">${dot('fd-dot', 7)}</g>` +
        '</g>' +
        `<text class="fd-gread" aria-hidden="true" x="${read.x}" y="${read.y}" text-anchor="${read.anchor}"` +
        ` dominant-baseline="${read.base}">${coordinate(x, y)}</text>` +
        '</g></svg>';

      // The demonstration says which axis it is on when it is not the usual
      // one, since the switch that changed it is a screen away. HTML laid over
      // the grid's empty corner rather than SVG text, so it keeps its size on a
      // phone instead of shrinking with the drawing; see `.fd-gtag`.
      if (opts.role === 'demo') return `${svg}<span class="fd-gtag">Godot’s <span class="fd-nowrap">Y-axis</span></span>`;

      // The switch. Hidden until the script runs, because without it the
      // switch would be a button that does nothing. A small control in the
      // mount's top-right corner when the mount is wide enough that it cannot
      // touch the grid, under the grid when it is not — see the switch rules
      // in page.css. The grid itself never moves for it: it is centred on its
      // mount exactly as the demonstration's grid is.
      //
      // Its accessible name is his quip followed by what it does, so that the
      // words on screen are the start of the name (voice control users say what
      // they see) and the plain description is never lost to the joke. With no
      // quip it is the plain description alone.
      return (
        svg +
        '<div class="fd-gridbar" hidden>' +
        '<button class="fd-switch" type="button" aria-pressed="false">' +
        '<span class="fd-switch-track" aria-hidden="true"><span class="fd-switch-knob"></span></span>' +
        godotIcon +
        (quip ? `<span class="fd-quip">${esc(quip)}</span>` : '') +
        `<span class="vh">${quip ? ' — ' : ''}Use Godot’s Y-axis</span>` +
        '</button>' +
        '</div>'
      );
    },
  };
}

/**
 * The credit the Godot logo needs, for the page's footer. CC BY 4.0 asks for
 * the author, the licence and whether it was changed — it was: recoloured to
 * the page's ink.
 */
const GODOT_CREDIT = {
  html:
    'Godot logo by Andrea Calabró, ' +
    '<a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, recoloured.',
  note: `
          The one credit the page owes: the Godot logo on the coordinate grid's
          switch is CC BY 4.0, which asks for attribution and for changes to be
          said. Here rather than beside the switch, which is a control and not a
          place to read small print. Always present, though the switch is not
          without JavaScript: the logo's markup ships in the page either way,
          and a line that appears and disappears with a script is more
          machinery than a credit is worth. Its wording lives in figures.ts,
          next to the drawing it credits.
        `,
} as const;

const gridExplore = gridFigure({
  name: 'grid-explore',
  role: 'explore',
  start: { x: -3, y: 2 },
  label:
    'A coordinate grid running from minus 10 to 10 on both axes: the X-axis across and the Y-axis ' +
    'up, crossing at the origin, 0. A point sits at (−3, 2), three units left and two up, with ' +
    'dashed lines down to the X-axis and across to the Y-axis.',
});

const gridDemo = gridFigure({
  name: 'grid-demo',
  role: 'demo',
  start: { x: 4, y: 3 },
  label:
    'The same grid with a point at (4, 3): four units right along the X-axis and three up, with ' +
    'dashed lines to both axes.',
});

/** Every drawn figure, by the name an article asks for it with. */
export const DRAWN: Readonly<Record<string, DrawnFigure>> = Object.fromEntries(
  [interpolation, sine, gridExplore, gridDemo, inheritance, composition].map((fig) => [fig.name, fig]),
);
