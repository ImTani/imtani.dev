/* Rise&Shine devlog — inlined into the <head> by tools/devlog/build.ts.
 *
 * The whole of the no-flash problem: if the reader has forced a theme, the
 * attribute has to be on <html> before the first paint, or the page renders in
 * the machine's colours and then changes under them. That means blocking, and
 * it means being short enough that blocking is obviously worth it.
 *
 * Everything else — the control, the label, persisting a change — is in
 * theme.js, which runs after the document and blocks nothing. */

(function () {
  try {
    var theme = localStorage.getItem('theme');
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (error) {
    /* Storage can be denied outright. Then the machine's preference stands. */
  }
})();
