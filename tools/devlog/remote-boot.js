/* Rise&Shine devlog — inlined into the <head> by tools/devlog/build.ts, in the
 * same blocking tag as theme-boot.js.
 *
 * One class, and the reason it cannot wait for remote.js. Below the gutters the
 * rail and the contents live in the remote's sheet rather than above the
 * article, and remote.js — like every other script here — runs after the
 * document. A long document is painted in pieces as it arrives, so without this
 * a phone or a laptop could draw fifteen tappable things between the title and
 * the first sentence and then have them pulled away, moving the article up
 * under the reader's eye. page.css hides them below the gutters while this
 * class is present, so they are never drawn there at all.
 *
 * It only promises what remote.js can deliver: the same test that file makes
 * before it does anything. If remote.js later finds the page is not what it
 * expects, it takes the class back off and the rail is where it always was. */

(function () {
  var probe = document.createElement('dialog');
  if (typeof probe.showModal === 'function' && window.matchMedia) {
    document.documentElement.classList.add('has-remote');
  }
})();
