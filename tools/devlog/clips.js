/* Rise&Shine devlog — inlined into the page by tools/devlog/build.ts.
 *
 * The only script on the page. Fifteen clips that all begin decoding the moment
 * the document is ready would make a 6,600-word article unreadable on anything
 * without a fan, so nothing plays until it is on screen and everything pauses
 * when it leaves.
 *
 * This runs strictly as an enhancement, in the direction that keeps the page
 * working when it does not run at all: the markup ships `controls` and a poster
 * frame, so with JavaScript off every clip is a still image the reader can
 * press play on. This script takes the controls away and drives them by scroll
 * position instead. If it never executes, or IntersectionObserver is missing,
 * or the reader has asked for reduced motion, the native controls simply stay
 * where they were. */

(function () {
  var clips = document.querySelectorAll('video[data-clip]');
  if (clips.length === 0) return;
  if (!('IntersectionObserver' in window)) return;

  // Reduced motion is a request, not a preference to weigh. Fifteen looping
  // clips starting on their own is exactly what it is asking us not to do, so
  // those readers keep the controls and press play themselves.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('clips-live');

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (!entry.isIntersecting) {
          video.pause();
          return;
        }
        // A clip the reader paused by hand stays paused, even after it scrolls
        // away and comes back.
        if (video.dataset.held === '1') return;
        var started = video.play();
        if (started) {
          started.catch(function () {
            // Autoplay refused despite muted+playsinline. Hand the clip back.
            video.controls = true;
          });
        }
      });
    },
    { rootMargin: '250px 0px', threshold: 0.2 },
  );

  clips.forEach(function (video) {
    video.controls = false;
    video.addEventListener('click', function () {
      if (video.paused) {
        video.dataset.held = '0';
        video.play();
      } else {
        video.dataset.held = '1';
        video.pause();
      }
    });
    observer.observe(video);
  });
})();
