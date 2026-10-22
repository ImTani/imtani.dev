/* Rise&Shine devlog — the drawn rules, inlined into the page by build.ts.
 *
 * The page's horizontals are hand-drawn, and this file draws them. The geometry
 * itself is in hand.js, which build.ts pastes into the same <script> immediately
 * above this one; there is one generator for every line on the page so that one
 * hand draws all of them.
 *
 * THE DAY RULE: a drawn fleuron, centred in the column, with a short hand-drawn
 * line running out of each side of it. The wings stop well short of the column
 * edges, and that is the whole point of the composition. A full-width rule over
 * ragged-right text draws a straight edge along the ragged one and turns the
 * negative space on the right into a shape; a centred ornament has no
 * right-hand edge to expose. Tani spotted that, and this is the fix.
 *
 * THE HEAD RULE: the line across the top of the page, above the award block and
 * under `Contents`, which at the wide breakpoint is one line with the gutter cut
 * out of the middle and below it is just the masthead's. It happens once, at the
 * top, which is what lets it carry the material without repeating into noise. It
 * is a plain line rather than an ornament, because it is the top edge of a block
 * of metadata rather than a page turn — and because the masthead already has the
 * title in it.
 *
 * Generated, never loaded: no image file, no dependency.
 *
 * SEEDING. Every rule gets its own seed and every page load gets new ones, so
 * no two dividers in the article are the same line and the article is not the
 * same twice. That is what a hand does. What a hand does NOT do is redraw itself
 * when you resize the window, so the geometry is generated exactly once per
 * element and then held: the SVG carries a fixed viewBox and CSS scales it, so
 * resizing, scrolling, zooming and switching theme all re-render the same line.
 * A rule that re-randomised on repaint would shimmer, which is a bug and not a
 * hand. There is deliberately no resize listener in this file.
 *
 * DEGRADATION is in page.css, not here, so that it survives the reader changing
 * their mind at runtime: under `prefers-contrast: more`, `forced-colors: active`
 * and print the drawings are hidden and the plain hairlines underneath them come
 * back. Somebody who asked for more contrast asked for a line, not a drawing.
 * With no JavaScript at all the same hairlines are what were there the whole
 * time — this script only ever turns them off.
 *
 * NO LAYOUT SHIFT. Both drawings are absolutely positioned and take no space in
 * flow, and the hairlines they replace are borders that are already there before
 * this runs and stay 1px afterwards — they only lose their colour. Nothing moves
 * when this file executes.
 *
 * THE LINK UNDERLINES are not drawn here. They are a repeating tile baked into
 * the stylesheet at build time by build.ts, so that they survive with no
 * JavaScript at all — see the note over the link rules in page.css. The only
 * thing this file does for them is the last block below: give each link its own
 * starting phase, which is what stops fifty-eight underlines all beginning with
 * the same wobble.
 */

