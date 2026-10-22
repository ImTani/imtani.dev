/* Rise&Shine devlog — inlined into the page by tools/devlog/build.ts.
 *
 * The remote: wherever the page has no gutters, its options behind one
 * floating button.
 *
 * WHY. At 105rem and up the rail and the contents live in the gutters and
 * travel with the reader. Below that they used to be a band between the
 * masthead and the article: on a phone, fifteen tappable things before the
 * first sentence of a 27-minute read, and on a laptop a contents list that is
 * gone the moment the reader starts reading. Tani's answer for the phone: "It
 * only holds the menu for now, hides when you are scrolling. It's like a remote
 * navbar." And then for the laptop too: "We can give smaller laptop screens the
 * menu as well, the band isn't accessible at all times."
 *
 * ONE SET OF NODES. The sheet does not get copies. Below the gutters this file
 * MOVES the contents, the `Here` group and the `Elsewhere` group into it, in
 * that order — and on a phone the slip's record first, above them — and moves
 * each one back the moment the viewport stops wanting it there. A moved node
 * keeps its listeners, so the theme and motion buttons go on being driven by
 * theme.js and clips.js, and the contents go on being marked by toc.js — none
 * of those files knows the sheet exists. A comment node holds each one's place
 * while it is away; that is how it finds its way home.
 *
 * TWO BREAKPOINTS, BOTH THE PAGE'S OWN, and the strings below have to stay
 * identical to page.css's. `max-width: 104.99rem` is where the gutters
 * collapse, so it is where the remote exists. `max-width: 39.999rem` is a
 * phone, where the band picture already goes away; there the sheet is a bottom
 * sheet and the masthead's slip shrinks to one line, so the rest of the record
 * comes into the sheet. A laptop keeps its whole slip in the masthead — it has
 * the room, and the record is a fact about the article read once at the top,
 * not something to navigate by — so on a laptop the record stays put and the
 * sheet is the menu alone. Nothing is ever in two places.
 *
 * WITH NO SCRIPT there is no remote: the button ships `hidden`, the dialog ships
 * closed, and the rail and contents stay in the flow above the article, which
 * is where they were before this existed. That keeps the contents next to the
 * top of what it indexes — at the end of the article it would be a list of
 * places the reader has already been.
 *
 * The dialog is a real modal `<dialog>` opened with `showModal()`: focus is
 * trapped in it, Escape closes it and the page behind is inert, all for
 * nothing. The trigger is part of that inert page, so it cannot also be the
 * close control; the sheet has its own, at the top, where focus lands. */

