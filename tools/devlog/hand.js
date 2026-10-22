/* Rise&Shine devlog — the hand that draws every line on this page.
 *
 * There is one generator and there are three lines: the wings of the day rule,
 * the rule above the masthead's award block, and the tile the link underlines
 * repeat. Two implementations would drift — the wobble would be a little
 * different under the links than it is across the divider, and the page would
 * stop reading as one person's pen. So the geometry lives here and the three
 * callers pass their own numbers.
 *
 * TWO CONSUMERS, TWO ROUTES IN. `build.ts` imports this as a module, at build
 * time, to bake the link tiles into the stylesheet. `drawn-rules.js` needs the
 * same functions in the browser, where there are no modules — the whole page is
 * one HTML file with its scripts inlined — so `build.ts` also reads this file as
 * text, strips the `export ` keywords off the front of the declarations, and
 * emits it inside the same <script> as `drawn-rules.js`. That is why every
 * `export` here starts at column zero and why this file is plain ES5-shaped
 * JavaScript with no types in it: it has to survive being pasted into a
 * <script> tag verbatim. `hand.d.ts` beside it is what the compiler reads.
 *
 * THE LINE IS A FILLED OUTLINE, NOT A STROKE. A stroke has exactly one width,
 * and the entire point of a drawn line is that a real one does not: it thickens
 * where the hand pressed and thins where it did not. So `handLine` returns a
 * closed path — the top edge out, the bottom edge back — and the caller fills
 * it.
 */

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/* `edge` of zero means "no taper here", not "taper over nothing": x/0 is
   Infinity for x > 0 and NaN at x = 0, and a NaN weight silently drops a whole
   end of a path. The head rule's two ends at the gutter are cut rather than
   lifted, so this case is reached on purpose. */
export function smoothstep(edge, x) {
  if (!(edge > 0)) return 1;
  var t = clamp(x / edge, 0, 1);
  return t * t * (3 - 2 * t);
}

/* mulberry32. Thirty-two bits of state, no dependency, and the same sequence
   for the same seed — which is what makes the geometry reproducible within a
   single load even though the seed itself need not be. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* A smooth band-limited wander: random stops, smoothstepped between. One of
   these at a low n is where the line sits, one at a high n is the tremor, one in
   between is pressure. Three frequencies is what stops it reading as a sine wave
   on one hand or as noise on the other.
 *
 * `cyclic` is what makes a repeating tile possible. Smoothstep has zero slope at
 * both ends, so every stop is already a stationary point; wrapping the index
 * therefore makes the function seamless in value AND in slope at u=1, with no
 * blending window and no visible join. It costs one modulo. Without it a tile
 * would show a kink every 97 pixels, which is the one artefact that would give
 * the whole treatment away as a repeat. */
export function wander(rnd, n, cyclic) {
  var a = [];
  var m = cyclic ? n : n + 2;
  for (var i = 0; i < m; i += 1) a.push(rnd() * 2 - 1);
  return function (u) {
    var t = u * n;
    var i = Math.floor(t);
    var f = t - i;
    var s = f * f * (3 - 2 * f);
    var p = cyclic ? a[i % n] : a[i];
    var q = cyclic ? a[(i + 1) % n] : a[i + 1];
    return p + (q - p) * s;
  };
}

