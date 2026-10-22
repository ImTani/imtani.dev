/* Rise&Shine devlog — the coordinate grids, made live. Inlined by build.ts
 * inside each of the two grid figures, from figures.ts; the same source twice,
 * and each copy finds its own figure from `document.currentScript`.
 *
 * Both grids are complete without this. figures.ts draws a correct still frame
 * of each — the explorer's point at (−3, 2), the demonstration's at (4, 3) —
 * and a reader with JavaScript off gets exactly that.
 *
 * THE POINT. Either grid's point can be picked up and moved, and it moves in
 * whole units because a coordinate here is a count of boxes, which is the
 * paragraph's whole idea. Only the point takes pointer input — a 44px target
 * with `touch-action: none` — so a finger anywhere else on the grid scrolls
 * the page. On the keyboard the point is a stop in the tab order and the arrow
 * keys move it one box; Home takes it back to the origin.
 *
 * WHAT A SCREEN READER HEARS. A point on a plane has two values, and ARIA's
 * value properties describe one: a slider would announce "4" and lose the 3.
 * So the point is a small application — the role that makes a screen reader
 * hand the arrow keys to it instead of using them to read the page — and every
 * move is spoken through a polite live region as both coordinates, "x 4, y
 * minus 3". Polite, so it never cuts across what is already being read.
 *
 * THE GODOT SWITCH lives with the first grid and sets one class on the root
 * element. Both grids watch for it; everything it changes visually is in
 * page.css. What this file does with it is the lesson: the point does not move
 * on screen, and the y in its readout changes sign. Pressing it again puts the
 * axis back.
 *
 * THE DEMONSTRATION walks its point out from the origin to (4, 3) a box at a
 * time — four along, three up — and holds it there, because the paragraph after
 * it points at "the point (4, 3) on the grid above". It walks when half of it is
 * on screen (the page's rule, see clips.js), walks again when it comes back
 * after leaving, and does not walk at all while the page's motion is paused or
 * the reader has asked for reduced motion: then it is the still frame, which is
 * the end of the walk. Steps are timers, not a frame loop, and there is nothing
 * running at all between them or after the last one.
 */

