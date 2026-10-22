import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { FrontMatterError, parse, serialize } from '../tools/writing/frontmatter.ts';

const CANONICAL = `---
# A comment above the first key.
title: Rise&Shine Devlog
description: Colons: fine, and # mid-line is part of the value
empty: ""
spaced: "  kept  "
hash: "#not a comment"
keywords:
  - Godot
  # a comment above an item
  - game jam
award:
  text: Most Educational Devlog Prize

  url: https://itch.io/jam/learn-you-a-game-jam-2024#top
# trailing comment
---

Body starts here.
`;

test('reads scalars, lists and one-level maps, every value as a string', () => {
  const fm = parse(CANONICAL);
  assert.equal(fm.data['title'], 'Rise&Shine Devlog');
  assert.equal(fm.data['description'], 'Colons: fine, and # mid-line is part of the value');
  assert.equal(fm.data['empty'], '');
  assert.equal(fm.data['spaced'], '  kept  ');
  assert.equal(fm.data['hash'], '#not a comment');
  assert.deepEqual(fm.data['keywords'], ['Godot', 'game jam']);
  assert.deepEqual(fm.data['award'], {
    text: 'Most Educational Devlog Prize',
    url: 'https://itch.io/jam/learn-you-a-game-jam-2024#top',
  });
  assert.equal(fm.body, '\nBody starts here.\n');
});

test('keeps comments and blank lines against what follows them', () => {
  const fm = parse(CANONICAL);
  assert.deepEqual(fm.comments['title'], ['# A comment above the first key.']);
  assert.deepEqual(fm.comments['keywords.1'], ['  # a comment above an item']);
  assert.deepEqual(fm.comments['award.url'], ['']);
  assert.deepEqual(fm.comments[''], ['# trailing comment']);
});

test('serialize(parse(x)) is x for a block in canonical form', () => {
  assert.equal(serialize(parse(CANONICAL)), CANONICAL);
});

test('a changed value round-trips with every other line untouched', () => {
  const fm = parse(CANONICAL);
  const out = serialize({ ...fm, data: { ...fm.data, title: 'Another title' } });
  assert.equal(out, CANONICAL.replace('title: Rise&Shine Devlog', 'title: Another title'));
});

test('quotes are added only where reading back bare would change the value', () => {
  const out = serialize({
    data: { a: 'plain: text', b: '', c: ' x', d: '"q"', e: "it's", f: '#x' },
    body: '',
  });
  assert.equal(out, '---\na: plain: text\nb: ""\nc: " x"\nd: "\\"q\\""\ne: it\'s\nf: "#x"\n---\n');
  assert.deepEqual(parse(out).data, { a: 'plain: text', b: '', c: ' x', d: '"q"', e: "it's", f: '#x' });
});

test('single quotes double a quote to escape it', () => {
  assert.equal(parse("---\na: 'it''s'\n---\n").data['a'], "it's");
});

test('CRLF input and a byte-order mark are accepted', () => {
  const fm = parse('﻿---\r\ntitle: x\r\n---\r\nbody\r\n');
  assert.equal(fm.data['title'], 'x');
  assert.equal(fm.body, 'body\n');
});

test('refuses, with a line number, anything outside the subset', () => {
  const bad: Array<[string, RegExp]> = [
    ['title: x\n', /must start with a front matter block/],
    ['---\ntitle: x\n', /never closed/],
    ['---\ntitle: x\ntitle: y\n---\n', /line 3: "title" is given twice/],
    ['---\ntitle:x\n---\n', /line 2: cannot read/],
    ['---\n  - orphan\n---\n', /line 2: a list item has to follow/],
    ['---\nk:\n  - a\n  b: c\n---\n', /line 4: an indented "key: value" has to follow/],
    ['---\nk:\n    deep: x\n---\n', /line 3: cannot read/],
    ['---\nk:\n\t- a\n---\n', /line 3: tabs are not allowed/],
    ['---\na: "open\n---\n', /line 2: unterminated double-quoted value/],
    ['---\na: "x\\n"\n---\n', /only \\" and \\\\ are escapes/],
  ];
  for (const [text, message] of bad) {
    assert.throws(() => parse(text), (error: unknown) => error instanceof FrontMatterError && message.test(error.message), text);
  }
});

test('a key with nothing under it reads as an empty value', () => {
  assert.equal(parse('---\nbanner:\n---\n').data['banner'], '');
});

test('the published devlog round-trips byte for byte, comments and all', () => {
  const file = new URL('../articles/rise-and-shine/article.md', import.meta.url);
  const text = readFileSync(file, 'utf8');
  assert.equal(serialize(parse(text)), text);
});
