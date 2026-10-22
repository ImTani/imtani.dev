/* Rise&Shine devlog — the masthead band, wired.
 *
 * Inlined into the page by tools/devlog/build.ts, inside the same IIFE as
 * banner.js. Everything about HOW the band works is in that file's header;
 * this is only the numbers the owner chose and the one element they are
 * pointed at.
 *
 * WHY THESE VALUES. Five of them were chosen by dragging on
 * `reference/banner.html` on 16 August 2026 and are recorded in PRODUCT.md:
 * grain 0.85, levels 6, cell 2, artScale 1 (native, never resampled) and
 * anchorX 1 (the picture right-aligned to the band, which is the reading
 * column, so its right edge lands where every other element on the page
 * stops rather than being cut somewhere arbitrary).
 *
 * `travel: 120`. The band is 19rem tall and the picture is 500px, so the
 * surplus — the whole travel budget — is 196px. 120 of it shows the reader
 * about 85% of the picture at a pan rate of 0.39, which reads as a crawl. The
 * module's default (`null`, meaning all of the surplus) puts the rate at 0.64,
 * past the ~0.6 its author records as the point where a flick scroll turns the
 * crawl into a hop, and in a masthead this short it is plainly visible.
 *
 * `rampSpace: 'art'`, and with it ramp 0.636 / rampWidth 0.97 rather than the
 * owner's 0.67 / 0.88. His numbers are measured across the BAND and were
 * chosen against a 700px one; this band is 860. In art space the pair is
 * byte-identical at 700px and holds the fade's relationship to the picture at
 * every width, so the picture's left edge cannot become a visible vertical cut
 * as the band widens. See THE FADE in banner.js.
 *
 * `follow: 120` and no `fps`. The band was first built on a 12fps clock, the
 * site's on-twos register; on 22 October 2026 Tani overrode that for this one
 * element — "the scroll animation on the frame isn't very smooth, can we tween
 * it" — so it now renders every frame while moving and eases toward where the
 * scroll puts it with a 120ms time constant, then stops. `fps: 12` brings the
 * old clock back if the comparison is ever wanted. Why first-order and why
 * 120 is under THE FOLLOWER in banner.js.
 *
 * `wiggle: 6` and `wiggleSign: 1`, from the same request — "make it reactive
 * to the cursor position" — as Tani then shaped it: "ensure that the image has
 * a little wiggle room, and calculate the distance from the image's central
 * pivot, the farther the cursor, the subtler the movement, this way it's a fun
 * gimmick and not very prominent." The picture leans TOWARD the pointer, in
 * both directions, by at most 6 CSS px — three cells — which it reaches only
 * when the pointer is one picture-radius from the picture's centre; nearer and
 * farther it leans less, and from the far side of the page not at all. Only on
 * a pointer that hovers. The curve and its reasoning are under THE POINTER in
 * banner.js.
 *
 * What the wiggle room costs: the picture is cropped 6px at its right edge, so
 * it can slide left without the band's edge ever showing. That is geometry, so
 * banner-plate.ts carries the same number and the plates were re-baked with it.
 * `pivot: .title` — his follow-up: "shift the pivot to the center of the title
 * rather than the center of just the banner." The lean is measured from the
 * middle of the words "Rise&Shine Devlog", with half their width as its
 * radius, so it peaks at the title's two ends and is gentler over the picture.
 * banner.js, THE POINTER, has the numbers and why the radius is round.
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

    grain: 0.85,
    levels: 6,
    cell: 2,

    ramp: 0.636,
    rampWidth: 0.97,
    rampSpace: 'art',

    artScale: 1,
    anchorX: 1,
    focus: 0.35,
    travel: 120,
    direction: -1,

    follow: 120,
    wiggle: 6,
    wiggleSign: 1,
    pivot: document.querySelector('.title'),
    motion: null,
  });
})();