(function () {
  var figure = document.currentScript && document.currentScript.parentNode;
  var wrap = figure && figure.querySelector('.drawn');
  var grid = wrap && wrap.querySelector('.fd-grid');
  if (!grid || !document.documentElement.classList) return;

  var root = document.documentElement;
  var svg = wrap.querySelector('svg');
  var MODE = 'fd-godot-y';
  var STEP_MS = 420;
  var START_MS = 500;
  var HIT_PX = 22; /* half of the 44px target, in CSS pixels */

  function num(name) {
    return parseFloat(grid.getAttribute('data-' + name));
  }

  var O = num('o');
  var C = num('c');
  var N = num('n');
  var VBW = svg.viewBox.baseVal.width;
  var demo = grid.getAttribute('data-role') === 'demo';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var handle = grid.querySelector('.fd-handle');
  var hit = handle.querySelector('.fd-hit');
  var move = handle.transform.baseVal.getItem(0);
  var projX = grid.querySelector('.fd-gproj-x');
  var projY = grid.querySelector('.fd-gproj-y');
  var read = grid.querySelector('.fd-gread');
  var button = wrap.querySelector('.fd-switch');

  /* Where the point is ON SCREEN, in boxes from the origin, up being positive.
     Its y VALUE is this or its negative, depending on whose axis is in use. */
  var gx = num('x');
  var gy = num('y');
  var endX = gx;
  var endY = gy;

  var live = null;
  var godot = false;
  var dragging = false;
  var held = false;
  var visible = false;
  var armed = true;
  var step = 0;
  var timer = 0;
  var left = 0;
  var top = 0;
  var scale = 1;

  function minus(v) {
    return v < 0 ? '−' + -v : '' + v;
  }

  function spoken(v) {
    return v < 0 ? 'minus ' + -v : '' + v;
  }

  function valueY() {
    return godot ? -gy : gy;
  }

  function draw() {
    var px = O + gx * C;
    var py = O - gy * C;
    move.setTranslate(px, py);
    projX.x1.baseVal.value = px;
    projX.y1.baseVal.value = py;
    projX.x2.baseVal.value = px;
    projY.x1.baseVal.value = px;
    projY.y1.baseVal.value = py;
    projY.y2.baseVal.value = py;
    // The same placement figures.ts uses: up and to the right, unless that
    // would run the readout off the grid.
    var right = gx < 6;
    var above = gy < 8;
    read.setAttribute('x', right ? px + 12 : px - 12);
    read.setAttribute('y', above ? py - 12 : py + 14);
    read.setAttribute('text-anchor', right ? 'start' : 'end');
    read.setAttribute('dominant-baseline', above ? 'auto' : 'hanging');
    read.textContent = '(' + minus(gx) + ', ' + minus(valueY()) + ')';
  }

  function say(prefix) {
    if (live) live.textContent = prefix + 'x ' + spoken(gx) + ', y ' + spoken(valueY());
  }

  function place(x, y) {
    x = Math.max(-N, Math.min(N, x));
    y = Math.max(-N, Math.min(N, y));
    if (x === gx && y === gy) return false;
    gx = x;
    gy = y;
    draw();
    return true;
  }

  // ------------------------------------------------------ the demonstration ---

  function allowed() {
    return root.classList.contains('clips-live') && !reduce.matches;
  }

  function stopWalk() {
    if (timer) window.clearTimeout(timer);
    timer = 0;
  }

  /* Four along, then three up: the order the paragraph reads a coordinate in. */
  function walkTo(n) {
    var along = Math.abs(endX);
    var x = n <= along ? (endX < 0 ? -n : n) : endX;
    var up = n <= along ? 0 : n - along;
    return [x, endY < 0 ? -up : up];
  }

  function tick() {
    step += 1;
    var at = walkTo(step);
    place(at[0], at[1]);
    timer = step < Math.abs(endX) + Math.abs(endY) ? window.setTimeout(tick, STEP_MS) : 0;
  }

  function walk() {
    stopWalk();
    armed = false;
    step = 0;
    place(0, 0);
    timer = window.setTimeout(tick, START_MS);
  }

  function settle() {
    if (!demo) return;
    if (!allowed()) {
      // Paused, or no motion asked for: the figure is its still frame, which is
      // where the walk ends.
      if (timer) {
        stopWalk();
        place(endX, endY);
      }
      return;
    }
    if (visible && armed && !dragging && !held) walk();
  }

  // The same rule as clips.js: half the figure in view, or half the viewport
  // when the figure is taller than that.
  function onScreen(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= 0.5) return true;
    var bounds = entry.rootBounds;
    return !!bounds && entry.intersectionRect.height >= bounds.height * 0.5;
  }

  // ------------------------------------------------------------- the mode ---

  function readMode() {
    var now = root.classList.contains(MODE);
    if (now === godot) return;
    godot = now;
    draw();
    if (button) {
      button.setAttribute('aria-pressed', godot ? 'true' : 'false');
      // Only the explorer speaks the change; the demonstration would say the
      // same thing a second time.
      say(godot ? 'Godot’s Y-axis: y points down. Point at ' : 'Y points up. Point at ');
    }
  }

  // ------------------------------------------------------------ the point ---

  function fitHit() {
    var width = svg.getBoundingClientRect().width;
    if (width > 0) hit.r.baseVal.value = Math.max(HIT_PX, (HIT_PX * VBW) / width);
  }

  function aim(event) {
    var ux = (event.clientX - left) * scale;
    var uy = (event.clientY - top) * scale;
    place(Math.round((ux - O) / C), Math.round((O - uy) / C));
  }

  function release() {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('fd-dragging');
    say('');
  }

  function setUp() {
    live = document.createElement('p');
    live.className = 'vh';
    live.setAttribute('aria-live', 'polite');
    wrap.appendChild(live);

    svg.setAttribute('role', 'group');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('role', 'application');
    handle.setAttribute('aria-roledescription', 'movable point');
    handle.setAttribute('aria-label', 'Point on the grid. Arrow keys move it one unit.');
    wrap.classList.add('fd-live');
    fitHit();

    hit.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      var box = svg.getBoundingClientRect();
      left = box.left;
      top = box.top;
      scale = VBW / box.width;
      dragging = true;
      // The reader has taken over: the walk stops where it is, and does not
      // come back until the figure has left the screen and returned.
      stopWalk();
      armed = false;
      wrap.classList.add('fd-dragging');
      hit.setPointerCapture(event.pointerId);
      event.preventDefault();
      aim(event);
    });

    hit.addEventListener('pointermove', function (event) {
      if (dragging) aim(event);
    });

    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', release);
    hit.addEventListener('lostpointercapture', release);

    // As on the sine figure: Safari's support for `touch-action` on SVG shapes
    // is uneven, and refusing the touch here costs nothing anywhere else.
    hit.addEventListener(
      'touchstart',
      function (event) {
        event.preventDefault();
      },
      { passive: false },
    );

    handle.addEventListener('keydown', function (event) {
      var x = gx;
      var y = gy;
      switch (event.key) {
        case 'ArrowRight':
          x += 1;
          break;
        case 'ArrowLeft':
          x -= 1;
          break;
        case 'ArrowUp':
          y += 1;
          break;
        case 'ArrowDown':
          y -= 1;
          break;
        case 'Home':
          x = 0;
          y = 0;
          break;
        default:
          return;
      }
      event.preventDefault();
      stopWalk();
      armed = false;
      place(x, y);
      // Spoken even at the edge, where nothing moved, so a key press is never
      // met with silence.
      say('');
    });

    handle.addEventListener('focus', function () {
      held = true;
      stopWalk();
    });

    handle.addEventListener('blur', function () {
      held = false;
    });

    if (button) {
      wrap.querySelector('.fd-gridbar').hidden = false;
      button.addEventListener('click', function () {
        root.classList.toggle(MODE);
      });
    }

    // One observer for both things the root element's class carries: whose
    // Y-axis is in use, and whether the page's motion is on.
    new MutationObserver(function () {
      readMode();
      settle();
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
    if (reduce.addEventListener) reduce.addEventListener('change', settle);

    if (demo && 'IntersectionObserver' in window) {
      new IntersectionObserver(
        function (entries) {
          var now = onScreen(entries[entries.length - 1]);
          if (now === visible) return;
          visible = now;
          // Leaving is what re-arms the walk; coming back is what plays it.
          if (!visible) {
            stopWalk();
            armed = true;
          }
          settle();
        },
        { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
      ).observe(svg);
    }

    window.addEventListener('resize', fitHit, { passive: true });
    readMode();
  }

  // clips.js runs at the foot of the page and is what sets `clips-live`, so
  // whether the demonstration may walk cannot be asked until it has.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setUp);
  } else {
    setUp();
  }
})();
