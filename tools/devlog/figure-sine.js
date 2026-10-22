/* Rise&Shine devlog — the sine figure, made live. Inlined by build.ts inside
 * the figure it drives, from figures.ts.
 *
 * The figure is complete without this: figures.ts draws a correct still frame,
 * and a reader with JavaScript off, or with reduced motion asked for, gets that
 * frame and nothing moves. What this adds is the thing the borrowed GIF showed
 * and could not be stopped from showing — the point going round and the wave
 * being drawn out by it — and the thing the GIF could not do at all, which is
 * let the reader take hold of the point.
 *
 * WHEN IT MOVES is the page's rule, not a new one. The clips play only when
 * about half of them is in view, and so does this; it stops the moment it is
 * not, and the frame loop stops with it rather than idling. The page-wide
 * "Pause the motion" button stops it too. That button belongs to clips.js,
 * which marks the page `clips-live` while motion is allowed and takes the class
 * away while it is paused — and never adds it at all under reduced motion or
 * without IntersectionObserver. So "may this move" is one question asked of
 * the root element, watched for changes, and every case clips.js already
 * handles is handled here by the same answer.
 *
 * TAKING HOLD. Only the point takes pointer input — a 44px invisible target
 * around it, with `touch-action: none` — so a finger that lands anywhere else
 * on the figure scrolls the page as normal. Dragging moves the angle; letting
 * go leaves the point where it was put, and after a moment and a half it goes
 * on from there. It resumes rather than staying put because there is no play
 * button on this figure: a reader who nudged it once would otherwise be left
 * with a dead picture and no way to tell it was ever alive. It waits first so
 * that the value just set can be read.
 *
 * The keyboard gets the same control as a slider: tab to the point, arrows
 * step it fifteen degrees, Page Up and Down a quarter turn, Home back to zero.
 * While the point has keyboard focus nothing moves on its own — a control that
 * changes value by itself under a screen reader is reading out numbers nobody
 * asked for — and the value is spoken as the angle and the height.
 *
 * No allocation in the frame loop: the geometry is written through the SVG
 * DOM's numeric properties rather than as attribute strings, and the readouts
 * are rewritten only when the whole-degree value changes.
 */

