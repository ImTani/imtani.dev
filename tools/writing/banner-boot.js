/* The masthead band, wired.
 *
 * Inlined into the page by tools/writing/build.ts, inside the same IIFE as
 * banner.js, on an article whose front matter has a `banner:` block — and
 * only then; an article without one has no band and no banner script at all.
 * Everything about HOW the band works is in banner.js's header; this is the
 * one element the band is pointed at and the numbers it is given.
 *
 * THE NUMBERS ARE THE ARTICLE'S. build.ts writes the article's banner settings
 * into the call below, by the module's own option names, in place of the line
 * of placeholder, and the art's URL in place of its own. Why each article's
 * values are what they are is written next to them in its front matter — the
 * devlog's reasoning for every one of its settings is there — because that is
 * where they are changed.
 * banner-plate.ts bakes the no-JS plate from the same settings, merged over
 * banner.js's DEFAULTS exactly as `createBannerScreen` merges them, so the two
 * cannot be given different numbers.
 *
 * `pivot: .title` — Tani's: "shift the pivot to the center of the title rather
 * than the center of just the banner." The lean is measured from the middle of
 * the article's title, with half its width as the radius, so it peaks at the
 * title's two ends and is gentler over the picture. banner.js, THE POINTER, has
 * the numbers and why the radius is round.
 *
 * Checked against the type: `.envelope()` sweeps every scroll offset against
 * every wiggle offset, and the worst case under the title, deck, byline and
 * handle is the same as with no wiggle at all, because the fade stays put and
 * only the picture moves under it.
 *
 * `motion: null` is the module's default and is deliberate rather than
 * omitted: it means the crawl follows `prefers-reduced-motion`, and under
 * `reduce` the band paints ONE frame at rest, never starts the follower and
 * never listens to the pointer. All motion also stops when the band is off
 * screen and when the tab is hidden, both of which the module does by itself.
 *
 * WHY A GLOBAL. `.envelope()` is the only honest answer to "is the type
 * readable over this", and it is a bound over every scroll offset rather than a
 * sample, so it has to be asked of the band the reader actually has — at the
 * real width, in the real scheme, on the real page. A copy constructed in a
 * harness is a different band. One handle, named for what it is.
 */

(function () {
  var host = document.querySelector('.band');
  if (!host) return;

  window.devlogBand = createBannerScreen({
    host: host,
    art: '__BANNER_ART__',
__BANNER_OPTIONS__
    pivot: document.querySelector('.title'),
    motion: null,
  });
})();