(function () {
  if (!document.createElementNS) return;

  /* Tani's numbers, picked at reference/banner.html by dragging sliders against
     real paragraphs at the real column width. They are not derived from
     anything and there is no arithmetic to check them against. */
  var WOBBLE = 1.4; /* px of tremor away from true */
  var WEIGHT = 1.65; /* px, the nominal width of the drawn line */
  var SCALE = 0.9; /* the fleuron, against the 140x30 it is drawn at */

  function seed() {
    return (Math.random() * 4294967296) >>> 0;
  }

  function svg(w, h, extra, body) {
    return (
      '<svg viewBox="0 0 ' +
      w +
      ' ' +
      h +
      '" width="' +
      w +
      '" height="' +
      h +
      '" aria-hidden="true" focusable="false" ' +
      extra +
      '>' +
      body +
      '</svg>'
    );
  }

  // ------------------------------------------------------------- day rule ---

  /* The ornament's own coordinate system, which is also the size it renders at
     in a full-width column: two wings and the fleuron between them. Below that
     width CSS shrinks the whole box; it never redraws it.

     The wings were 78px and are now double that. At 1.4px the tremor was real
     but had nowhere to travel — over 78px it read as a slightly irregular
     hairline rather than as a line somebody drew. Doubling the run is the fix
     he chose over raising the amplitude, and it is the better one: more wobble
     in the same distance reads as a wavy line, where the same wobble over twice
     the distance reads as an unsteady hand, which is the thing being drawn.

     400 of a 740px column is fifty-four per cent. Still a centred ornament with
     air either side rather than a rule with a bump in it — which matters,
     because a full-width rule above ragged-right text is what emphasises the
     empty margin on the right. */
  var WING = 156;
  var INNER = 45; /* centre to the inner end of a wing */
  var W = 2 * (INNER + WING);
  var H = 30;

  /* Where the pen touches down and where it lifts, in px along the wing. The
     inner end is short because the line is leaving the ornament; the outer end
     is long because it is running out. */
  var TAPER_IN = 16;
  var TAPER_OUT = 40;

  function wingPath(s) {
    return handLine({
      rnd: mulberry32(s),
      len: WING,
      wobble: WOBBLE,
      weight: WEIGHT,
      taperIn: TAPER_IN,
      taperOut: TAPER_OUT,
    });
  }

  /* The fleuron. Bezier paths, authored — the craft floor does not allow a
     Unicode dingbat standing in for a drawn mark, and a dingbat would also be
     whatever face the reader happens to have.
     One half, drawn from the centre out: a vine that leaves the leaf, opens and
     curls back on itself, the same vine mirrored under it, and a seed. The
     curls stay open rather than closing into rings, because a closed ring at
     this size is a blob and a blob is not a drawing. The half is placed twice,
     each copy a fraction of a degree out of true, so the ornament reads as
     struck by a hand rather than plotted.
     Where the drawn version of this had a tapering hairline running out of each
     seed, the wings are that hairline now — which is the join between the two
     treatments Tani asked to be mixed. */
  var HALF =
    '<path d="M6.4,-1.1 C12.4,-7.6 22.4,-9.6 28.6,-6.4 C32.6,-4.3 33.8,0.4 30.6,2.2 C28.4,3.4 25.9,2.2 25.9,0.2"/>' +
    '<path d="M6.4,1.1 C12.4,7.6 22.4,9.6 28.6,6.4 C32.6,4.3 33.8,-0.4 30.6,-2.2 C28.4,-3.4 25.9,-2.2 25.9,-0.2"/>' +
    '<path d="M39.4,0 m-1.6,0 a1.6,1.6 0 1,0 3.2,0 a1.6,1.6 0 1,0 -3.2,0" fill="currentColor" stroke="none"/>';

  var LEAF =
    '<path d="M0.1,-11.6 C4,-6.4 5.6,-2.2 5.6,0 C5.6,2.3 4.1,6.5 -0.1,11.6 ' +
    'C-4.1,6.4 -5.5,2.2 -5.5,0 C-5.5,-2.2 -3.9,-6.5 0.1,-11.6 Z" fill="currentColor" stroke="none"/>';

  function ornament(s) {
    var rnd = mulberry32(s);
    /* Two seeds, not one mirrored wing. A hand that drew the same stroke twice
       would be a printing press. */
    var right = wingPath((rnd() * 4294967296) >>> 0);
    var left = wingPath((rnd() * 4294967296) >>> 0);
    var cx = W / 2;
    var cy = H / 2;

    return svg(
      W,
      H,
      'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"',
      '<g transform="translate(' +
        cx +
        ' ' +
        cy +
        ') scale(' +
        SCALE +
        ')">' +
        LEAF +
        '<g transform="rotate(0.6)">' +
        HALF +
        '</g>' +
        '<g transform="scale(-1,1) rotate(-0.35)">' +
        HALF +
        '</g>' +
        '</g>' +
        '<path transform="translate(' +
        (cx + INNER) +
        ' ' +
        cy +
        ')" d="' +
        right +
        '" fill="currentColor" stroke="none"/>' +
        '<path transform="translate(' +
        (cx - INNER) +
        ' ' +
        cy +
        ') scale(-1,1)" d="' +
        left +
        '" fill="currentColor" stroke="none"/>',
    );
  }

  var marks = document.querySelectorAll('.day-rule');
  for (var i = 0; i < marks.length; i += 1) {
    marks[i].innerHTML = ornament(seed());
  }

  /* Only once every rule is actually on the page: this is what turns the
     fallback hairline off, so a failure anywhere above leaves the page exactly
     as it was rather than leaving it with no divider at all. */
  if (marks.length > 0) document.documentElement.classList.add('day-rule-drawn');

  // ------------------------------------------------------------ head rule ---

  /* ONE LINE IN TWO PIECES, WITH THE GUTTER CUT OUT OF THE MIDDLE.
   *
   * At the wide breakpoint the rule above the masthead's award block and the
   * rule under `Contents` are meant to read as one horizontal line across the
   * head of the page, interrupted by the gutter between the reading column and
   * the rail. page.css has carried that claim for a while, and `--head-rule` is
   * the single number both boxes are pushed down to so that neither can drift.
   *
   * It stopped being true the day the masthead's half was drawn, because A DRAWN
   * LINE HAS NO SINGLE Y. This one bows by up to +/-3px across its run and
   * shakes by another +/-0.8, so a dead straight hairline across the gutter can
   * only ever agree with it on average and visibly parts company at one end. The
   * fix is not a better offset; it is to draw the other half too.
   *
   * They are two elements with a gutter between them, so they cannot be one SVG.
   * What makes them one line is that the wander is continuous ACROSS THE GAP:
   * one seed, and one span — the whole distance from the left edge of the
   * reading column to the right edge of the rail's list — with the two pieces
   * cut out of that one curve at their own offsets into it. See `span` and `x0`
   * in hand.js. Two draws with the same parameters would give two lines that are
   * each correct and do not join, which is worse than one drawn and one straight.
   *
   * THE GEOMETRY IS READ OFF THE PAGE, NOT OFF THE BREAKPOINT. Whether the two
   * are side by side is a layout fact and the layout is what knows it: if the
   * rail's label sits entirely to the right of the award block they are one
   * line, and otherwise the rail is a spine above the article and there is
   * nothing across the gutter to continue into. A copy of `105rem` in this file
   * would be a second place to change the breakpoint and a silent bug the day
   * somebody changed only one.
   *
   * THE FOUR ENDS ARE NOT THE SAME KIND OF END. The outer two are where the pen
   * touches down and where it runs out, and they taper as they always did. The
   * two at the gutter are cut, not lifted: the line is one line and the gutter is
   * a hole in it, so tapering them would open a fade half again as wide as the
   * 64px gap and read as two lines that happen to be collinear. They stop square
   * — at whatever weight and height the curve has at that x, which because it is
   * one curve is within a fraction of a pixel of what it resumes at.
   *
   * Unlike the day rule, this one is as long as the column — 860px at the
   * measure, and about 340 on a phone — so it cannot be a fixed drawing that
   * CSS scales. Scaling an 860px line down to 340 would take the 1.65px weight
   * to 0.65 and multiply the tremor's frequency by two and a half: a hairline
   * with the shakes rather than a line somebody drew. So the run is measured
   * once, at load, and each piece is generated at its true length. The SVGs then
   * render at 1:1 with `preserveAspectRatio="none"` and a height fixed in CSS,
   * which means that if the window is later resized the line stretches or
   * squeezes horizontally and its weight and its wobble amplitude do not move.
   * That is the right axis to give up: a line whose wiggles are a little closer
   * together is still the same pen, where a line that got thinner is not.
   *
   * WHAT CHANGED FROM THE WING, AND WHY. The tremor is the hand and does not
   * know how long the line is, so its amplitude is the wing's and its stops are
   * scaled with the run to hold the same spatial frequency — one every 22px,
   * exactly as the wing has one every 22px. The drift is the opposite: a long
   * line ruled by eye bows, and it bows once, so it keeps three stops across the
   * whole run however long that is and its amplitude grows with the square root
   * of the length rather than with the length. Both are now stated against the
   * SPAN rather than against either piece, which is the point: the bow belongs
   * to the line, not to the half of it that happens to be in the masthead. At
   * the 1,197px span of a full-width page that is at most +/-3.0px and typically
   * half of it — two and a half thousandths of the run, about what a steady hand
   * does over a foot, and small enough that the line still reads as a rule
   * rather than as a curve. On a 350px phone column, where there is only the one
   * piece and the span is the piece, the same expression gives +/-1.6px.
   *
   * The 0.58 is the one number here that was picked by looking rather than
   * derived. Square-root growth alone put a 3.2px bow on the column, which read
   * as a line that had gone wrong rather than as one drawn by hand; this is the
   * fraction of it that reads as unsteady instead of as broken. */
  var AWARD_H = 12;
  var AWARD_DRIFT_N = 3;
  var AWARD_DRIFT_AT_WING = 1.35; /* the wing's, in multiples of WOBBLE */
  var AWARD_TAPER = 0.06; /* of the run, each end */

  /* One piece of the head rule. `span` and `x0` place it in the whole line; the
     seed is the line's, not the piece's, so every piece walks the same curve. */
  function headPiece(s, span, x0, len, taperIn, taperOut) {
    var scale = Math.sqrt(span / WING);
    return svg(
      len.toFixed(1),
      AWARD_H,
      'preserveAspectRatio="none"',
      '<path d="' +
        handLine({
          rnd: mulberry32(s),
          len: len,
          span: span,
          x0: x0,
          step: 2.5,
          xDigits: 1,
          y: AWARD_H / 2,
          wobble: WOBBLE,
          weight: WEIGHT,
          driftN: AWARD_DRIFT_N,
          driftAmp: AWARD_DRIFT_AT_WING * scale * 0.58,
          tremorN: Math.round((7 * span) / WING),
          pressN: Math.round((5 * span) / WING),
          taperIn: taperIn,
          taperOut: taperOut,
        }) +
        '" fill="currentColor"/>',
    );
  }

  var award = document.querySelector('.award-rule');
  var contents = document.querySelector('.toc-rule');
  if (award && award.parentNode) {
    /* One layout read for each of the two boxes, at the end of the document. */
    var left = award.parentNode.getBoundingClientRect();
    var label = contents ? contents.parentNode : null;
    var right = label ? label.getBoundingClientRect() : null;
    /* Side by side, with air between them, is the wide layout. Stacked — which
       is every width under the breakpoint — is not, and then the masthead's
       rule is the whole line rather than the first half of one. */
    var together = right !== null && right.left > left.right && right.width > 32;
    var span = together ? right.right - left.left : left.width;
    var taper = Math.min(56, Math.max(18, span * AWARD_TAPER));
    var lineSeed = seed();

    if (left.width > 32) {
      award.innerHTML = headPiece(lineSeed, span, 0, left.width, taper, together ? 0 : taper);
      document.documentElement.classList.add('award-rule-drawn');
    }

    if (together && contents) {
      contents.innerHTML = headPiece(lineSeed, span, right.left - left.left, right.width, 0, taper);
      document.documentElement.classList.add('toc-rule-drawn');
    }
  }

  // -------------------------------------------------------- link underline ---

  /* The tile itself is baked into the stylesheet, so every link already has a
     drawn underline before this runs and keeps one if this never runs. What is
     left to do is the only part a stylesheet cannot do: start each link at its
     own point in the tile.
   *
   * Without this, all fifty-eight underlines begin at phase zero — the same
   * three centimetres of the same line, fifty-eight times, which is exactly the
   * repeat the two coprime tiles were chosen to avoid. Most links here are one
   * or two words long, so the opening of the tile is most of what a reader ever
   * sees of it. Two independent offsets, one per tile, and the pair of periods
   * does the rest.
   *
   * `background-position-x` only. It cannot reflow, it cannot move a glyph, and
   * it leaves the y offset in the stylesheet where it can be read.
   *
   * The two periods are read off the root rather than repeated here. They are
   * decided once, by build.ts, which is also what sizes the tiles it bakes; a
   * copy of the numbers in this file would be a second place to change them and
   * a silent phase-quantising bug the day somebody changed only one. */
  var css = getComputedStyle(document.documentElement);
  var tileA = parseFloat(css.getPropertyValue('--link-tile-a')) || 0;
  var tileB = parseFloat(css.getPropertyValue('--link-tile-b')) || 0;
  if (tileA > 0 && tileB > 0) {
    var links = document.querySelectorAll(
      '.prose a, .masthead a, .rail a, .colophon a, .motion-button, .theme-button',
    );
    for (var j = 0; j < links.length; j += 1) {
      links[j].style.backgroundPositionX =
        Math.floor(Math.random() * tileA) + 'px, ' + Math.floor(Math.random() * tileB) + 'px';
    }
  }
})();