(function () {
  var root = document.documentElement;
  var button = document.querySelector('[data-remote]');
  var sheet = document.getElementById('remote-sheet');
  var body = sheet && sheet.querySelector('[data-sheet-body]');
  var shut = sheet && sheet.querySelector('[data-sheet-close]');
  var toc = document.querySelector('.toc');
  var here = document.getElementById('rail-here');
  var elsewhere = document.getElementById('rail-elsewhere');

  /* The same test remote-boot.js made, plus the page being the page this was
     written for. Failing either takes the boot's class back off, which is what
     puts the rail and contents back above the article below the gutters. */
  if (
    !button ||
    !body ||
    !shut ||
    !toc ||
    !here ||
    !elsewhere ||
    typeof sheet.showModal !== 'function' ||
    !window.matchMedia
  ) {
    root.classList.remove('has-remote');
    return;
  }

  var narrow = window.matchMedia('(max-width: 104.99rem)');
  var phone = window.matchMedia('(max-width: 39.999rem)');

  /* How long the page has to be still before the button comes back. Scroll
     events arrive every frame while anything is moving, a momentum flick
     included, so a gap this long means the page has actually stopped rather
     than dropped a frame. 300ms rather than less because a reader reading
     with their thumb scrolls in short nudges, and a button that reappeared
     between every nudge would flicker over the text. Rather than more because
     past about 400ms a reader who has stopped and reaches for it finds nothing
     there, which reads as the control having gone. */
  var SETTLE = 300;

  /* The slip's record first, small, on a phone only, because there the
     masthead keeps just the prize and the length and this is where the rest
     went — see the slip's comment in build.ts. Then contents, because that is
     what a reader opens a menu for; then the things that act on this page; then
     the ways out. The DOM order is the reading order and the tab order, so the
     order is decided here and not by any styling of the sheet. The record is
     optional in a way the others are not: without it the sheet is still the
     menu, so its absence costs a block rather than the remote. */
  var record = document.querySelector('.slip > .slip-record');
  var items = (record ? [record] : [])
    .concat([toc, here.closest('.rail-group'), elsewhere.closest('.rail-group')])
    .map(function (node) {
      return { node: node, mark: document.createComment(' remote: back here '), away: false };
    });
  var docked = false;
  var printing = false;
  var timer = 0;

  /* THE TREE. Below the gutters the contents is the days only — the full
   * outline only ever lived in the right gutter of a wide screen — and Tani
   * found the gap by needing it: "I didn't know which date Inheritance
   * was in, a real reader could also face this." So in the sheet every day
   * with sections in it gets a disclosure, and its sections are one press
   * away rather than forty-one rows always.
   *
   * A button beside the link rather than `<details>`, because a day's name is
   * already a link to the day and has to stay one: a summary that navigated
   * would be a disclosure that cannot be used as one, and wrapping the outline
   * in details elements would change the markup a laptop gets. This way the
   * markup is untouched until the sheet takes it, the buttons exist only while
   * it holds it, and `prune` takes every trace back out. The toggle is the
   * standard one — `aria-expanded` on the button, `hidden` on the list it
   * names in `aria-controls` — so it is announced as what it is. */
  var twisties = [];

  function setOpen(twisty, open) {
    twisty.setAttribute('aria-expanded', open ? 'true' : 'false');
    twisty.nextElementSibling.hidden = !open;
  }

  function grow() {
    Array.prototype.forEach.call(toc.querySelectorAll('.lvl-1'), function (day, i) {
      var link = day.querySelector('a');
      var sections = day.querySelector('ol');
      if (!link || !sections) return;
      // The day's name without its date: "Day 3", which is how a reader would
      // ask for it. The date is already on screen beside the button.
      var name = (link.firstChild && link.firstChild.nodeValue ? link.firstChild.nodeValue : link.textContent).trim();
      var twisty = document.createElement('button');
      twisty.type = 'button';
      twisty.className = 'toc-twisty';
      twisty.setAttribute('aria-label', 'Sections in ' + name);
      sections.id = 'toc-sections-' + i;
      twisty.setAttribute('aria-controls', sections.id);
      twisty.addEventListener('click', function () {
        setOpen(twisty, twisty.getAttribute('aria-expanded') !== 'true');
      });
      day.insertBefore(twisty, sections);
      setOpen(twisty, false);
      twisties.push(twisty);
    });
  }

  function prune() {
    twisties.forEach(function (twisty) {
      var sections = twisty.nextElementSibling;
      sections.hidden = false;
      sections.removeAttribute('id');
      twisty.remove();
    });
    twisties = [];
  }

  /* Each time the sheet opens, the day the reader is in is the one that is
     open: the answer to "where am I" is the first thing a contents is for, and
     toc.js has already worked it out — the class is its mark. Everything else
     starts shut, so the list is the nine-row spine again rather than whatever
     was left expanded the last time. */
  function unfoldCurrent() {
    twisties.forEach(function (twisty) {
      setOpen(twisty, twisty.parentElement.classList.contains('is-current-day'));
    });
  }

  /* And make sure that day is on screen inside the sheet. By hand, not
     `scrollIntoView`, for the reason toc.js gives: that call is allowed to
     scroll every ancestor, the page included, and the page is being held
     still under the sheet. Only the sheet moves, and only if it has to. The
     sticky close bar covers the sheet's top, so it counts as an edge.
     When it does move, it lands on an edge a reader recognises rather than
     wherever the arithmetic stops: the `Contents` label at the top if that is
     enough to bring the day in, and the day itself if it is not. Stopping
     anywhere between left the last line of the record dangling under the
     close bar, which reads as something cut off. */
  function revealCurrent() {
    var day = toc.querySelector('.lvl-1.is-current-day');
    if (!day) return;
    var frame = sheet.getBoundingClientRect();
    var top = shut.parentElement.getBoundingClientRect().bottom;
    var box = day.getBoundingClientRect();
    if (box.bottom <= frame.bottom) return;
    var label = toc.firstElementChild.getBoundingClientRect().top - top;
    var by = box.bottom - label <= frame.bottom ? label : box.top - top;
    sheet.scrollTop += by;
  }

  /* Where every moved thing should be right now. One function for every
     crossing — 105rem either way, 40rem either way, into and out of a print
     job — so there is no path where a node is moved by one rule and forgotten
     by another. Each item goes away or comes home only when its own answer
     changes; then everything in the sheet is re-appended in list order, which
     is what keeps the record above the contents when it arrives after them:
     `appendChild` on a node that is already there moves it to the end. */
  function sync() {
    var on = narrow.matches && !printing;

    if (!on && sheet.open) sheet.close();
    if (!on && docked) prune();

    items.forEach(function (item) {
      var want = on && (item.node !== record || phone.matches);
      if (want === item.away) return;
      if (want) {
        item.node.parentNode.insertBefore(item.mark, item.node);
        body.appendChild(item.node);
      } else {
        item.mark.parentNode.replaceChild(item.node, item.mark);
      }
      item.away = want;
    });
    items.forEach(function (item) {
      if (item.away) body.appendChild(item.node);
    });

    if (on && !docked) grow();
    docked = on;
    button.hidden = !on;
  }

  /* Whether the button holds focus that a keyboard put there. Focus alone is not
     enough to keep it on screen: after a tap closes the sheet, focus comes back
     to the button with no ring, and a button that refused to hide for the rest
     of the article because of that would be a button that never hides. A ring
     means somebody is aiming at it, and the thing being aimed at must not move. */
  function aimedAt() {
    if (document.activeElement !== button) return false;
    try {
      return button.matches(':focus-visible');
    } catch (error) {
      return true;
    }
  }

  function open() {
    clearTimeout(timer);
    button.classList.remove('is-away');
    button.setAttribute('aria-expanded', 'true');
    // The page behind a modal is inert but not still: a drag on the backdrop
    // would go on scrolling the article under the sheet.
    root.classList.add('sheet-open');
    unfoldCurrent();
    sheet.scrollTop = 0;
    sheet.showModal();
    revealCurrent();
  }

  /* Run twice for most closes — once from whatever closed it, once from the
     dialog's own `close` event — and harmless the second time. The event is the
     one that catches Escape; the direct call is the one that is synchronous,
     which matters for a contents link: the page has to be scrollable again
     before the link's own navigation runs, not a task later. */
  function settle() {
    root.classList.remove('sheet-open');
    button.setAttribute('aria-expanded', 'false');
  }

  function close() {
    if (sheet.open) sheet.close();
    settle();
  }

  button.addEventListener('click', open);
  shut.addEventListener('click', close);

  sheet.addEventListener('close', function () {
    settle();
    // Browsers that restore focus on close mostly do this already; this is the
    // ones that do not. A fixed button cannot scroll the page by being focused,
    // but preventScroll says so rather than relying on it.
    if (!button.hidden) button.focus({ preventScroll: true });
  });

  /* The backdrop. A modal dialog's backdrop is not an element, so a tap on it
     lands on the dialog itself — and the dialog has no padding of its own, all
     of that is on its children, so the dialog is the target only when the tap
     was outside every one of them. */
  sheet.addEventListener('click', function (event) {
    if (event.target === sheet) close();
  });

  /* A contents entry navigates and closes. Nothing is prevented: the sheet is
     shut before the link's default action runs, and the default action is the
     same jump the entry makes on a laptop. */
  toc.addEventListener('click', function (event) {
    if (!sheet.open) return;
    var link = event.target.closest && event.target.closest('a[href^="#"]');
    if (link) close();
  });

  /* Hide while the page moves, back once it has been still for SETTLE. Any
     direction: a remote that only hid on the way down would sit over the text
     every time a reader went back up a paragraph, which is most of what
     re-reading is. Under reduced motion page.css makes the change instant; the
     button still gets out of the way, it just does not travel. */
  window.addEventListener(
    'scroll',
    function () {
      if (!docked || sheet.open) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        button.classList.remove('is-away');
      }, SETTLE);
      if (!aimedAt()) button.classList.add('is-away');
    },
    { passive: true },
  );

  // Hidden by opacity rather than by `visibility`, so it can still take focus;
  // and the moment it does, it is shown.
  button.addEventListener('focus', function () {
    button.classList.remove('is-away');
  });

  /* Paper has no remote. A reader printing gets the rail and the record back
     in the flow for the length of the print job, where page.css's print block
     already knows what to do with them, and the remote back afterwards. */
  window.addEventListener('beforeprint', function () {
    printing = true;
    sync();
  });
  window.addEventListener('afterprint', function () {
    printing = false;
    sync();
  });

  [narrow, phone].forEach(function (query) {
    if (query.addEventListener) query.addEventListener('change', sync);
    else if (query.addListener) query.addListener(sync);
  });

  sync();
})();
