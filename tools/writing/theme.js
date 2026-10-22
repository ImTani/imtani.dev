/* Rise&Shine devlog — inlined into the page by tools/writing/build.ts.
 *
 * The theme control. Three states and not two: light, dark, and the machine's
 * own preference, which is the default and the only one that keeps working
 * when this file does not run. A two-state switch has to pick a side at the
 * first press, and whichever side it picks it strands every reader whose
 * machine was already right — which, on a page that follows
 * `prefers-color-scheme`, is most of them.
 *
 * `system` is the absence of the attribute rather than a third value of it, so
 * the CSS needs no third case and the stored key is simply removed.
 *
 * The button ships inside `<li hidden>` and is revealed here, for the same
 * reason the pause control is: with no script there is nothing to act on it,
 * and a control that does nothing is worse than no control. Its label is its
 * accessible name and it states the setting rather than the next press, since
 * a cycle of three has no single next action to name. */

(function () {
  var root = document.documentElement;
  var button = document.querySelector('[data-theme-toggle]');
  if (!button) return;

  var ORDER = ['system', 'light', 'dark'];
  var LABEL = {
    system: 'Theme: system',
    light: 'Theme: light',
    dark: 'Theme: dark',
  };

  var metas = document.querySelectorAll('meta[name="theme-color"][data-theme-color]');

  function apply(theme) {
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    button.textContent = LABEL[theme];

    // The browser's own chrome follows these, and it would otherwise stay the
    // colour the machine asked for while the page is the colour the reader did.
    metas.forEach(function (meta) {
      var which = meta.getAttribute('data-theme-color');
      meta.media =
        theme === 'system'
          ? '(prefers-color-scheme: ' + which + ')'
          : theme === which
            ? 'all'
            : 'not all';
    });
  }

  function stored() {
    try {
      var theme = localStorage.getItem('theme');
      return theme === 'light' || theme === 'dark' ? theme : 'system';
    } catch (error) {
      return 'system';
    }
  }

  // theme-boot.js has already set the attribute; this is the label catching up
  // with it, and the reason the button's text in the markup is only a default.
  var current = stored();
  apply(current);
  button.parentElement.hidden = false;

  button.addEventListener('click', function () {
    current = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    try {
      if (current === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', current);
    } catch (error) {
      /* Refused storage costs the reader the choice next time, not this time. */
    }
    apply(current);
  });
})();
