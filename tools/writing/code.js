/* Rise&Shine devlog — inlined into the page by tools/writing/build.ts.
 *
 * The copy button on a code block.
 *
 * It ships `hidden` in the markup and is revealed here, which is the same
 * contract the pause control and the theme control ship under and it is not a
 * formality: this needs `navigator.clipboard`, which does not exist without
 * script, is not there outside a secure context, and can be refused by policy.
 * A button that cannot copy is worse than no button, so nothing is revealed
 * until the thing it depends on has been found. With this file blocked the
 * eleven blocks are the eleven complete, readable, selectable blocks they were
 * before it existed, bar and all — the bar is markup and CSS, and only the
 * button in it is conditional.
 *
 * WHAT GETS COPIED. `textContent` of the <code>, not its `innerHTML`. The
 * highlighter in build.ts wraps runs of the source in <span> and escapes the
 * HTML around them, so concatenating the text nodes gives back the block the
 * author wrote — tabs, blank lines, `<` and `&` and all — while innerHTML would
 * hand the reader a page's worth of markup. `white-space: pre` is a painting
 * instruction and does not touch this.
 *
 * WHAT GETS SAID. A press has an outcome and the outcome is a word, not a
 * colour: the empty `role="status"` span beside the button is filled in, so it
 * is read out by a screen reader and seen by everybody else. Failure names what
 * happened and leaves the reader somewhere useful — the code selected, ready
 * for their own copy key — rather than saying nothing and looking broken.
 */

(function () {
  var clipboard = navigator.clipboard;
  if (!clipboard || !clipboard.writeText) return;

  /* Long enough to be read after a glance away, short enough that the bar is
     not still claiming success by the time the next block is on screen. */
  var HOLD = 2400;

  Array.prototype.forEach.call(document.querySelectorAll('.code'), function (block) {
    var button = block.querySelector('.code-copy');
    var said = block.querySelector('.code-said');
    var source = block.querySelector('pre code');
    if (!button || !said || !source) return;

    var timer = 0;

    function say(text, failed) {
      said.textContent = text;
      // `toggle` with a second argument rather than add/remove, so the class
      // and the text can never disagree about which state this is in.
      said.classList.toggle('is-failed', failed === true);
      clearTimeout(timer);
      timer = setTimeout(function () {
        said.textContent = '';
        said.classList.remove('is-failed');
      }, HOLD);
    }

    /* Where a refused copy leaves the reader: the block selected, so their own
       copy key finishes the job the button could not. */
    function offerTheCode() {
      try {
        var range = document.createRange();
        range.selectNodeContents(source);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (error) {
        /* Nothing left to fall back to; the message below still stands. */
      }
    }

    button.addEventListener('click', function () {
      clipboard.writeText(source.textContent).then(
        function () {
          say('Copied');
        },
        function () {
          offerTheCode();
          say('Copy blocked — the code is selected', true);
        },
      );
    });

    button.hidden = false;
  });
})();
