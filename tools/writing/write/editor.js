/* The block editor's page. Plain script, no build step, no dependencies.
 *
 * The server (server.ts) does everything that touches a file or the renderer;
 * this keeps the state of one open article — its front matter as a form and
 * its body as a list of blocks — and draws it. Each block is an object that is
 * never changed in place: an edit makes a new one, so undo is a stack of
 * arrays, and the DOM for a block is made once and moved, never rebuilt, while
 * the block is the same object. Rendered blocks are inserted straight into the
 * page's own `.prose`, with no wrapper, so the page's sibling rules apply to
 * them exactly as they do on the page. */

(function () {
  'use strict';

  // --------------------------------------------------------------- helpers

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'class') el.className = value;
        else if (key === 'text') el.textContent = value;
        else if (key.slice(0, 2) === 'on') el.addEventListener(key.slice(2), value);
        else if (key === 'value') el.value = value;
        else if (key === 'checked') el.checked = !!value;
        else el.setAttribute(key, value === true ? '' : String(value));
      });
    }
    for (var i = 2; i < arguments.length; i += 1) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }

  /** replaceChildren, but skipping null and flattening arrays, as h() does. */
  function fill(el) {
    el.replaceChildren();
    for (var i = 1; i < arguments.length; i += 1) append(el, arguments[i]);
    return el;
  }

  function request(method, path, body) {
    var init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || res.statusText);
        return json;
      });
    });
  }
  var post = function (path, body) { return request('POST', path, body); };
  var get = function (path) { return request('GET', path); };

  var toastTimer = 0;
  function toast(message, kind) {
    var old = document.querySelector('.ed-toast');
    if (old) old.remove();
    var el = h('div', { class: 'ed-toast' + (kind ? ' is-' + kind : ''), role: 'status', text: message, title: 'Click to dismiss' });
    el.addEventListener('click', function () { el.remove(); });
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.remove(); }, kind === 'bad' ? 9000 : 3500);
  }

  function slugify(value) {
    return value.toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function clean(text) {
    return text.replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '').replace(/^[ \t]+$/, '');
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  var app = document.getElementById('app');
  var pageCss = document.getElementById('page-css');

  // ----------------------------------------------------------------- router

  var S = null; // the open article, or null in the library

  function dirty() {
    if (!S) return false;
    return fmDirty() || blocksDirty();
  }

  window.addEventListener('beforeunload', function (e) {
    if (dirty()) { e.preventDefault(); e.returnValue = ''; }
  });

  var currentHash = location.hash;
  window.addEventListener('hashchange', function () {
    if (dirty() && !confirm('Leave this article? Your unsaved changes here will be lost.')) {
      history.replaceState(null, '', currentHash);
      return;
    }
    route();
  });

  function route() {
    currentHash = location.hash;
    var m = /^#\/edit\/(published|drafts)\/([a-z0-9-]+)$/.exec(location.hash);
    teardown();
    if (m) openArticle(m[1], m[2]);
    else showLibrary();
  }

  function teardown() {
    S = null;
    document.removeEventListener('keydown', onKey);
    var g = document.querySelector('.ed-gutter');
    if (g) g.remove();
    var d = document.querySelector('.ed-dropline');
    if (d) d.remove();
    var c = document.querySelector('.ed-chips');
    if (c) c.remove();
    closeMenu();
  }

  // ---------------------------------------------------------------- library

  function showLibrary() {
    pageCss.textContent = '';
    document.title = 'Writing — imtani.dev';
    app.replaceChildren(h('div', { class: 'ed-sheet' }, h('p', { class: 'ed-note', text: 'Loading…' })));
    get('/api/library').then(drawLibrary, function (err) { toast(err.message, 'bad'); });
  }

  function drawLibrary(lib) {
    pageCss.textContent = lib.css;
    var title = h('input', { class: 'ed-input', id: 'new-title', placeholder: 'The title', autocomplete: 'off' });
    var slug = h('input', { class: 'ed-input ed-mono-input', id: 'new-slug', placeholder: 'the-url-slug', autocomplete: 'off', spellcheck: 'false' });
    var msg = h('p', { class: 'ed-msg' });
    var slugTouched = false;
    title.addEventListener('input', function () { if (!slugTouched) slug.value = slugify(title.value); });
    slug.addEventListener('input', function () { slugTouched = slug.value !== ''; });
    var create = h('button', { class: 'ed-btn ed-go', type: 'submit', text: 'New draft' });
    var form = h('form', { class: 'ed-new', onsubmit: function (e) {
      e.preventDefault();
      msg.className = 'ed-msg';
      msg.textContent = '';
      post('/api/drafts', { slug: slug.value.trim(), title: title.value.trim() }).then(function (made) {
        location.hash = '#/edit/drafts/' + made.slug;
      }, function (err) { msg.className = 'ed-msg is-bad'; msg.textContent = err.message; });
    } },
      h('label', null, h('span', { class: 'ed-field-label', text: 'Title' }), title),
      h('label', null, h('span', { class: 'ed-field-label', text: 'Slug — the URL, /writing/<slug>' }), slug),
      create,
      msg);

    function rows(source) {
      var list = lib.articles.filter(function (a) { return a.source === source; });
      if (!list.length) return h('p', { class: 'ed-empty', text: source === 'drafts' ? 'No drafts.' : 'Nothing published.' });
      return list.map(function (a) {
        var href = '#/edit/' + a.source + '/' + a.slug;
        var status = { published: 'Published', draft: 'Draft', hidden: 'Published · draft: true' }[a.status];
        return h('div', { class: 'ed-row' },
          h('div', null,
            h('h3', null, h('a', { href: href, text: a.title })),
            h('p', { class: 'ed-facts' },
              h('span', { class: 'ed-badge is-' + a.status, text: status }),
              h('span', { text: a.slug }),
              h('span', { text: a.kind }),
              a.date ? h('span', { text: a.date }) : null,
              h('span', { text: 'saved ' + new Date(a.modified).toLocaleString() }))),
          h('div', { class: 'ed-actions' },
            h('a', { class: 'ed-btn', href: href, text: 'Open' }),
            h('button', { class: 'ed-btn', type: 'button', text: 'Preview', onclick: function () {
              window.open('/writing/' + a.slug + '?disk=' + a.source, '_blank');
            } }),
            h('button', { class: 'ed-btn', type: 'button', text: 'Reveal', title: 'Open the folder in Explorer', onclick: function () {
              post('/api/reveal', { source: a.source, slug: a.slug }).then(function (r) { toast('Opened ' + r.dir); }, function (err) { toast(err.message, 'bad'); });
            } })),
          a.problem ? h('p', { class: 'ed-problem', text: a.problem }) : null);
      });
    }

    app.replaceChildren(h('div', { class: 'ed-sheet' },
      h('header', { class: 'ed-top' },
        h('p', { class: 'ed-eyebrow', text: 'Local tool · writing' }),
        h('h1', { text: 'Articles' }),
        h('p', { class: 'ed-note' },
          'Published articles live in ', h('code', { text: lib.roots.published }),
          ' and drafts in ', h('code', { text: lib.roots.drafts }),
          '. Saving writes article.md and keeps the old one in .edit-backups/ beside it. Nothing here runs git.')),
      h('h2', { class: 'ed-group', text: 'New draft' }),
      form,
      h('h2', { class: 'ed-group', text: 'Published' }),
      rows('published'),
      h('h2', { class: 'ed-group', text: 'Drafts' }),
      rows('drafts')));
  }

  // ------------------------------------------------------------ the article

  var nextId = 1;

  function makeBlock(view, orig, id) {
    return {
      id: id || nextId++,
      src: view.src,
      orig: orig,
      type: view.type,
      html: view.html,
      error: view.error,
      candidate: !!view.candidate,
      lede: !!view.lede,
      referenced: view.referenced || [],
      pending: !!view.pending,
    };
  }

  function openArticle(source, slug) {
    app.replaceChildren(h('div', { class: 'ed-sheet' }, h('p', { class: 'ed-note', text: 'Opening ' + slug + '…' })));
    get('/api/article?source=' + source + '&slug=' + slug).then(function (doc) {
      S = {
        source: doc.source,
        slug: doc.slug,
        dir: doc.dir,
        hash: doc.hash,
        eol: doc.eol,
        bom: doc.bom,
        fm: doc.fm,
        fmLoaded: JSON.stringify(doc.fm),
        fmLoadedData: doc.fm ? doc.fm.data : {},
        fmError: doc.fmError,
        fmRaw: doc.fmRaw,
        fmRawText: null,
        fmCanonical: doc.fmCanonical,
        blocks: doc.blocks.map(function (b) { return makeBlock(b, b.orig); }),
        loaded: null,
        media: doc.media,
        figures: doc.figures,
        keys: doc.keys,
        today: doc.today,
        css: doc.css,
        masthead: doc.masthead,
        mastheadError: doc.mastheadError,
        validation: doc.validation,
        undo: [],
        redo: [],
        editing: null,
        selected: null,
        tab: S && S.slug === doc.slug && S.tab ? S.tab : 'page',
        nodes: new WeakMap(),
      };
      S.loaded = S.blocks.map(function (b) { return { src: b.src, orig: b.orig }; });
      pageCss.textContent = doc.css;
      document.title = (doc.fm && doc.fm.data.title ? doc.fm.data.title : slug) + ' — writing';
      drawEditor();
    }, function (err) {
      app.replaceChildren(h('div', { class: 'ed-sheet' },
        h('p', { class: 'ed-note' }, h('a', { href: '#/', text: '← Articles' })),
        h('p', { class: 'ed-msg is-bad', text: err.message })));
    });
  }

  function blocksDirty() {
    if (S.blocks.length !== S.loaded.length) return true;
    for (var i = 0; i < S.blocks.length; i += 1) {
      var b = S.blocks[i];
      var l = S.loaded[i];
      if (b.src !== l.src || b.orig !== l.orig) return true;
    }
    return false;
  }

  function fmDirty() {
    if (S.fmRawText !== null) return S.fmRawText !== S.fmRaw;
    return JSON.stringify(S.fm) !== S.fmLoaded;
  }

  function docState() {
    var fm = { mode: 'unchanged' };
    if (S.fmRawText !== null && S.fmRawText !== S.fmRaw) fm = { mode: 'raw', text: S.fmRawText };
    else if (S.fmRawText === null && fmDirty()) fm = { mode: 'form', data: S.fm.data, comments: S.fm.comments };
    return {
      baseHash: S.hash,
      fm: fm,
      blocks: S.blocks.map(function (b) { return b.orig === undefined ? { src: b.src } : { src: b.src, orig: b.orig }; }),
    };
  }

  // --------------------------------------------------------------- undo

  function snapshot(tag) {
    S.undo.push({ blocks: S.blocks.slice(), fm: clone(S.fm), fmRawText: S.fmRawText, tag: tag || null });
    if (S.undo.length > 60) S.undo.shift();
    S.redo = [];
  }

  function restore(from, to) {
    var snap = from.pop();
    if (!snap) return;
    to.push({ blocks: S.blocks.slice(), fm: clone(S.fm), fmRawText: S.fmRawText });
    S.blocks = snap.blocks;
    var fmChanged = JSON.stringify(snap.fm) !== JSON.stringify(S.fm);
    S.fm = snap.fm;
    S.fmRawText = snap.fmRawText;
    S.editing = null;
    panels.clear();
    syncBlocks();
    fixLedes();
    if (fmChanged && S.tab === 'fm') drawForm();
    changed();
  }

  // ------------------------------------------------------------ the frame

  var els = {};

  function drawEditor() {
    var isDraft = S.source === 'drafts';
    els.state = h('span', { class: 'ed-state' });
    els.undo = h('button', { class: 'ed-btn', type: 'button', text: 'Undo', title: 'Undo (Ctrl+Z)', onclick: function () { restore(S.undo, S.redo); } });
    els.redo = h('button', { class: 'ed-btn', type: 'button', text: 'Redo', title: 'Redo (Ctrl+Shift+Z)', onclick: function () { restore(S.redo, S.undo); } });
    els.tabs = {
      page: h('button', { class: 'ed-tab', type: 'button', role: 'tab', text: 'Page', onclick: function () { setTab('page'); } }),
      fm: h('button', { class: 'ed-tab', type: 'button', role: 'tab', text: 'Front matter', onclick: function () { setTab('fm'); } }),
      problems: h('button', { class: 'ed-tab', type: 'button', role: 'tab', onclick: function () { setTab('problems'); } }),
    };
    var bar = h('header', { class: 'ed-bar' },
      h('a', { class: 'ed-back', href: '#/', text: '← Articles' }),
      h('span', { class: 'ed-badge is-' + (isDraft ? 'draft' : 'published'), text: isDraft ? 'Draft' : 'Published' }),
      h('span', { class: 'ed-title', text: S.slug }),
      els.state,
      h('div', { class: 'ed-tabs', role: 'tablist' }, els.tabs.page, els.tabs.fm, els.tabs.problems),
      h('span', { class: 'ed-spacer' }),
      h('div', { class: 'ed-tools' },
        els.undo, els.redo,
        h('button', { class: 'ed-btn', type: 'button', text: 'Check', title: 'Run the build’s checks on what is here now', onclick: function () { refresh(true); } }),
        h('button', { class: 'ed-btn', type: 'button', text: 'Preview', title: 'The whole page, as it would ship, in a new tab', onclick: preview }),
        h('button', { class: 'ed-btn ed-go', type: 'button', text: 'Save', title: 'Save (Ctrl+S)', onclick: saveNow }),
        isDraft ? h('button', { class: 'ed-btn', type: 'button', text: 'Publish…', onclick: publishFlow }) : null,
        h('button', { class: 'ed-btn', type: 'button', text: 'Reveal', title: 'Open the folder in Explorer', onclick: function () {
          post('/api/reveal', { source: S.source, slug: S.slug }).then(function (r) { toast('Opened ' + r.dir); }, function (err) { toast(err.message, 'bad'); });
        } }),
        h('button', { class: 'ed-btn', type: 'button', text: 'Dark', title: 'Light or dark page', onclick: function (e) {
          var root = document.documentElement;
          var dark = root.getAttribute('data-theme') !== 'dark';
          root.setAttribute('data-theme', dark ? 'dark' : 'light');
          e.currentTarget.textContent = dark ? 'Light' : 'Dark';
        } })));

    els.prose = h('article', { class: 'prose', id: 'article', role: 'main' });
    els.masthead = h('div');
    els.end = h('div', { class: 'ed-end' },
      h('button', { class: 'ed-btn', type: 'button', text: '+ Add a block at the end', onclick: function (e) { openInsertMenu(e.currentTarget, S.blocks.length); } }));
    els.pageView = h('main', { class: 'ed-pageview' },
      h('div', { class: 'page' }, els.masthead, h('div', { class: 'layout' }, els.prose), els.end));
    els.formView = h('div', { class: 'ed-form' });
    els.problemsView = h('div', { class: 'ed-problems' });

    els.gutter = buildGutter();
    els.dropline = h('div', { class: 'ed-dropline', hidden: true });
    els.chips = h('div', { class: 'ed-chips' });
    document.body.appendChild(els.chips);
    document.body.appendChild(els.gutter);
    document.body.appendChild(els.dropline);

    app.replaceChildren(bar, els.pageView, els.formView, els.problemsView);
    wirePage();
    document.addEventListener('keydown', onKey);
    drawMasthead();
    syncBlocks();
    setTab(S.tab);
    changed(true);
  }

  function setTab(tab) {
    S.tab = tab;
    Object.keys(els.tabs).forEach(function (k) { els.tabs[k].setAttribute('aria-selected', String(k === tab)); });
    els.pageView.hidden = tab !== 'page';
    els.formView.hidden = tab !== 'fm';
    els.problemsView.hidden = tab !== 'problems';
    if (tab !== 'page') hideGutter();
    scheduleChips();
    if (tab === 'fm') drawForm();
    if (tab === 'problems') drawProblems();
  }

  function changed(initial) {
    var d = dirty();
    els.state.textContent = d ? 'Unsaved changes' : 'Saved · ' + S.eol + (S.bom ? ' · BOM' : '');
    els.state.className = 'ed-state' + (d ? ' is-dirty' : '');
    els.undo.disabled = !S.undo.length;
    els.redo.disabled = !S.redo.length;
    drawProblemCount();
    if (!initial) scheduleRefresh();
  }

  var refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { refresh(false); }, 700);
  }

  /** Masthead, stylesheet and checks for the state as it is now. */
  function refresh(loud) {
    if (!S) return Promise.resolve();
    var slug = S.slug;
    return post('/api/compose', { source: S.source, slug: S.slug, state: docState() }).then(function (out) {
      if (!S || S.slug !== slug) return;
      if (out.css !== S.css) { S.css = out.css; pageCss.textContent = out.css; }
      S.masthead = out.masthead;
      S.mastheadError = out.mastheadError;
      S.validation = out.validation;
      drawMasthead();
      drawProblemCount();
      if (S.tab === 'problems') drawProblems();
      if (S.tab === 'fm') drawFmErrors();
      if (loud) {
        var n = out.validation.errors.length;
        toast(n ? n + ' problem(s) the build would refuse. See Problems.' : 'The build’s checks pass.' + (out.validation.warnings.length ? ' ' + out.validation.warnings.length + ' warning(s).' : ''), n ? 'bad' : 'ok');
      }
    }, function (err) { if (loud) toast(err.message, 'bad'); });
  }

  function drawMasthead() {
    if (S.masthead) {
      var t = document.createElement('template');
      t.innerHTML = S.masthead;
      els.masthead.replaceChildren(t.content);
    } else {
      els.masthead.replaceChildren(h('div', { class: 'ed-masthead-missing' },
        'The masthead cannot be drawn until the front matter is right: ' + (S.mastheadError || ''),
        ' ', h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Front matter', onclick: function () { setTab('fm'); } })));
    }
  }

  // ------------------------------------------------------------- problems

  function drawProblemCount() {
    var v = S.validation || { errors: [], warnings: [] };
    els.tabs.problems.replaceChildren('Problems', v.errors.length ? h('span', { class: 'ed-count', text: String(v.errors.length) }) : '');
  }

  function drawProblems() {
    var v = S.validation;
    var all = v.errors.concat(v.warnings);
    var verdict = v.errors.length
      ? (S.source === 'published'
        ? 'The deploy build would fail on this article. It is published, so this is what CI runs.'
        : 'This draft has problems the build would refuse once it is published.')
      : 'The build’s checks pass' + (v.warnings.length ? ', with warnings.' : '.');
    fill(els.problemsView,
      h('p', { class: 'ed-verdict', text: verdict }),
      h('p', { class: 'ed-file', text: 'Checked: the state on screen, saved or not. Remote images are not fetched here; the build checks them.' }),
      all.length ? h('ul', null, all.map(function (p) {
        var block = p.block !== undefined ? p.block : null;
        return h('li', { class: 'is-' + p.level },
          h('span', { class: 'ed-lvl', text: p.level + ' · ' + p.area }),
          h('span', null,
            block !== null ? h('button', { type: 'button', text: 'Block ' + (block + 1), onclick: function () { goToBlock(block); } }) : null,
            block !== null ? ' — ' : '',
            p.message));
      })) : null);
  }

  function goToBlock(index) {
    setTab('page');
    var b = S.blocks[index];
    if (!b) return;
    select(b.id);
    var nodes = nodesOf(b);
    if (nodes[0] && nodes[0].scrollIntoView) nodes[0].scrollIntoView({ block: 'center' });
  }

  // ------------------------------------------------------------ the blocks

  function activateScripts(root) {
    root.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  }

  function nodesOf(block) {
    if (S.editing === block.id) return [editPanelFor(block)];
    var cached = S.nodes.get(block);
    if (cached) return cached;
    var nodes;
    if (block.error) {
      nodes = [h('div', { class: 'ed-broken' },
        h('p', { class: 'ed-why', text: block.error }),
        h('pre', { text: block.src }))];
    } else if (block.pending) {
      nodes = [h('div', { class: 'ed-ghost', text: 'Rendering…' })];
    } else {
      var t = document.createElement('template');
      t.innerHTML = block.html;
      nodes = [];
      Array.prototype.slice.call(t.content.childNodes).forEach(function (n) {
        if (n.nodeType === 1) nodes.push(n);
        else if (n.nodeType === 3 && n.textContent.trim()) nodes.push(h('p', { text: n.textContent }));
      });
      if (!nodes.length) nodes = [h('div', { class: 'ed-ghost', text: 'Draws nothing on the page: ' + block.src })];
      nodes.forEach(activateScripts);
    }
    nodes.forEach(function (n) { n.setAttribute('data-bid', String(block.id)); });
    S.nodes.set(block, nodes);
    return nodes;
  }

  /** Put the DOM in the order of S.blocks, moving as little as possible. */
  function syncBlocks() {
    var want = [];
    S.blocks.forEach(function (b) { want.push.apply(want, nodesOf(b)); });
    var prose = els.prose;
    var cursor = prose.firstChild;
    want.forEach(function (node) {
      if (node === cursor) cursor = cursor.nextSibling;
      else prose.insertBefore(node, cursor);
    });
    while (cursor) {
      var next = cursor.nextSibling;
      cursor.remove();
      cursor = next;
    }
    paintSelection();
    if (S.editing === null) hideGutterIfGone();
    scheduleChips();
  }

  function indexOfId(id) {
    for (var i = 0; i < S.blocks.length; i += 1) if (S.blocks[i].id === id) return i;
    return -1;
  }

  function blockAt(node) {
    var el = node && node.closest ? node.closest('[data-bid]') : null;
    if (!el || el.parentNode !== els.prose) return null;
    var i = indexOfId(Number(el.getAttribute('data-bid')));
    return i === -1 ? null : S.blocks[i];
  }

  /** Re-render whatever is pending, and move the standfirst if it has moved. */
  function fixLedes() {
    var owner = -1;
    for (var i = 0; i < S.blocks.length; i += 1) if (S.blocks[i].candidate) { owner = i; break; }
    var jobs = [];
    S.blocks.forEach(function (b, i) {
      if (b.id === S.editing) return;
      if (b.pending) jobs.push({ id: b.id, src: b.src, lede: owner === -1 || owner > i });
      else if (b.candidate && b.lede !== (i === owner)) jobs.push({ id: b.id, src: b.src, lede: i === owner });
    });
    if (!jobs.length) return Promise.resolve();
    return post('/api/render', { source: S.source, slug: S.slug, items: jobs }).then(function (out) {
      var changedAny = false;
      out.items.forEach(function (view, k) {
        var i = indexOfId(jobs[k].id);
        if (i === -1 || S.blocks[i].src !== jobs[k].src || S.blocks[i].id === S.editing) return;
        S.blocks[i] = makeBlock(view, S.blocks[i].orig, S.blocks[i].id);
        changedAny = true;
      });
      if (changedAny) { syncBlocks(); return fixLedes(); }
    });
  }

  function select(id) {
    S.selected = id;
    paintSelection();
  }

  function paintSelection() {
    els.prose.querySelectorAll('.ed-sel').forEach(function (n) { n.classList.remove('ed-sel'); });
    if (S.selected === null || S.editing === S.selected) return;
    els.prose.querySelectorAll('[data-bid="' + S.selected + '"]').forEach(function (n) { n.classList.add('ed-sel'); });
  }

  // ------------------------------------------------------- block operations

  function insertBlocks(index, views, edit) {
    snapshot();
    var made = views.map(function (v) { return makeBlock(v, undefined); });
    S.blocks.splice.apply(S.blocks, [index, 0].concat(made));
    S.blocks = S.blocks.slice();
    if (edit && made.length) { S.editing = made[0].id; S.selected = made[0].id; }
    syncBlocks();
    fixLedes();
    changed();
    if (edit && made.length) focusEditor();
    return made;
  }

  function insertTemplate(index, src) {
    insertBlocks(index, [{ src: src, type: guessType(src), html: '', error: null, pending: true }], true);
  }

  function removeBlock(id) {
    var i = indexOfId(id);
    if (i === -1) return;
    snapshot();
    S.blocks = S.blocks.filter(function (b) { return b.id !== id; });
    if (S.editing === id) S.editing = null;
    var next = S.blocks[Math.min(i, S.blocks.length - 1)];
    S.selected = next ? next.id : null;
    syncBlocks();
    fixLedes();
    changed();
  }

  function duplicateBlock(id) {
    var i = indexOfId(id);
    if (i === -1) return;
    var b = S.blocks[i];
    var copy = makeBlock({ src: b.src, type: b.type, html: b.html, error: b.error, candidate: b.candidate, lede: false, referenced: b.referenced }, undefined);
    snapshot();
    S.blocks = S.blocks.slice(0, i + 1).concat([copy], S.blocks.slice(i + 1));
    S.selected = copy.id;
    syncBlocks();
    fixLedes();
    changed();
  }

  function moveBlock(id, to) {
    var from = indexOfId(id);
    if (from === -1) return;
    var target = Math.max(0, Math.min(S.blocks.length, to));
    if (target === from || target === from + 1) return;
    snapshot();
    var list = S.blocks.slice();
    var b = list.splice(from, 1)[0];
    list.splice(target > from ? target - 1 : target, 0, b);
    S.blocks = list;
    S.selected = id;
    syncBlocks();
    fixLedes();
    changed();
    positionGutter(b);
  }

  function nudge(id, delta) {
    var i = indexOfId(id);
    if (i === -1) return;
    moveBlock(id, delta < 0 ? i - 1 : i + 2);
    var nodes = nodesOf(S.blocks[indexOfId(id)]);
    if (nodes[0]) nodes[0].scrollIntoView({ block: 'nearest' });
  }

  // ------------------------------------------------------------- the gutter

  var gutterBlock = null;

  var LABELS = {
    heading: 'Heading', paragraph: 'Paragraph', list: 'List', image: 'Image', clip: 'Clip', figure: 'Drawn figure',
    remote: 'Remote image', aside: 'Aside', code: 'Code', quote: 'Quote', rule: 'Rule', table: 'Table', html: 'HTML', raw: 'Raw',
  };

  function labelOf(b) {
    if (b.type === 'heading') {
      var n = /^#+/.exec(b.src);
      var level = n ? n[0].length : 0;
      return level === 1 ? 'Part' : level ? 'H' + level : 'Heading';
    }
    if (b.type === 'paragraph' && b.lede) return 'Standfirst';
    return LABELS[b.type] || b.type;
  }

  function guessType(src) {
    if (/^#{1,6}\s/.test(src)) return 'heading';
    if (/^<aside>/.test(src)) return 'aside';
    if (/^```|^~~~/.test(src)) return 'code';
    if (/^!\[[^\]]*\]\(figure:/.test(src)) return 'figure';
    if (/^!\[/.test(src)) return 'image';
    if (/^[-*+] |^\d+\. /.test(src)) return 'list';
    return 'paragraph';
  }

  function buildGutter() {
    var kind = h('span', { class: 'ed-kind' });
    var handle = h('span', { class: 'ed-handle', draggable: 'true', title: 'Drag to move (or Alt+↑ / Alt+↓)', text: '⠿' });
    handle.addEventListener('dragstart', function (e) {
      if (!gutterBlock) return;
      dragId = gutterBlock.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/x-block', String(dragId));
      nodesOf(gutterBlock).forEach(function (n) { n.classList.add('ed-dragging'); });
    });
    handle.addEventListener('dragend', function () {
      dragId = null;
      els.dropline.hidden = true;
      els.prose.querySelectorAll('.ed-dragging').forEach(function (n) { n.classList.remove('ed-dragging'); });
    });
    var btn = function (text, title, fn) {
      return h('button', { type: 'button', text: text, title: title, onclick: function (e) {
        e.stopPropagation();
        if (gutterBlock) fn(gutterBlock, e.currentTarget);
      } });
    };
    var g = h('div', { class: 'ed-gutter', hidden: true },
      handle,
      kind,
      btn('✎', 'Edit (Enter)', function (b) { startEdit(b.id); }),
      btn('+↑', 'Insert a block above', function (b, el) { openInsertMenu(el, indexOfId(b.id)); }),
      btn('+↓', 'Insert a block below', function (b, el) { openInsertMenu(el, indexOfId(b.id) + 1); }),
      btn('⧉', 'Duplicate (Ctrl+D)', function (b) { duplicateBlock(b.id); }),
      btn('↑', 'Move up (Alt+↑)', function (b) { nudge(b.id, -1); }),
      btn('↓', 'Move down (Alt+↓)', function (b) { nudge(b.id, 1); }),
      btn('✕', 'Delete (Delete)', function (b) { removeBlock(b.id); }));
    g.addEventListener('mouseleave', function (e) {
      if (!els.prose.contains(e.relatedTarget)) hover(null);
    });
    g._kind = kind;
    return g;
  }

  function blockRect(b) {
    var nodes = nodesOf(b);
    var top = Infinity, bottom = -Infinity;
    nodes.forEach(function (n) {
      if (!n.isConnected) return;
      var r = n.getBoundingClientRect();
      if (!r.width && !r.height) return;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    });
    return top === Infinity ? null : { top: top + scrollY, bottom: bottom + scrollY };
  }

  function nearestBlock(y) {
    var best = null;
    var dist = Infinity;
    S.blocks.forEach(function (b) {
      var r = blockRect(b);
      if (!r) return;
      var d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < dist) { dist = d; best = b; }
    });
    return best;
  }

  /**
   * A block that draws nothing where it stands — the page hides a rule that
   * comes straight before a part — still has to be reachable. It gets a chip
   * in the right margin at its place, which edits it.
   */
  var chipY = new Map();
  var chipFrame = 0;
  function scheduleChips() {
    cancelAnimationFrame(chipFrame);
    chipFrame = requestAnimationFrame(drawChips);
  }
  function drawChips() {
    if (!S || !els.chips) return;
    els.chips.replaceChildren();
    chipY.clear();
    if (S.tab !== 'page') return;
    var prose = els.prose.getBoundingClientRect();
    S.blocks.forEach(function (b, i) {
      if (S.editing === b.id || blockRect(b)) return;
      var y = null;
      for (var j = i + 1; j < S.blocks.length && y === null; j += 1) { var n = blockRect(S.blocks[j]); if (n) y = n.top - 30; }
      for (var k = i - 1; k >= 0 && y === null; k -= 1) { var p2 = blockRect(S.blocks[k]); if (p2) y = p2.bottom + 6; }
      if (y === null) y = prose.top + scrollY;
      chipY.set(b.id, y);
      var chip = h('button', { class: 'ed-chip', type: 'button', text: labelOf(b) + ' · not drawn here',
        title: 'This block draws nothing at this point of the page (the page hides a rule just before a part, for one). Click to edit it.' });
      chip.addEventListener('click', function () { startEdit(b.id); });
      chip.addEventListener('mouseenter', function () { hover(b); });
      chip.style.top = y + 'px';
      chip.style.left = prose.right + scrollX + 14 + 'px';
      els.chips.appendChild(chip);
    });
  }

  function positionGutter(b) {
    if (!b || S.tab !== 'page') return hideGutter();
    var r = blockRect(b) || (chipY.has(b.id) ? { top: chipY.get(b.id), bottom: chipY.get(b.id) + 20 } : null);
    if (!r) return hideGutter();
    gutterBlock = b;
    var g = els.gutter;
    g._kind.textContent = labelOf(b);
    g.hidden = false;
    var prose = els.prose.getBoundingClientRect();
    // A column in the left margin when it fits there; a row above the block when not.
    g.classList.add('is-col');
    var left = prose.left + scrollX - g.offsetWidth - 16;
    if (left < scrollX + 4) {
      g.classList.remove('is-col');
      g.style.left = Math.max(scrollX + 4, prose.left + scrollX) + 'px';
      g.style.top = r.top - g.offsetHeight - 6 + 'px';
    } else {
      g.style.left = left + 'px';
      g.style.top = r.top + 'px';
    }
  }

  function hideGutter() {
    gutterBlock = null;
    if (els.gutter) els.gutter.hidden = true;
  }

  function hideGutterIfGone() {
    if (gutterBlock && indexOfId(gutterBlock.id) === -1) hideGutter();
    else if (gutterBlock) {
      var i = indexOfId(gutterBlock.id);
      positionGutter(S.blocks[i]);
    }
  }

  var hovered = null;
  function hover(b) {
    if (hovered === (b && b.id)) return;
    els.prose.querySelectorAll('.ed-hover').forEach(function (n) { n.classList.remove('ed-hover'); });
    hovered = b ? b.id : null;
    if (!b) return;
    if (S.editing !== b.id) nodesOf(b).forEach(function (n) { n.classList.add('ed-hover'); });
    positionGutter(b);
  }

  // ------------------------------------------------- page events and drag

  var dragId = null;

  function dropIndexAt(y) {
    var best = S.blocks.length;
    for (var i = 0; i < S.blocks.length; i += 1) {
      var r = blockRect(S.blocks[i]);
      if (!r) continue;
      if (y < (r.top + r.bottom) / 2) { best = i; break; }
    }
    return best;
  }

  function showDropLine(index) {
    var prose = els.prose.getBoundingClientRect();
    var y;
    if (index < S.blocks.length) {
      var r = blockRect(S.blocks[index]);
      y = r ? r.top - 10 : 0;
    } else {
      var last = S.blocks.length ? blockRect(S.blocks[S.blocks.length - 1]) : null;
      y = last ? last.bottom + 6 : prose.top + scrollY;
    }
    var d = els.dropline;
    d.hidden = false;
    d.style.left = prose.left + scrollX + 'px';
    d.style.width = prose.width + 'px';
    d.style.top = y + 'px';
  }

  function wirePage() {
    var view = els.pageView;
    view.addEventListener('mousemove', function (e) {
      if (dragId !== null) return;
      var b = blockAt(e.target);
      // Between blocks — in the page's own margins — the nearest one answers.
      if (!b && e.target === els.prose) b = nearestBlock(e.pageY);
      if (b) hover(b);
    });
    view.addEventListener('mouseleave', function (e) {
      if (!els.gutter.contains(e.relatedTarget)) hover(null);
    });
    els.prose.addEventListener('click', function (e) {
      if (e.target.closest('.ed-edit')) return;
      var b = blockAt(e.target);
      if (!b) return;
      e.preventDefault();
      startEdit(b.id);
    });
    view.addEventListener('dragover', function (e) {
      var files = e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
      if (dragId === null && !files) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = files ? 'copy' : 'move';
      showDropLine(dropIndexAt(e.pageY));
    });
    view.addEventListener('dragleave', function (e) {
      if (!view.contains(e.relatedTarget)) els.dropline.hidden = true;
    });
    view.addEventListener('drop', function (e) {
      e.preventDefault();
      els.dropline.hidden = true;
      var index = dropIndexAt(e.pageY);
      if (dragId !== null) {
        var id = dragId;
        dragId = null;
        moveBlock(id, index);
        return;
      }
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      if (files.length) addImageFiles(files, index);
    });
    window.addEventListener('resize', function () { if (gutterBlock) positionGutter(gutterBlock); scheduleChips(); });
    new ResizeObserver(scheduleChips).observe(els.prose);
  }

  function onKey(e) {
    if (!S) return;
    var inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return; }
    if (document.querySelector('dialog[open]')) return;
    if (inField) return;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(S.undo, S.redo); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); restore(S.redo, S.undo); return; }
    if (S.tab !== 'page' || S.selected === null || indexOfId(S.selected) === -1) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); nudge(S.selected, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); startEdit(S.selected); return; }
    if (e.key === 'Delete') { e.preventDefault(); removeBlock(S.selected); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateBlock(S.selected); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      var i = indexOfId(S.selected) + (e.key === 'ArrowUp' ? -1 : 1);
      if (S.blocks[i]) {
        e.preventDefault();
        select(S.blocks[i].id);
        var n = nodesOf(S.blocks[i])[0];
        if (n) n.scrollIntoView({ block: 'nearest' });
        positionGutter(S.blocks[i]);
      }
    }
    if (e.key === 'Escape') select(null);
  }

  // ----------------------------------------------------------- insert menu

  function templates() {
    var fig = S.figures[0] ? S.figures[0].name : 'sine';
    return [
      ['Paragraph', 'Prose. The first one is the standfirst.', ''],
      ['Part', '# heading: a drawn rule, a big label, a date line', '# Label | Date'],
      ['Section', '## heading, under the part before it', '## Section'],
      ['Subsection', '### heading', '### Subsection'],
      ['List', 'Bulleted list', '- '],
      ['Image', 'A still or a clip from media/ — or add one', null],
      ['Drawn figure', 'One of the shared drawings, by name', '![](figure:' + fig + ' "")'],
      ['Aside', 'A torn-paper note; an emoji first is its icon', '<aside>\n💡 \n</aside>'],
      ['Code', 'Fenced code with a language', '```gdscript\n\n```'],
      ['Screen words', 'Words true for where the contents is', '[[wide: …]] [[band: …]] [[menu: …]]'],
      ['Rule', 'A divider', '---'],
      ['Raw', 'Any Markdown or HTML, as written', ''],
    ];
  }

  var menuEl = null;
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('mousedown', menuOutside, true);
  }
  function menuOutside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }

  function openInsertMenu(anchor, index) {
    closeMenu();
    var items = templates().map(function (t) {
      return h('button', { type: 'button', onclick: function () {
        closeMenu();
        if (t[2] === null) {
          pickMedia().then(function (file) {
            if (file) insertTemplate(index, '![](media/' + file + ' "")');
          });
        } else {
          insertTemplate(index, t[2]);
        }
      } }, h('b', { text: t[0] }), h('span', { text: t[1] }));
    });
    menuEl = h('div', { class: 'ed-menu', role: 'menu' }, items);
    document.body.appendChild(menuEl);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + scrollY + 4;
    if (r.bottom + menuEl.offsetHeight > innerHeight) top = Math.max(scrollY + 8, r.top + scrollY - menuEl.offsetHeight - 4);
    menuEl.style.top = top + 'px';
    menuEl.style.left = Math.max(8, Math.min(r.left + scrollX, scrollX + innerWidth - menuEl.offsetWidth - 8)) + 'px';
    menuEl.querySelector('button').focus();
    menuEl.addEventListener('keydown', function (e) {
      var list = Array.prototype.slice.call(menuEl.querySelectorAll('button'));
      var at = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
    });
    setTimeout(function () { document.addEventListener('mousedown', menuOutside, true); }, 0);
  }

  // ------------------------------------------------------------ editing

  var IMG = /^!\[((?:[^\]\\]|\\.)*)\]\(\s*([^\s)"]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)(\{[^}]*\})?$/;
  var HEAD = /^(#{1,3})[ \t]+(.*?)[ \t]*$/;
  var ASIDE = /^<aside>\n([\s\S]*)\n<\/aside>$/;
  var ICON = /^(\p{Extended_Pictographic}️?)\s*/u;
  var FENCE = /^( {0,3})(`{3,}|~{3,})([^\n]*)(\n[\s\S]*)$/;

  function escapeTitle(s) { return s.replace(/\\?"/g, function (m) { return m === '"' ? '\\"' : m; }); }
  function escapeAlt(s) { return s.replace(/\\?[[\]]/g, function (m) { return m.length === 1 ? '\\' + m : m; }); }

  function startEdit(id) {
    if (S.editing === id) return;
    if (S.editing !== null) commitEdit({ silent: true });
    panels.delete(id);
    S.editing = id;
    S.selected = id;
    hover(null);
    syncBlocks();
    focusEditor();
  }

  function focusEditor() {
    var ta = els.prose.querySelector('.ed-edit .ed-src');
    if (!ta) return;
    autosize(ta);
    ta.focus();
    var end = ta.value.length;
    ta.setSelectionRange(end, end);
    var panel = ta.closest('.ed-edit');
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
  }

  function autosize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight + 2, 52) + 'px';
  }

  var panels = new Map();

  function editPanelFor(block) {
    var existing = panels.get(block.id);
    if (existing) { existing._block = block; return existing; }
    var ta = h('textarea', { class: 'ed-src', spellcheck: 'true', 'aria-label': 'Markdown source of this block', rows: '2' });
    ta.value = block.src;
    var fields = h('div', { class: 'ed-fields' });
    var panel = h('div', { class: 'ed-edit' },
      h('div', { class: 'ed-edit-head' },
        h('span', { class: 'ed-kind', text: labelOf(block) }),
        h('span', { class: 'ed-hint', text: 'Esc or click away to finish · Alt+↑/↓ moves it' })),
      fields,
      toolbar(ta),
      ta,
      h('div', { class: 'ed-foot' },
        h('span', { text: 'Markdown, exactly as it is saved.' }),
        h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Done', onclick: function () { commitEdit(); } })));
    panel._block = block;
    panel._ta = ta;
    panel._fields = fields;
    ta.addEventListener('input', function () { autosize(ta); drawFields(panel); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEdit(); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        var id = block.id;
        var up = e.key === 'ArrowUp';
        commitEdit().then(function () {
          if (indexOfId(id) === -1) return;
          nudge(id, up ? -1 : 1);
          startEdit(id);
        });
      }
    });
    panel.addEventListener('focusout', function () {
      setTimeout(function () {
        if (!panel.isConnected || S.editing !== block.id) return;
        if (panel.contains(document.activeElement)) return;
        if (document.querySelector('dialog[open]')) return;
        if (menuEl) return;
        commitEdit();
      }, 120);
    });
    drawFields(panel);
    panels.set(block.id, panel);
    return panel;
  }

  function setSource(panel, src) {
    var ta = panel._ta;
    ta.value = src;
    autosize(ta);
  }

  function field(label, control, wide) {
    return h('label', { class: wide ? 'ed-wide' : '' }, h('span', { class: 'ed-field-label', text: label }), control);
  }

  /** Helper fields for the kinds of block that have a shape; the source stays the truth. */
  function drawFields(panel) {
    var src = panel._ta.value;
    var box = panel._fields;
    var out = [];
    var trimmed = src.trim();
    var m;
    if ((m = HEAD.exec(trimmed)) && trimmed.indexOf('\n') === -1) {
      var level = m[1].length;
      var rest = m[2];
      var idm = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(rest);
      var id = idm ? idm[1] : '';
      if (idm) rest = rest.slice(0, idm.index);
      var label = rest;
      var date = '';
      if (level === 1 && rest.indexOf(' | ') !== -1) {
        label = rest.slice(0, rest.indexOf(' | '));
        date = rest.slice(rest.indexOf(' | ') + 3);
      }
      var lv = h('select', { class: 'ed-select', name: 'level' },
        h('option', { value: '1', text: '# Part' }), h('option', { value: '2', text: '## Section' }), h('option', { value: '3', text: '### Subsection' }));
      lv.value = String(level);
      var la = h('input', { class: 'ed-input', name: 'label', value: label });
      var da = h('input', { class: 'ed-input', name: 'date', value: date, placeholder: 'June 19', disabled: level !== 1 });
      var ia = h('input', { class: 'ed-input ed-mono-input', name: 'id', value: id, placeholder: 'from its words' });
      var write = function () {
        var l = Number(lv.value);
        var anchor = ia.value.trim().replace(/[^A-Za-z0-9_-]/g, '');
        da.disabled = l !== 1;
        setSource(panel, '#'.repeat(l) + ' ' + la.value + (l === 1 && da.value.trim() ? ' | ' + da.value.trim() : '') + (anchor ? ' {#' + anchor + '}' : ''));
      };
      [lv, la, da, ia].forEach(function (c) { c.addEventListener('input', write); c.addEventListener('change', write); });
      out.push(field('Level', lv), field('Label', la), field('Date line (parts only)', da), field('Anchor id', ia));
    } else if ((m = IMG.exec(trimmed))) {
      var alt = m[1], href = m[2], caption = m[3] || '', attrs = m[4] || '';
      var figure = href.indexOf('figure:') === 0;
      var remote = /^https?:\/\//i.test(href);
      var cap = h('input', { class: 'ed-input', name: 'caption', value: caption, placeholder: 'Markdown; *emphasis* and `code` work' });
      var al = h('input', { class: 'ed-input', name: 'alt', value: alt, placeholder: figure ? 'ignored: the drawing describes itself' : 'only what the caption does not say', disabled: figure });
      var srcControl;
      var thumb = null;
      if (figure) {
        srcControl = h('select', { class: 'ed-select', name: 'figure' }, S.figures.map(function (f) {
          return h('option', { value: 'figure:' + f.name, text: f.name + ' — ' + f.label.slice(0, 60) });
        }));
        srcControl.value = href;
        if (srcControl.value !== href) {
          srcControl.prepend(h('option', { value: href, text: href + ' (not in the registry)' }));
          srcControl.value = href;
        }
      } else if (remote) {
        srcControl = h('input', { class: 'ed-input ed-mono-input', name: 'url', value: href });
      } else {
        var name = href.replace(/^media\//, '');
        srcControl = h('select', { class: 'ed-select', name: 'media' }, mediaChoices().map(function (f) {
          return h('option', { value: 'media/' + f, text: f });
        }));
        if (S.media.indexOf(name) === -1) srcControl.prepend(h('option', { value: href, text: href + ' (missing)' }));
        srcControl.value = href;
        thumb = h('img', { class: 'ed-thumb', alt: '', src: thumbFor(name) });
      }
      var write2 = function () {
        var s = srcControl.value;
        var c = cap.value;
        setSource(panel, '![' + escapeAlt(al.value) + '](' + s + (c ? ' "' + escapeTitle(c) + '"' : '') + ')' + attrs);
        if (thumb) thumb.src = thumbFor(s.replace(/^media\//, ''));
      };
      [srcControl, cap, al].forEach(function (c) { c.addEventListener('input', write2); c.addEventListener('change', write2); });
      out.push(field(figure ? 'Drawn figure' : remote ? 'URL' : 'Media file', srcControl));
      if (!figure && !remote) {
        out.push(h('div', { class: 'ed-inline' },
          h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Choose or add…', onclick: function () {
            pickMedia().then(function (file) {
              if (!file) { panel._ta.focus(); return; }
              if (!Array.prototype.some.call(srcControl.options, function (o) { return o.value === 'media/' + file; })) {
                srcControl.appendChild(h('option', { value: 'media/' + file, text: file }));
              }
              srcControl.value = 'media/' + file;
              write2();
              panel._ta.focus();
            });
          } }), thumb));
      }
      out.push(field('Caption — the image’s title', cap, true), field('Alt text', al, true));
      if (remote) out.push(h('p', { class: 'ed-note-inline', text: 'A remote image keeps its {width=… height=…} after it; edit that in the source.' }));
    } else if ((m = ASIDE.exec(trimmed))) {
      var inner = m[1];
      var im = ICON.exec(inner);
      var icon = im ? im[1] : '';
      var body = im ? inner.slice(im[0].length) : inner;
      var ic = h('input', { class: 'ed-input', name: 'icon', value: icon, placeholder: 'an emoji, or empty', maxlength: '4' });
      ic.addEventListener('input', function () {
        var cur = ASIDE.exec(panel._ta.value.trim());
        var innerNow = cur ? cur[1] : body;
        var imNow = ICON.exec(innerNow);
        var rest = imNow ? innerNow.slice(imNow[0].length) : innerNow;
        var glyph = ic.value.trim();
        setSource(panel, '<aside>\n' + (glyph ? glyph + ' ' : '') + rest + '\n</aside>');
      });
      out.push(field('Icon', ic), h('p', { class: 'ed-note-inline', text: 'The note is the Markdown between <aside> and </aside>.' }));
    } else if ((m = FENCE.exec(trimmed))) {
      var lang = h('input', { class: 'ed-input ed-mono-input', name: 'lang', value: m[3].trim(), placeholder: 'gdscript, python… or empty', list: 'ed-langs' });
      var fenceIndent = m[1], fence = m[2];
      lang.addEventListener('input', function () {
        var cur = FENCE.exec(panel._ta.value.trim());
        if (!cur) return;
        setSource(panel, fenceIndent + fence + lang.value.trim() + cur[4]);
      });
      out.push(field('Language', lang), h('datalist', { id: 'ed-langs' }, ['gdscript', 'python', 'javascript', 'typescript', 'json', 'shell', 'text'].map(function (l) { return h('option', { value: l }); })),
        h('p', { class: 'ed-note-inline', text: 'gdscript is highlighted; any other language is shown plain under its name.' }));
    }
    box.replaceChildren.apply(box, out);
    box.hidden = !out.length;
  }

  function mediaChoices() {
    return S.media.filter(function (f) {
      var stem = f.replace(/\.[^.]+$/, '');
      var ext = f.slice(stem.length + 1).toLowerCase();
      if (ext === 'webm') return false;
      if (ext === 'webp' && S.media.indexOf(stem + '.mp4') !== -1) return false;
      return ['webp', 'png', 'jpg', 'jpeg', 'mp4'].indexOf(ext) !== -1;
    });
  }

  function thumbFor(file) {
    if (/\.mp4$/i.test(file)) file = file.replace(/\.mp4$/i, '.webp');
    return '/writing/' + S.slug + '/' + encodeURIComponent(file);
  }

  function toolbar(ta) {
    function wrap(before, after, placeholder, selectFrom, selectLen) {
      var s = ta.selectionStart, e = ta.selectionEnd;
      var sel = ta.value.slice(s, e) || placeholder;
      var text = before + sel + after;
      ta.focus();
      ta.setSelectionRange(s, e);
      if (!document.execCommand('insertText', false, text)) {
        ta.setRangeText(text, s, e, 'end');
        ta.dispatchEvent(new Event('input'));
      }
      if (selectFrom !== undefined) ta.setSelectionRange(s + selectFrom(sel), s + selectFrom(sel) + selectLen);
      else ta.setSelectionRange(s + before.length, s + before.length + sel.length);
    }
    function b(label, title, fn) {
      var el = h('button', { type: 'button', text: label, title: title });
      el.addEventListener('mousedown', function (e) { e.preventDefault(); });
      el.addEventListener('click', fn);
      return el;
    }
    return h('div', { class: 'ed-toolbar' },
      b('B', 'Bold', function () { wrap('**', '**', 'bold'); }),
      b('I', 'Italic', function () { wrap('*', '*', 'italic'); }),
      b('Link', 'Link', function () { wrap('[', '](https://)', 'text', function (sel) { return sel.length + 3; }, 8); }),
      b('`c`', 'Inline code', function () { wrap('`', '`', 'code'); }),
      h('span', { class: 'ed-sep' }),
      b('wide', 'Words only when the contents is in the right gutter', function () { wrap('[[wide: ', ']]', '…'); }),
      b('band', 'Words only when the contents is a band above the article (no script)', function () { wrap('[[band: ', ']]', '…'); }),
      b('menu', 'Words only when the contents is behind the menu button', function () { wrap('[[menu: ', ']]', '…'); }),
      b('all three', 'One sentence per place the contents can be', function () {
        var s = ta.selectionStart, e = ta.selectionEnd;
        var sel = ta.value.slice(s, e) || '…';
        wrap('', '', '[[wide: ' + sel + ']] [[band: ' + sel + ']] [[menu: ' + sel + ']]');
      }));
  }

  /** Finish editing: re-render, split if it became several blocks, drop it if empty. */
  function commitEdit(opts) {
    var id = S.editing;
    if (id === null) return Promise.resolve();
    var i = indexOfId(id);
    var panel = panels.get(id);
    S.editing = null;
    if (i === -1 || !panel) { syncBlocks(); return Promise.resolve(); }
    var block = S.blocks[i];
    var text = clean(panel._ta.value);
    panels.delete(id);
    if (!text.trim()) {
      S.editing = null;
      if (block.pending) {
        // An inserted block left empty: as if it had never been inserted.
        var snap = S.undo.pop();
        S.blocks = snap ? snap.blocks : S.blocks.filter(function (b) { return b.id !== id; });
        syncBlocks();
        changed();
        return Promise.resolve();
      }
      removeBlock(id);
      return Promise.resolve();
    }
    if (text === block.src && !block.pending) {
      syncBlocks();
      if (!(opts && opts.silent)) positionGutter(block);
      return Promise.resolve();
    }
    var owner = -1;
    for (var k = 0; k < S.blocks.length; k += 1) if (S.blocks[k].candidate && S.blocks[k].id !== id) { owner = k; break; }
    var lede = owner === -1 || owner > i;
    if (!block.pending) snapshot();
    var placeholder = Object.assign({}, block, { src: text, pending: true });
    S.blocks[i] = placeholder;
    S.blocks = S.blocks.slice();
    syncBlocks();
    changed();
    return post('/api/blocks', { source: S.source, slug: S.slug, items: [{ src: text, lede: lede }] }).then(function (out) {
      var parts = out.items[0].parts;
      var at = indexOfId(id);
      if (at === -1) return;
      var made = parts.map(function (view, n) { return n === 0 ? makeBlock(view, block.orig, id) : makeBlock(view, undefined); });
      S.blocks = S.blocks.slice(0, at).concat(made, S.blocks.slice(at + 1));
      syncBlocks();
      changed();
      return fixLedes();
    }, function (err) {
      toast(err.message, 'bad');
    });
  }

  // ----------------------------------------------------------------- media

  function addImageFiles(files, index) {
    var chain = Promise.resolve(index);
    files.forEach(function (file) {
      chain = chain.then(function (at) {
        return upload(file).then(function (name) {
          if (!name) return at;
          return post('/api/blocks', { source: S.source, slug: S.slug, items: [{ src: '![](media/' + name + ')', lede: false }] }).then(function (out) {
            insertBlocks(at, out.items[0].parts, false);
            return at + out.items[0].parts.length;
          });
        });
      });
    });
    return chain;
  }

  function upload(file) {
    if (/\.(gif|mp4|webm|mov|m4v|avi|mkv)$/i.test(file.name) || /^video\//.test(file.type) || file.type === 'image/gif') {
      toast(file.name + ': GIFs and videos become clips, which need transcoding. Run `npm run writing:media -- <originals-dir> ' + S.slug + '`, then add the .mp4.', 'bad');
      return Promise.resolve(null);
    }
    return fetch('/api/media?source=' + S.source + '&slug=' + S.slug + '&name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    }).then(function (res) {
      return res.json().then(function (json) {
        if (!res.ok) throw new Error(json.error || res.statusText);
        S.media = json.media;
        toast((json.reused ? 'Already in media/: ' : 'Added media/') + json.file, 'ok');
        return json.file;
      });
    }).catch(function (err) { toast(file.name + ': ' + err.message, 'bad'); return null; });
  }

  function usedMedia() {
    var used = {};
    S.blocks.forEach(function (b) { (b.referenced || []).forEach(function (f) { used[f] = true; }); });
    var d = (S.fm && S.fm.data) || {};
    if (typeof d.image === 'string') used[d.image.replace(/^media\//, '')] = true;
    if (d.banner && typeof d.banner === 'object') ['art', 'plateLight', 'plateDark'].forEach(function (k) { if (d.banner[k]) used[d.banner[k].replace(/^media\//, '')] = true; });
    return used;
  }

  function pickMedia() {
    return new Promise(function (resolve) {
      var dialog = h('dialog', { class: 'ed-dialog', 'aria-label': 'Media' });
      var grid = h('div', { class: 'ed-mediagrid' });
      var input = h('input', { type: 'file', accept: '.webp,.png,.jpg,.jpeg,image/webp,image/png,image/jpeg', multiple: true, hidden: true });
      var zone = h('div', { class: 'ed-dropzone' }, 'Drop a WebP, PNG or JPEG here, or ',
        h('button', { class: 'ed-btn ed-small', type: 'button', text: 'choose a file', onclick: function () { input.click(); } }),
        '. It is copied into media/ under a slugified name. GIFs and videos are transcoded by `npm run writing:media`, not here.');
      var done = function (value) { dialog.close(); dialog.remove(); resolve(value); };
      var draw = function () {
        var used = usedMedia();
        grid.replaceChildren.apply(grid, mediaChoices().map(function (f) {
          var clip = /\.mp4$/i.test(f);
          return h('button', { type: 'button', onclick: function () { done(f); } },
            h('img', { src: thumbFor(f), alt: '', loading: 'lazy' }),
            h('span', { class: 'ed-name', text: f }),
            h('span', { class: 'ed-use' + (used[f] ? '' : ' is-unused'), text: (clip ? 'clip · ' : '') + (used[f] ? 'in use' : 'not used yet') }));
        }));
        if (!grid.children.length) grid.appendChild(h('p', { class: 'ed-empty', text: 'media/ is empty.' }));
      };
      var take = function (files) {
        var chain = Promise.resolve(null);
        var last = null;
        Array.prototype.slice.call(files).forEach(function (file) {
          chain = chain.then(function () { return upload(file).then(function (name) { if (name) last = name; }); });
        });
        chain.then(function () { draw(); if (last && files.length === 1) done(last); });
      };
      input.addEventListener('change', function () { take(input.files); });
      zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('is-over'); });
      zone.addEventListener('dragleave', function () { zone.classList.remove('is-over'); });
      zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('is-over'); take(e.dataTransfer.files); });
      dialog.append(
        h('div', { class: 'ed-dialog-body' }, h('h2', { text: 'Media in ' + S.slug }), zone, input, grid),
        h('div', { class: 'ed-dialog-foot' }, h('button', { class: 'ed-btn', type: 'button', text: 'Cancel', onclick: function () { done(null); } })));
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); done(null); });
      document.body.appendChild(dialog);
      draw();
      dialog.showModal();
    });
  }

  // -------------------------------------------------------- save, preview

  function confirmDialog(title, paragraphs, okLabel, danger) {
    return new Promise(function (resolve) {
      var dialog = h('dialog', { class: 'ed-dialog' });
      var done = function (v) { dialog.close(); dialog.remove(); resolve(v); };
      dialog.append(
        h('div', { class: 'ed-dialog-body' }, h('h2', { text: title }), paragraphs),
        h('div', { class: 'ed-dialog-foot' },
          h('button', { class: 'ed-btn', type: 'button', text: 'Cancel', onclick: function () { done(false); } }),
          h('button', { class: 'ed-btn ' + (danger ? 'ed-danger' : 'ed-go'), type: 'button', text: okLabel, onclick: function () { done(true); } })));
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); done(false); });
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }

  var saving = false;
  function saveNow() {
    if (!S || saving) return;
    var wait = S.editing !== null ? commitEdit() : Promise.resolve();
    saving = true;
    wait.then(function () {
      if (S.blocks.some(function (b) { return b.pending; })) return fixLedes();
    }).then(function () {
      return post('/api/compose', { source: S.source, slug: S.slug, state: docState() });
    }).then(function (out) {
      S.validation = out.validation;
      drawProblemCount();
      var errors = out.validation.errors;
      if (S.source === 'published' && errors.length) {
        return confirmDialog('The deploy build would fail',
          [h('p', { text: 'This article is published, and the build CI runs would refuse it with ' + errors.length + ' problem(s):' }),
            h('ul', { class: 'ed-blockers' }, errors.slice(0, 12).map(function (p) { return h('li', { text: (p.block !== undefined ? 'block ' + (p.block + 1) + ': ' : '') + p.message }); })),
            h('p', { text: 'Saving writes the file anyway; nothing deploys until it is committed and pushed.' })],
          'Save anyway', true);
      }
      return true;
    }).then(function (go) {
      if (!go) return;
      return post('/api/save', { source: S.source, slug: S.slug, state: docState() }).then(function (out) {
        var n = out.validation.errors.length;
        toast((out.unchanged ? 'No changes: article.md is byte-for-byte what was there.' : 'Saved. Backup: ' + out.backup) +
          (n ? '\n' + n + ' problem(s) remain — see Problems.' : ''), n ? 'bad' : 'ok');
        var scroll = scrollY;
        var tab = S.tab;
        return reopen().then(function () { setTab(tab); scrollTo(0, scroll); });
      });
    }).catch(function (err) {
      toast(err.message, 'bad');
    }).then(function () { saving = false; });
  }

  function reopen() {
    var source = S.source, slug = S.slug;
    S.blocks = S.loaded.map(function (l) { return { src: l.src, orig: l.orig }; }); // quiet the dirty check
    S.fmRawText = null;
    S.fm = JSON.parse(S.fmLoaded);
    teardown();
    return new Promise(function (resolve) {
      openArticle(source, slug);
      var check = setInterval(function () { if (S && S.slug === slug && els.prose && els.prose.isConnected) { clearInterval(check); resolve(); } }, 30);
    });
  }

  function preview() {
    var tab = window.open('about:blank', '_blank');
    var go = S.editing !== null ? commitEdit() : Promise.resolve();
    go.then(function () {
      return post('/api/preview', { source: S.source, slug: S.slug, state: docState() });
    }).then(function (out) {
      if (tab) tab.location = out.url;
      else window.open(out.url, '_blank');
    }, function (err) {
      if (tab) tab.close();
      toast(err.message, 'bad');
    });
  }

  function publishFlow() {
    if (dirty()) { toast('Save first: publishing moves the folder as it is on disk.', 'bad'); return; }
    post('/api/publish-plan', { slug: S.slug }).then(function (plan) {
      var dialog = h('dialog', { class: 'ed-dialog' });
      var msg = h('span', { class: 'ed-msg' });
      var go = h('button', { class: 'ed-btn ed-go', type: 'button', text: 'Move it', disabled: plan.blockers.length > 0 });
      var close = function () { dialog.close(); dialog.remove(); };
      go.addEventListener('click', function () {
        go.disabled = true;
        post('/api/publish', { slug: S.slug, confirm: true }).then(function (out) {
          close();
          S.loaded = S.blocks.map(function (b) { return { src: b.src, orig: b.orig }; });
          toast('Moved to ' + out.to + '. Commit it in the site repository to deploy it.', 'ok');
          location.hash = '#/edit/published/' + out.slug;
        }, function (err) { msg.className = 'ed-msg is-bad'; msg.textContent = err.message; go.disabled = false; });
      });
      var warnings = plan.validation.warnings;
      dialog.append(
        h('div', { class: 'ed-dialog-body' },
          h('h2', { text: 'Publish “' + plan.slug + '”' }),
          h('p', null, 'This moves the folder', h('br'), h('code', { class: 'ed-path', text: plan.from }), h('br'), 'to', h('br'), h('code', { class: 'ed-path', text: plan.to })),
          h('p', { text: 'These ' + plan.files.length + ' file(s) move with it:' }),
          h('div', { class: 'ed-filelist' }, plan.files.map(function (f) { return h('div', { text: f }); })),
          plan.blockers.length ? [h('p', { text: 'It cannot be published yet:' }), h('ul', { class: 'ed-blockers' }, plan.blockers.concat(plan.validation.errors.map(function (p) {
            return (p.block !== undefined ? 'block ' + (p.block + 1) + ': ' : '') + p.message;
          })).map(function (t) { return h('li', { text: t }); }))] : null,
          warnings.length ? h('ul', { class: 'ed-warnings' }, warnings.map(function (p) { return h('li', { text: p.message }); })) : null,
          h('p', { text: 'Nothing is committed: the site repository will show the new folder as untracked, and the article goes live when that is committed and pushed.' })),
        h('div', { class: 'ed-dialog-foot' }, msg,
          h('button', { class: 'ed-btn', type: 'button', text: 'Cancel', onclick: close }), go));
      dialog.addEventListener('cancel', function (e) { e.preventDefault(); close(); });
      document.body.appendChild(dialog);
      dialog.showModal();
    }, function (err) { toast(err.message, 'bad'); });
  }

  // -------------------------------------------------------- front matter

  var ORDER = ['title', 'deck', 'author', 'handle', 'kind', 'date', 'published', 'updated', 'description', 'image',
    'keywords', 'about', 'award', 'elsewhere', 'colophon', 'canonical', 'toc', 'draft', 'banner'];

  function fmSet(key, value) {
    snapshotFm();
    var data = S.fm.data;
    var out = {};
    if (key in data) {
      Object.keys(data).forEach(function (k) { out[k] = k === key ? value : data[k]; });
    } else {
      var rank = ORDER.indexOf(key);
      var placed = false;
      Object.keys(data).forEach(function (k) {
        var r = ORDER.indexOf(k);
        if (!placed && r > rank) { out[key] = value; placed = true; }
        out[k] = data[k];
      });
      if (!placed) out[key] = value;
      dropTemplateComment(key);
    }
    S.fm.data = out;
    changed();
  }

  function fmDelete(key) {
    if (!(key in S.fm.data)) return;
    snapshotFm();
    var out = {};
    Object.keys(S.fm.data).forEach(function (k) { if (k !== key) out[k] = S.fm.data[k]; });
    S.fm.data = out;
    changed();
  }

  /** Typing into a field is one undo step per field visit, not one per key. */
  function snapshotFm() {
    var key = document.activeElement && document.activeElement.name;
    var top = S.undo[S.undo.length - 1];
    if (key && top && top.tag === 'fm:' + key) return;
    snapshot(key ? 'fm:' + key : null);
  }

  /** The new-draft template's `# key:` hint, and its indented lines, once the key is real. */
  function dropTemplateComment(key) {
    var comments = S.fm.comments;
    Object.keys(comments).forEach(function (path) {
      var lines = comments[path];
      var at = -1;
      for (var i = 0; i < lines.length; i += 1) if (new RegExp('^#\\s*' + key + ':').test(lines[i])) { at = i; break; }
      if (at === -1) return;
      var end = at + 1;
      while (end < lines.length && /^#\s{2,}\S/.test(lines[end])) end += 1;
      comments[path] = lines.slice(0, at).concat(lines.slice(end));
    });
  }

  function commentsFor(path) {
    var lines = (S.fm.comments[path] || []).filter(function (l) { return l.trim() !== ''; });
    return lines.length ? h('pre', { class: 'ed-comment', text: lines.join('\n') }) : null;
  }

  function row(key, label, help, control, opts) {
    opts = opts || {};
    return h('div', { class: 'ed-f' },
      h('div', { class: 'ed-k' }, label, opts.required ? h('small', { text: 'required' }) : h('small', { text: key })),
      h('div', null, commentsFor(key), control, help ? h('p', { class: 'ed-help', text: help }) : null, opts.error ? h('p', { class: 'ed-err', text: opts.error }) : null));
  }

  function str(key) {
    var v = S.fm.data[key];
    return typeof v === 'string' ? v : '';
  }

  function shapeError(key, want) {
    var v = S.fm.data[key];
    if (v === undefined || v === '') return null;
    var is = Array.isArray(v) ? 'list' : typeof v === 'object' ? 'map' : 'scalar';
    return is === want ? null : is;
  }

  function readonlyValue(key) {
    var v = S.fm.data[key];
    var text = Array.isArray(v) ? v.map(function (x) { return '- ' + x; }).join('\n')
      : typeof v === 'object' ? Object.keys(v).map(function (k) { return k + ': ' + v[k]; }).join('\n') : String(v);
    return h('pre', { class: 'ed-readonly', text: text });
  }

  function textRow(key, label, help, opts) {
    opts = opts || {};
    var bad = shapeError(key, 'scalar');
    if (bad) return row(key, label, help, readonlyValue(key), { required: opts.required, error: 'This has to be a single value, not a ' + bad + '. Edit it as text.' });
    var control = h(opts.multiline ? 'textarea' : 'input', { class: (opts.multiline ? 'ed-textarea' : 'ed-input') + (opts.mono ? ' ed-mono-input' : ''), name: key, placeholder: opts.placeholder || '', rows: opts.multiline ? '3' : null });
    control.value = str(key);
    control.addEventListener('input', function () {
      var v = control.value.replace(/[\r\n]+/g, ' ');
      if (v === '' && !opts.required) fmDelete(key);
      else fmSet(key, v);
    });
    return row(key, label, help, control, { required: opts.required });
  }

  function dateRow(key, label, help) {
    var bad = shapeError(key, 'scalar');
    if (bad) return row(key, label, help, readonlyValue(key), { error: 'This has to be a single date.' });
    var input = h('input', { class: 'ed-input', type: 'date', name: key, value: str(key) });
    var clear = h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Clear', onclick: function () { input.value = ''; fmDelete(key); } });
    input.addEventListener('change', function () { if (input.value) fmSet(key, input.value); else fmDelete(key); });
    var raw = str(key);
    var err = raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw) ? 'Not a date as written: "' + raw + '". Pick one to replace it.' : null;
    return row(key, label, help, h('div', { class: 'ed-inline' }, input, clear), { error: err });
  }

  function rangeRow() {
    var raw = str('date');
    var parts = raw.split(/\s*\.\.\s*/);
    var iso = /^\d{4}-\d{2}-\d{2}$/;
    var ok = parts.length <= 2 && parts.every(function (p) { return iso.test(p); });
    var start = h('input', { class: 'ed-input', type: 'date', name: 'date-start', value: ok ? parts[0] : '' });
    var end = h('input', { class: 'ed-input', type: 'date', name: 'date-end', value: ok && parts[1] ? parts[1] : '' });
    var write = function () {
      if (!start.value) { fmSet('date', ''); return; }
      fmSet('date', end.value && end.value !== start.value ? start.value + ' .. ' + end.value : start.value);
    };
    start.addEventListener('change', write);
    end.addEventListener('change', write);
    return row('date', 'Date', 'One day, or the days it covers. Shown on the masthead as “June 19 – June 28, 2024”.',
      h('div', { class: 'ed-inline' }, start, h('span', { class: 'ed-to', text: 'to' }), end),
      { required: true, error: raw && !ok ? 'As written: "' + raw + '" — not one date or two. Pick the dates to replace it.' : null });
  }

  function mediaSelect(name, value, onchange, allowNone) {
    var stills = S.media.filter(function (f) { return /\.(webp|png|jpe?g)$/i.test(f); });
    var sel = h('select', { class: 'ed-select', name: name },
      allowNone ? h('option', { value: '', text: '— none —' }) : null,
      stills.map(function (f) { return h('option', { value: 'media/' + f, text: f }); }));
    if (value && stills.indexOf(value.replace(/^media\//, '')) === -1) sel.appendChild(h('option', { value: value, text: value + ' (missing)' }));
    sel.value = value || '';
    sel.addEventListener('change', function () { onchange(sel.value); });
    return sel;
  }

  function listRow(key, label, help, links) {
    var bad = shapeError(key, 'list');
    if (bad) return row(key, label, help, readonlyValue(key), { error: 'This has to be a list of "  - item" lines.' });
    var items = Array.isArray(S.fm.data[key]) ? S.fm.data[key].slice() : [];
    var box = h('div');
    var write = function () {
      var clean = items.filter(function (x) { return x.trim() !== ''; });
      if (clean.length) fmSet(key, items.slice());
      else fmDelete(key);
    };
    var draw = function () {
      box.replaceChildren.apply(box, items.map(function (item, i) {
        var remove = h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Remove', onclick: function () { items.splice(i, 1); write(); draw(); } });
        if (!links) {
          var input = h('input', { class: 'ed-input', name: key + '.' + i, value: item });
          input.addEventListener('input', function () { items[i] = input.value; write(); });
          return h('div', { class: 'ed-list-row' }, input, remove);
        }
        var at = item.lastIndexOf(' | ');
        var lab = h('input', { class: 'ed-input', name: key + '.' + i + '.label', value: at > 0 ? item.slice(0, at) : item, placeholder: 'label' });
        var url = h('input', { class: 'ed-input ed-mono-input', name: key + '.' + i + '.url', value: at > 0 ? item.slice(at + 3) : '', placeholder: 'https://…' });
        var both = function () { items[i] = lab.value.trim() + ' | ' + url.value.trim(); write(); };
        lab.addEventListener('input', both);
        url.addEventListener('input', both);
        return h('div', { class: 'ed-list-row ed-link-row' }, lab, url, remove);
      }).concat([h('button', { class: 'ed-btn ed-small', type: 'button', text: '+ Add', onclick: function () { items.push(links ? ' | ' : ''); draw(); } })]));
    };
    draw();
    return row(key, label, help, box);
  }

  function mapRow(key, label, help, subs) {
    var bad = shapeError(key, 'map');
    if (bad) return row(key, label, help, readonlyValue(key), { error: 'This has to be a block of "  name: value" lines.' });
    var value = S.fm.data[key];
    if (!value || typeof value !== 'object') {
      return row(key, label, help, h('button', { class: 'ed-btn ed-small', type: 'button', text: '+ Add ' + key, onclick: function () {
        var m = {};
        subs.forEach(function (s) { if (s[2]) m[s[0]] = ''; });
        fmSet(key, m);
        drawForm();
      } }));
    }
    var map = Object.assign({}, value);
    var lines = subs.map(function (s) {
      var input = h('input', { class: 'ed-input' + (s[0] === 'url' ? ' ed-mono-input' : ''), name: key + '.' + s[0], value: map[s[0]] || '', placeholder: s[1] });
      input.addEventListener('input', function () {
        if (input.value === '' && !s[2]) delete map[s[0]];
        else map[s[0]] = input.value;
        fmSet(key, Object.assign({}, map));
      });
      return h('div', null, commentsFor(key + '.' + s[0]), h('div', { class: 'ed-map-row' }, h('span', { text: s[0] + (s[2] ? ' *' : '') }), input, h('span')));
    });
    var extra = Object.keys(map).filter(function (k) { return !subs.some(function (s) { return s[0] === k; }); });
    extra.forEach(function (k) { lines.push(h('p', { class: 'ed-err', text: key + '.' + k + ' is not part of the format (kept as written): ' + map[k] })); });
    lines.push(h('button', { class: 'ed-btn ed-small ed-danger', type: 'button', text: 'Remove ' + key, onclick: function () { fmDelete(key); drawForm(); } }));
    return row(key, label, help, h('div', null, lines));
  }

  function boolRow(key, label, help, fallback) {
    var raw = str(key);
    var checked = raw === '' ? fallback : raw === 'true';
    var box = h('input', { type: 'checkbox', name: key, checked: checked });
    box.addEventListener('change', function () {
      var want = box.checked;
      var wasThere = key in S.fmLoadedData;
      if (want === fallback && !wasThere) fmDelete(key);
      else fmSet(key, String(want));
    });
    var err = raw && raw !== 'true' && raw !== 'false' ? '"' + raw + '" is not true or false.' : null;
    return row(key, label, help, h('label', { class: 'ed-check' }, box, h('span', { text: checked ? 'yes' : 'no' })), { error: err });
  }

  function bannerRow() {
    var value = S.fm.data.banner;
    if (value === undefined) return null;
    if (shapeError('banner', 'map')) return row('banner', 'Banner', null, readonlyValue('banner'), { error: 'banner is a block of "  name: value" lines.' });
    var map = Object.assign({}, value);
    var write = function () { fmSet('banner', Object.assign({}, map)); };
    var lines = Object.keys(map).map(function (k) {
      var control;
      if (k === 'art' || k === 'plateLight' || k === 'plateDark') {
        control = mediaSelect('banner.' + k, map[k], function (v) { map[k] = v; write(); }, false);
      } else {
        control = h('input', { class: 'ed-input ed-mono-input', name: 'banner.' + k, value: map[k] });
        control.addEventListener('input', function () { map[k] = control.value; write(); });
      }
      var known = S.keys.banner.indexOf(k) !== -1;
      var remove = ['art', 'plateLight', 'plateDark'].indexOf(k) === -1
        ? h('button', { class: 'ed-btn ed-small', type: 'button', text: '×', title: 'Remove ' + k, onclick: function () { delete map[k]; write(); drawForm(); } })
        : h('span');
      return h('div', null, commentsFor('banner.' + k), h('div', { class: 'ed-map-row' }, h('span', { text: k + (known ? '' : ' ?') }), control, remove));
    });
    var missing = S.keys.banner.filter(function (k) { return !(k in map); });
    if (missing.length) {
      var add = h('select', { class: 'ed-select', name: 'banner-add' }, h('option', { value: '', text: '+ Add a setting…' }), missing.map(function (k) { return h('option', { value: k, text: k }); }));
      add.addEventListener('change', function () { if (add.value) { map[add.value] = ''; write(); drawForm(); } });
      lines.push(h('div', { class: 'ed-map-row' }, h('span'), add, h('span')));
    }
    return row('banner', 'Banner', 'The band. The plates are baked from these settings by `npm run writing:banner -- ' + S.slug + '`; after re-baking, rename them. What each setting does is the OPTIONS block in tools/writing/banner.js.', h('div', null, lines));
  }

  function drawFmErrors() {
    var box = els.formView.querySelector('.ed-fm-errors');
    var list = (S.validation ? S.validation.errors : []).filter(function (p) { return p.area === 'front matter'; });
    if (!box) return;
    box.hidden = !list.length;
    box.replaceChildren(h('ul', null, list.map(function (p) { return h('li', { text: p.message }); })));
  }

  function drawForm() {
    var view = els.formView;
    var file = h('p', { class: 'ed-file' }, h('span', { class: 'ed-path', text: S.dir + '\\article.md' }), ' · ' + S.eol + (S.bom ? ' · with BOM' : ''));
    if (!S.fm || S.fmRawText !== null) {
      if (S.fmRawText === null) S.fmRawText = S.fmRaw;
      var ta = h('textarea', { class: 'ed-textarea ed-rawfm', name: 'fm-raw', spellcheck: 'false' });
      ta.value = S.fmRawText;
      ta.addEventListener('input', function () { S.fmRawText = ta.value; changed(); });
      fill(view, file,
        S.fmError ? h('div', { class: 'ed-fm-errors' }, 'The front matter cannot be read: ' + S.fmError + '. Fix it here, as text, and save; the form comes back when it reads.') : h('p', { class: 'ed-fm-note', text: 'Editing the front matter as text. It is written exactly as typed.' }),
        h('h2', { class: 'ed-group', text: 'Front matter, as text' }), ta);
      return;
    }
    var known = S.keys.known;
    var unknown = Object.keys(S.fm.data).filter(function (k) { return known.indexOf(k) === -1; });
    var trailing = (S.fm.comments[''] || []).filter(function (l) { return l.trim(); });
    fill(view,
      file,
      h('div', { class: 'ed-fm-errors', hidden: true }),
      S.fmCanonical ? null : h('p', { class: 'ed-fm-note', text: 'This front matter is not quite in the form the serializer writes (spacing or quoting), so changing a value here will also tidy those lines. Comments are kept either way.' }),
      h('h2', { class: 'ed-group', text: 'The article' }),
      textRow('title', 'Title', 'The masthead, the tab, and every share card.', { required: true }),
      textRow('deck', 'Deck', 'The line under the title.'),
      textRow('author', 'Author', 'The byline.', { required: true }),
      textRow('handle', 'Handle', 'After the byline, in brackets.'),
      textRow('kind', 'Kind', 'The record row’s label and the skip link’s noun. Article if empty.', { placeholder: 'Article' }),
      rangeRow(),
      textRow('description', 'Description', 'For search results and link previews. One line.', { required: true, multiline: true }),
      h('h2', { class: 'ed-group', text: 'Dates and sharing' }),
      dateRow('published', 'Published', 'Defaults to the last day of the date.'),
      dateRow('updated', 'Updated', 'Defaults to published. Not before it.'),
      row('image', 'Image', 'The share card picture; without it the card is small.', mediaSelect('image', str('image'), function (v) { if (v) fmSet('image', v); else fmDelete('image'); }, true)),
      textRow('canonical', 'Canonical', 'Only for an article first published elsewhere: that URL.', { mono: true, placeholder: 'https://…' }),
      listRow('keywords', 'Keywords', 'For structured data.', false),
      mapRow('about', 'About', 'What the article is about, for structured data.', [['type', 'VideoGame', true], ['name', 'Rise&Shine', true], ['url', 'https://…', false]]),
      mapRow('award', 'Award', 'Adds the Award row to the masthead.', [['text', 'The prize', true], ['event', 'The event', false], ['url', 'https://…', false]]),
      h('h2', { class: 'ed-group', text: 'Links' }),
      listRow('elsewhere', 'Elsewhere', 'The rail’s Elsewhere group, after imtani.dev.', true),
      listRow('colophon', 'Colophon', 'The footer, after imtani.dev.', true),
      h('h2', { class: 'ed-group', text: 'Switches' }),
      boolRow('toc', 'Contents', 'The contents rail.', true),
      boolRow('draft', 'Draft', 'A published folder that says draft: true is skipped by the build.', false),
      S.fm.data.banner !== undefined ? h('h2', { class: 'ed-group', text: 'Banner' }) : null,
      bannerRow(),
      unknown.length ? h('h2', { class: 'ed-group', text: 'Not part of the format' }) : null,
      unknown.map(function (k) {
        return row(k, k, null, readonlyValue(k), { error: 'Unknown key: kept as written, but the build refuses it. Remove it in the text view, or ask for it to be added to the format.' });
      }),
      trailing.length ? h('div', null, h('h2', { class: 'ed-group', text: 'Comments at the end of the block' }), h('pre', { class: 'ed-comment', text: trailing.join('\n') })) : null,
      h('p', { class: 'ed-fm-note' },
        h('button', { class: 'ed-btn ed-small', type: 'button', text: 'Edit as text', disabled: fmDirty(), title: fmDirty() ? 'Save or undo the form’s changes first' : '', onclick: function () { S.fmRawText = S.fmRaw; drawForm(); } }),
        ' Comments above a field are kept; one above a field you remove moves to the next line.'));
    drawFmErrors();
  }

  route();
})();
