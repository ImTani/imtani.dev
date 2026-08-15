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
 * where they were.
 *
 * Which leaves the reader who has none of those and still wants the page to
 * hold still. Eighteen things move here — fifteen clips and three animated GIFs
 * on other people's servers — and until this file grew a pause control, none of
 * them could be stopped without a mouse. So the masthead carries one button
 * that stops all of it, and pressing it puts the page into the state a reader
 * with JavaScript off already gets: clips with their own controls back, nothing
 * moving until asked. The GIFs have no controls to give back, so each becomes a
 * button that puts it back — and under reduced motion they start that way,
 * because a reader who asked for no motion should not have to ask twice.
 */

(function () {
  var clips = document.querySelectorAll('video[data-clip]');
  var gifs = document.querySelectorAll('img[data-motion]');
  var toggle = document.querySelector('[data-motion-toggle]');
  if (clips.length === 0) return;

  var stubs = [];

  function restore(button, image) {
    if (!button.isConnected) return;
    button.replaceWith(image);
    image.hidden = false;
  }

  /* A GIF cannot be paused: there is no interface to it, and these three are on
     servers we do not control, so there is no still frame to swap in that would
     not mean re-hosting somebody else's work. What is left is to take it off
     the page and offer it back, which is the same bargain the clips make. */
  function stub(image) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'motion-stub';
    button.textContent = 'Play the animation';
    // The attributes, not the layout box: the box is whatever the column is
    // wide, and a lazy image that has not loaded yet reports nothing at all.
    button.style.aspectRatio =
      image.getAttribute('width') + ' / ' + image.getAttribute('height');
    button.addEventListener('click', function () {
      restore(button, image);
    });
    image.hidden = true;
    image.replaceWith(button);
    return button;
  }

  function stubAll() {
    gifs.forEach(function (image) {
      if (image.isConnected) stubs.push([stub(image), image]);
    });
  }

  // Reduced motion is a request, not a preference to weigh. Fifteen looping
  // clips starting on their own is exactly what it is asking us not to do, so
  // those readers keep the controls and press play themselves — and the three
  // GIFs, which would otherwise be the only thing on the page still moving for
  // the one reader who asked for none of it, start as the button instead of
  // the animation. Nothing here is taken away; it is all one press behind.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    stubAll();
    return;
  }

  if (!('IntersectionObserver' in window)) return;

  var paused = false;
  document.documentElement.classList.add('clips-live');

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        if (paused || !entry.isIntersecting) {
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

  function hold(video) {
    if (video.paused) {
      video.dataset.held = '0';
      video.play();
    } else {
      video.dataset.held = '1';
      video.pause();
    }
  }

  clips.forEach(function (video) {
    video.controls = false;
    // Without this the clip is not focusable at all — a <video> with no
    // controls is not in the tab order — so the click handler below was a
    // mouse-only affordance. Space and Enter are what a button would take.
    video.tabIndex = 0;
    video.addEventListener('click', function () {
      // Once the page is paused the clip has its own controls back, and those
      // own the click; a second handler on the same surface would fight them.
      if (paused) return;
      hold(video);
    });
    video.addEventListener('keydown', function (event) {
      if (paused) return;
      if (event.key !== ' ' && event.key !== 'Enter') return;
      // Space scrolls the page by default, which is the opposite of what a
      // reader who just aimed at this clip asked for.
      event.preventDefault();
      hold(video);
    });
    observer.observe(video);
  });

  function setPaused(next) {
    paused = next;
    document.documentElement.classList.toggle('clips-live', !paused);

    clips.forEach(function (video) {
      video.controls = paused;
      // A <video> with controls is focusable on its own; leaving our tabindex
      // on it would be a second claim on the same tab stop.
      if (paused) video.removeAttribute('tabindex');
      else video.tabIndex = 0;
      // Re-observing is what re-fires the callback for a clip that is already
      // on screen; observe() alone does nothing to an element it already has.
      observer.unobserve(video);
      observer.observe(video);
    });

    if (paused) {
      stubAll();
    } else {
      stubs.forEach(function (pair) {
        restore(pair[0], pair[1]);
      });
      stubs = [];
    }

    toggle.textContent = paused ? 'Resume the motion' : 'Pause the motion';
  }

  if (toggle) {
    toggle.parentElement.hidden = false;
    toggle.addEventListener('click', function () {
      setPaused(!paused);
    });
  }
})();