/* One drawn line, as an SVG path `d` string running from (0, y) to (len, y).
 *
 * The defaults are the day rule's wing, which is where all of this was tuned:
 * Tani picked 1.4px of wobble and 1.65px of weight at reference/banner.html by
 * dragging sliders against real paragraphs at the real column width. They are
 * not derived from anything. Every other line on the page is stated as a
 * departure from them, so that the departures are the thing you read in the
 * source rather than three unrelated sets of magic numbers.
 *
 * ONE CURVE, SAMPLED TWICE. `span` and `x0` are what let two separate elements
 * carry two pieces of the SAME line. The three wanders are functions of u over
 * the whole span, so two calls with the same seed, the same span and the same
 * stop counts build byte-identical wanders and then read different windows of
 * them: the ink leaving one element at x0+len picks up in the other at its own
 * x0, still bowing the same way, because it is the same curve. Drawing the two
 * halves independently — same parameters, different seeds, or the same seed over
 * two short spans — gives two lines that agree on average and part company at
 * the gutter, which is the one thing that would give the join away.
 *
 *   len        the run of THIS piece, in px
 *   span       the run of the whole line the piece belongs to; defaults to len,
 *              which is the ordinary case of a line that is all of itself
 *   x0         where this piece starts along that span
 *   step       sampling interval; the run is divided into whole steps, so both
 *              ends are always hit exactly — which a `for (x = 0; x <= len)`
 *              loop does not do when len is not a multiple of step, and a tile
 *              that misses its own right-hand edge does not repeat seamlessly
 *   wobble     px of tremor away from true; drift and tremor are multiples of it
 *   weight     px, the nominal width of the line
 *   driftN     stops in the low-frequency wander — where the line sits
 *   tremorN    stops in the high-frequency one — the shake in the hand
 *   pressN     stops in the pressure wander — how hard the pen is bearing down
 *   taperIn    px over which the pen touches down at the start
 *   taperOut   px over which it lifts at the end
 *   taperFloor how much of the weight survives outside the tapers (0 = a point)
 *   cyclic     a tile rather than a line: no tapers, and the wanders wrap
 *   y          the centre line, in the caller's coordinates
 *   xDigits    decimals kept on x; 0 where the step is a whole number, which is
 *              most of the file size of a tile
 */
export function handLine(opts) {
  var len = opts.len;
  var span = opts.span === undefined ? len : opts.span;
  var x0 = opts.x0 === undefined ? 0 : opts.x0;
  var step = opts.step === undefined ? 2 : opts.step;
  var wobble = opts.wobble === undefined ? 1.4 : opts.wobble;
  var weight = opts.weight === undefined ? 1.65 : opts.weight;
  var driftN = opts.driftN === undefined ? 2 : opts.driftN;
  var driftAmp = opts.driftAmp === undefined ? 1.35 : opts.driftAmp;
  var tremorN = opts.tremorN === undefined ? 7 : opts.tremorN;
  var tremorAmp = opts.tremorAmp === undefined ? 0.55 : opts.tremorAmp;
  var pressN = opts.pressN === undefined ? 5 : opts.pressN;
  var taperIn = opts.taperIn === undefined ? 16 : opts.taperIn;
  var taperOut = opts.taperOut === undefined ? 40 : opts.taperOut;
  var taperFloor = opts.taperFloor === undefined ? 0.12 : opts.taperFloor;
  var minWeight = opts.minWeight === undefined ? 0.22 : opts.minWeight;
  var cyclic = opts.cyclic === true;
  var y0 = opts.y === undefined ? 0 : opts.y;
  var xDigits = opts.xDigits === undefined ? 0 : opts.xDigits;

  var rnd = opts.rnd;
  var drift = wander(rnd, driftN, cyclic);
  var tremor = wander(rnd, tremorN, cyclic);
  var press = wander(rnd, pressN, cyclic);

  var n = Math.max(1, Math.ceil(len / step));
  var top = [];
  var bot = [];
  for (var i = 0; i <= n; i += 1) {
    var x = (len * i) / n;
    var u = (x0 + x) / span;
    var y = y0 + drift(u) * wobble * driftAmp + tremor(u) * wobble * tremorAmp;
    var taper = cyclic ? 1 : smoothstep(taperIn, x) * smoothstep(taperOut, len - x);
    var t = Math.max(
      minWeight,
      weight * (0.62 + 0.38 * (press(u) * 0.5 + 0.5)) * (taperFloor + (1 - taperFloor) * taper),
    );
    var xs = x.toFixed(xDigits);
    top.push(xs + ',' + (y - t / 2).toFixed(2));
    bot.push(xs + ',' + (y + t / 2).toFixed(2));
  }
  return 'M' + top.join('L') + 'L' + bot.reverse().join('L') + 'Z';
}
