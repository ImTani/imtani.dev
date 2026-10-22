/* Rise&Shine devlog — inlined into the page by tools/writing/build.ts.
 *
 * Where you are, in the contents rail.
 *
 * The article is fifty thousand pixels tall and the rail is forty-one entries
 * of it. Without this the rail answers "what is in here" and never "where am
 * I", which on a document this long is the question a reader actually has by
 * the third day heading.
 *
 * Strictly an enhancement, in the direction that costs nothing when it does not
 * run: everything below sets `aria-current` and one class, and the only styling
 * that depends on either is the colour the current entry takes. With this file
 * missing, blocked, or in a browser without IntersectionObserver, the rail is
 * exactly the rail that shipped before it existed.
 *
 * What it deliberately does NOT do is keep the current entry centred or pinned.
 * Re-centring on every heading puts the list in permanent motion, and a list
 * that moves while you are reading beside it is a list you lose your place in.
 * The rail moves only when the current entry would otherwise be off its own
 * edge, and then only far enough — `scrollIntoView({block: 'nearest'})`
 * semantics, implemented by hand so that it can never touch the page's own
 * scroll position, with the inset read out of `scroll-margin-block` in the
 * stylesheet so the entry never lands welded to the rail's top or bottom.
 */

(function () {
  var rail = document.querySelector('.toc');
  if (!rail || !('IntersectionObserver' in window)) return;

  /* The rail is a label that does not move and a list that does, so the box with
     the scrollbar in it is the list — see the `.toc` block under the wide
     breakpoint in page.css, and the bug that put it there. Everything below
     measures and moves THIS box; `rail` is still what the entries are found in
     and what the reader's own gestures are watched on, because they bubble.
     The fallback is the rail itself, which is what this file measured before the
     label came out of the scrolling box: with no list to find, `reveal` reads a
     box that cannot scroll and returns on its first line. */
  var scroller = rail.querySelector('ol') || rail;

  /* Document order, because the rail is built in document order — which is
     what lets the search below stop at the first heading that is still under
     the line instead of measuring all forty-one every time. */
  var links = [];
  var headings = [];
  var days = [];

  Array.prototype.forEach.call(rail.querySelectorAll('a[href^="#"]'), function (link) {
    var heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (!heading) return;
    links.push(link);
    headings.push(heading);
    // `closest` returns the element itself when it matches, so a day entry is
    // its own day. Below the wide breakpoint the rail is the days only and the
    // section entries are not displayed, which is what this is for.
    days.push(link.parentElement ? link.parentElement.closest('.lvl-1') : null);
  });

  if (headings.length === 0) return;

  /* A fifth of the way down the viewport: high enough that a heading counts as
     reached about when it stops being the thing you are moving toward, low
     enough that it is not the first pixel of the scroll. The observer's root is
     cut to the same line, so the two cannot drift apart. */
  var LINE = 0.2;

  /* How long the rail is left alone after the reader touches it. Long enough to
     cover the tail of a flick, short enough that it starts following again
     without feeling stuck. */
  var HANDS_OFF = 1200;

  var still = window.matchMedia('(prefers-reduced-motion: reduce)');
  var current = -1;
  var touched = 0;
  var inset = null;

  function edge() {
    if (inset === null) {
      var declared = getComputedStyle(links[0]).getPropertyValue('scroll-margin-block-start');
      var value = parseFloat(declared);
      inset = value > 0 ? value : 0;
    }
    return inset;
  }

  function activeIndex() {
    var line = window.innerHeight * LINE;

    /* The last screenful has no scrolling left in it, so a heading that arrives
       below the line there can never reach it — measured on a 1000px window,
       the Epilogue came to rest 319px down with the page at its very bottom and
       the rail still pointing three sections back. So over the final screen the
       line slides down to meet the bottom of the viewport, continuously: at one
       full screen of scrolling left it is still exactly where it always was,
       and at none left it is the viewport's own bottom edge. */
    var remaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
    if (remaining < window.innerHeight * (1 - LINE)) line = window.innerHeight - remaining;

    var found = -1;
    for (var i = 0; i < headings.length; i += 1) {
      if (headings[i].getBoundingClientRect().top > line) break;
      found = i;
    }
    return found;
  }

  /* Bring the entry back inside the rail if it has left it, and otherwise do
     nothing at all. Every early return here is a case where moving the rail
     would be the wrong answer: there is nothing to scroll, the reader is
     scrolling it themselves, or their focus is inside it and moving it would
     pull the thing they are aiming at out from under them. */
  function reveal(link) {
    if (scroller.scrollHeight - scroller.clientHeight <= 1) return;
    if (Date.now() - touched < HANDS_OFF) return;
    if (rail.contains(document.activeElement)) return;

    var pad = edge();
    var frame = scroller.getBoundingClientRect();
    var box = link.getBoundingClientRect();

    var above = frame.top + pad - box.top;
    var below = box.bottom + pad - frame.bottom;
    var by = above > 0 ? -above : below > 0 ? below : 0;
    if (by === 0) return;

    var top = scroller.scrollTop + by;
    if (scroller.scrollTo) {
      scroller.scrollTo({ top: top, behavior: still.matches ? 'auto' : 'smooth' });
    } else {
      scroller.scrollTop = top;
    }
  }

  function mark(index) {
    if (index === current) return;

    if (current >= 0) {
      links[current].removeAttribute('aria-current');
      if (days[current]) days[current].classList.remove('is-current-day');
    }

    current = index;
    if (index < 0) return;

    // `location` rather than `page` or `true`: the rail points into this
    // document, and the entry is where the reader is within it.
    links[index].setAttribute('aria-current', 'location');
    if (days[index]) days[index].classList.add('is-current-day');
    reveal(links[index]);
  }

  var queued = false;

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      mark(activeIndex());
    });
  }

  /* Two triggers, and they catch different things.
   *
   * The observer's root is the strip between the top of the viewport and the
   * line, so it fires exactly when a heading crosses either — and it fires for
   * layout that moves under a still page too: a lazy figure landing, a clip
   * being replaced by its stub, a resize.
   *
   * The scroll listener is the backstop for the one case an observer cannot
   * see: a jump big enough that a heading is on one side of the line in one
   * frame and past the top of the viewport in the next never changes
   * intersection state, so nothing is reported. Dragging the scrollbar of a
   * fifty-thousand-pixel document does that on almost every frame. It is passive, it
   * coalesces into the same animation frame, and the loop it runs stops at the
   * first heading below the line. */
  var observer = new IntersectionObserver(schedule, {
    rootMargin: '0px 0px -' + (100 - LINE * 100) + '% 0px',
    threshold: 0,
  });
  headings.forEach(function (heading) {
    observer.observe(heading);
  });

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', function () {
    inset = null;
    schedule();
  });

  ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'keydown'].forEach(function (name) {
    rail.addEventListener(
      name,
      function () {
        touched = Date.now();
      },
      { passive: true },
    );
  });

  schedule();
})();