(function () {
  var figure = document.currentScript && document.currentScript.parentNode;
  var wrap = figure && figure.querySelector('[data-figure="sine"]');
  if (!wrap || !window.requestAnimationFrame || !('IntersectionObserver' in window)) return;

  var root = document.documentElement;
  var svg = wrap.querySelector('svg');
  var plot = svg.querySelector('.fd-sine');

  function num(name) {
    return parseFloat(plot.getAttribute('data-' + name));
  }

  var CX = num('cx');
  var CY = num('cy');
  var R = num('r');
  var X0 = num('x0');
  var XU = num('x-unit');
  var ARC_R = num('arc-r');
  var ARC_LEN = 2 * Math.PI * ARC_R;
  var VBW = svg.viewBox.baseVal.width;
  var TURN = 2 * Math.PI;
  var SPEED = TURN / 6; /* one turn every six seconds */
  var STEP = Math.PI / 12; /* fifteen degrees */
  var RESUME_MS = 1500;
  var HIT_PX = 22; /* half of the 44px target, in CSS pixels */

  var handle = plot.querySelector('.fd-handle');
  var hit = handle.querySelector('.fd-hit');
  var ring = handle.querySelector('.fd-ring');
  var dot = handle.querySelector('.fd-dot');
  var radius = plot.querySelector('.fd-radius');
  var proj = plot.querySelector('.fd-proj');
  var tip = plot.querySelector('.fd-tip');
  var arc = plot.querySelector('.fd-arc');
  var clip = svg.querySelector('clipPath rect');
  var readAngle = plot.querySelector('.fd-read-angle');
  var readHeight = plot.querySelector('.fd-read-height');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  var angle = num('angle');
  var shownDeg = -1;
  var visible = false;
  var dragging = false;
  var held = false;
  var waiting = false;
  var timer = 0;
  var raf = 0;
  var last = 0;
  var left = 0;
  var top = 0;
  var scale = 1;

  function degreesOf(a) {
    return Math.round((a * 180) / Math.PI) % 360;
  }

  /* The same rounding figures.ts uses for the still frame, and no "-0.00". */
  function heightOf(a, minus) {
    var v = Math.sin(a);
    return (v < -0.005 ? minus : '') + Math.abs(v).toFixed(2);
  }

  function draw() {
    var x = CX + R * Math.cos(angle);
    var y = CY - R * Math.sin(angle);
    var t = X0 + angle * XU;
    dot.cx.baseVal.value = x;
    dot.cy.baseVal.value = y;
    hit.cx.baseVal.value = x;
    hit.cy.baseVal.value = y;
    ring.cx.baseVal.value = x;
    ring.cy.baseVal.value = y;
    radius.x2.baseVal.value = x;
    radius.y2.baseVal.value = y;
    proj.x1.baseVal.value = x;
    proj.y1.baseVal.value = y;
    proj.x2.baseVal.value = t;
    proj.y2.baseVal.value = y;
    tip.cx.baseVal.value = t;
    tip.cy.baseVal.value = y;
    clip.width.baseVal.value = angle * XU + 2;
    arc.setAttribute('stroke-dashoffset', ARC_LEN - angle * ARC_R);

    var deg = degreesOf(angle);
    if (deg !== shownDeg) {
      shownDeg = deg;
      readAngle.textContent = 'angle ' + deg + '°';
      readHeight.textContent = 'height ' + heightOf(angle, '−');
    }
  }

  function announce() {
    var deg = degreesOf(angle);
    handle.setAttribute('aria-valuenow', deg);
    handle.setAttribute(
      'aria-valuetext',
      deg + ' degrees, height ' + heightOf(angle, 'minus '),
    );
  }

  // ------------------------------------------------------------- running ---

  function shouldRun() {
    return (
      visible &&
      root.classList.contains('clips-live') &&
      !reduce.matches &&
      !dragging &&
      !held &&
      !waiting
    );
  }

  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    angle += dt * SPEED;
    if (angle >= TURN) angle -= TURN;
    draw();
    raf = window.requestAnimationFrame(frame);
  }

  function update() {
    if (shouldRun()) {
      if (!raf) {
        last = 0;
        raf = window.requestAnimationFrame(frame);
      }
    } else if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function resume() {
    waiting = false;
    timer = 0;
    update();
  }

  function waitThenResume() {
    waiting = true;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(resume, RESUME_MS);
    update();
  }

  // The same rule as clips.js: half the figure in view, or half the viewport
  // when the figure is taller than that.
  function onScreen(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= 0.5) return true;
    var bounds = entry.rootBounds;
    return !!bounds && entry.intersectionRect.height >= bounds.height * 0.5;
  }

  // ------------------------------------------------------------ the handle ---

  /* 44 CSS pixels across whatever the drawing's scale, so the target is as big
     on a phone, where the drawing is half size, as it is on a desk. */
  function fitHit() {
    var width = svg.getBoundingClientRect().width;
    if (width > 0) hit.r.baseVal.value = Math.max(HIT_PX, (HIT_PX * VBW) / width);
  }

  function aim(event) {
    var x = (event.clientX - left) * scale - CX;
    var y = CY - (event.clientY - top) * scale;
    angle = Math.atan2(y, x);
    if (angle < 0) angle += TURN;
    draw();
  }

  function release() {
    if (!dragging) return;
    dragging = false;
    wrap.classList.remove('fd-dragging');
    announce();
    waitThenResume();
  }

  function setUp() {
    svg.setAttribute('role', 'group');
    handle.setAttribute('tabindex', '0');
    handle.setAttribute('role', 'slider');
    handle.setAttribute('aria-label', 'Angle of the point on the circle');
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', '359');
    announce();
    wrap.classList.add('fd-live');
    fitHit();

    hit.addEventListener('pointerdown', function (event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // Measured once per drag, so a move costs arithmetic and nothing else.
      var box = svg.getBoundingClientRect();
      left = box.left;
      top = box.top;
      scale = VBW / box.width;
      dragging = true;
      waiting = false;
      wrap.classList.add('fd-dragging');
      hit.setPointerCapture(event.pointerId);
      // No text selection and no compatibility mouse events while dragging.
      event.preventDefault();
      update();
      aim(event);
    });

    hit.addEventListener('pointermove', function (event) {
      if (dragging) aim(event);
    });

    hit.addEventListener('pointerup', release);
    hit.addEventListener('pointercancel', release);
    hit.addEventListener('lostpointercapture', release);

    // Safari has honoured `touch-action` on SVG shapes unevenly. Refusing the
    // touch here is the belt to that rule's braces, and it is on the point
    // alone, so it cannot cost the reader a scroll anywhere else.
    hit.addEventListener(
      'touchstart',
      function (event) {
        event.preventDefault();
      },
      { passive: false },
    );

    handle.addEventListener('keydown', function (event) {
      var steps = 0;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          steps = 1;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          steps = -1;
          break;
        case 'PageUp':
          steps = 6;
          break;
        case 'PageDown':
          steps = -6;
          break;
        case 'Home':
          angle = 0;
          break;
        case 'End':
          angle = TURN - STEP;
          break;
        default:
          return;
      }
      event.preventDefault();
      // Onto the fifteen-degree grid first, so the keys always land on round
      // numbers whatever angle the motion left the point at.
      var n = Math.round(angle / STEP) + steps;
      var count = Math.round(TURN / STEP);
      angle = (((n % count) + count) % count) * STEP;
      draw();
      announce();
    });

    handle.addEventListener('focus', function () {
      var keyboard = true;
      try {
        keyboard = handle.matches(':focus-visible');
      } catch (error) {
        // An engine without :focus-visible: hold still for any focus.
      }
      if (!keyboard) return;
      held = true;
      announce();
      update();
    });

    handle.addEventListener('blur', function () {
      if (!held) return;
      held = false;
      waitThenResume();
    });

    new IntersectionObserver(
      function (entries) {
        visible = onScreen(entries[entries.length - 1]);
        update();
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    ).observe(svg);

    new MutationObserver(update).observe(root, {
      attributes: true,
      attributeFilter: ['class'],
    });

    if (reduce.addEventListener) reduce.addEventListener('change', update);
    window.addEventListener('resize', fitHit, { passive: true });
  }

  // clips.js runs at the foot of the page and is what sets `clips-live`, so
  // the question "may this move" cannot be asked until it has.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setUp);
  } else {
    setUp();
  }
})();
