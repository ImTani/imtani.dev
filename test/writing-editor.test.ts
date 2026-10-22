import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from '../tools/writing/frontmatter.ts';
import {
  type DocumentState,
  type PlacedBlock,
  blockType,
  composeFrontMatter,
  composeText,
  encodeLike,
  loadText,
  originalBlocks,
  splitBody,
} from '../tools/writing/write/document.ts';
import {
  Refusal,
  addMedia,
  createDraft,
  publish,
  publishPlan,
  save,
  validate,
} from '../tools/writing/write/service.ts';

const DEVLOG = new URL('../articles/rise-and-shine/article.md', import.meta.url);
const devlog = readFileSync(DEVLOG, 'utf8');

function unchanged(file: ReturnType<typeof loadText>, blocks: PlacedBlock[] = originalBlocks(file)): DocumentState {
  return { baseHash: file.hash, fm: { mode: 'unchanged' }, blocks };
}

function saved(raw: string, state: (file: ReturnType<typeof loadText>) => DocumentState): string {
  const file = loadText(raw);
  return encodeLike(file, composeText(file, state(file)));
}

// ------------------------------------------------------------- round trips ---

test('the devlog, opened and saved with no edits, is byte-identical', () => {
  const file = loadText(devlog);
  assert.ok(file.split.blocks.length > 200, 'the devlog is cut into its blocks');
  assert.equal(saved(devlog, (f) => unchanged(f)), devlog);
});

test('the devlog front matter round-trips through the form unchanged', () => {
  const file = loadText(devlog);
  assert.ok(file.fm);
  const out = saved(devlog, (f) => ({
    baseHash: f.hash,
    fm: { mode: 'form', data: f.fm!.data, comments: f.fm!.comments },
    blocks: originalBlocks(f),
  }));
  assert.equal(out, devlog);
});

test('editing one paragraph of the devlog changes only that paragraph’s lines', () => {
  const file = loadText(devlog);
  const at = file.split.blocks.findIndex((src, i) => i > 20 && blockType(src) === 'paragraph');
  const before = file.split.blocks[at] as string;
  const after = `${before.replace(/\.$/, '')}, and this sentence is new.\nWith a second line.`;
  const out = saved(devlog, (f) => unchanged(f, originalBlocks(f).map((b, i) => (i === at ? { ...b, src: after } : b))));

  const a = devlog.split('\n');
  const b = out.split('\n');
  let head = 0;
  while (a[head] === b[head]) head += 1;
  let tail = 0;
  while (a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  assert.deepEqual(a.slice(head, a.length - tail), before.split('\n'), 'the lines removed are the paragraph');
  assert.deepEqual(b.slice(head, b.length - tail), after.split('\n'), 'the lines added are its replacement');
});

test('a moved block is joined by one blank line; everything else keeps its bytes', () => {
  const body = 'One.\n\n\n\nTwo.\n\n# Three\nFour.\n';
  const raw = `---\ntitle: x\n---\n\n${body}`;
  const out = saved(raw, (f) => {
    const [one, two, three, four] = originalBlocks(f);
    return unchanged(f, [one!, three!, four!, two!]);
  });
  assert.equal(out, '---\ntitle: x\n---\n\nOne.\n\n# Three\nFour.\n\nTwo.\n');
  // Untouched neighbours keep whatever was between them, blank lines and all.
  assert.equal(saved(raw, (f) => unchanged(f)), raw);
});

test('blocks are cut where markdown-it cuts them, asides whole, nothing dropped', () => {
  const body = [
    '',
    'A paragraph',
    'over two lines.',
    '',
    '<aside>',
    '🤔 An aside',
    '',
    'with a blank line in it.',
    '</aside>',
    '',
    '[ref]: https://example.com',
    '',
    '```gdscript',
    'func _ready():',
    '',
    '    pass',
    '```',
    '- a',
    '- b',
    '',
    '<!-- a comment -->',
    '   ',
    '',
  ].join('\n');
  const split = splitBody(body);
  assert.deepEqual(split.blocks.map(blockType), ['paragraph', 'aside', 'raw', 'code', 'list', 'html']);
  assert.equal(split.blocks[1], '<aside>\n🤔 An aside\n\nwith a blank line in it.\n</aside>');
  const joined = split.head + split.blocks.map((b, i) => (split.gaps[i] ?? '') + b).join('') + split.tail;
  assert.equal(joined, body);
});

test('the kinds of block are told apart', () => {
  assert.equal(blockType('# Day 1 | June 19 {#day-1}'), 'heading');
  assert.equal(blockType('![](media/a.webp "A *caption*")'), 'image');
  assert.equal(blockType('![The flag rises.](media/flag.mp4)'), 'clip');
  assert.equal(blockType('![](figure:sine "Sine Wave")'), 'figure');
  assert.equal(blockType('![](https://example.com/x.gif "x"){width=480 height=269 animated}'), 'remote');
  assert.equal(blockType('Words [[wide: here]] [[band: there]].'), 'paragraph');
  assert.equal(blockType('---'), 'rule');
  assert.equal(blockType('> quoted'), 'quote');
});

test('CRLF and a BOM survive, untouched and edited', () => {
  const raw = '﻿---\r\ntitle: x\r\n---\r\n\r\nOne.\r\n\r\nTwo.\r\n';
  assert.equal(saved(raw, (f) => unchanged(f)), raw);
  const out = saved(raw, (f) => unchanged(f, originalBlocks(f).map((b, i) => (i === 1 ? { ...b, src: 'Deux.\nZwei.' } : b))));
  assert.equal(out, '﻿---\r\ntitle: x\r\n---\r\n\r\nOne.\r\n\r\nDeux.\r\nZwei.\r\n');
});

test('mixed line endings are refused rather than normalised', () => {
  const file = loadText('---\ntitle: x\r\n---\n\nOne.\n');
  assert.equal(file.eol, 'mixed');
  assert.throws(() => encodeLike(file, composeText(file, unchanged(file))));
});

test('the first blocks written into an empty body sit after a blank line', () => {
  const raw = '---\ntitle: x\n---\n\n';
  assert.equal(saved(raw, (f) => unchanged(f, [{ src: '# Part' }, { src: 'Text.' }])), '---\ntitle: x\n---\n\n# Part\n\nText.\n');
});

// ------------------------------------------------------------ front matter ---

test('a changed front matter value changes that line only, comments kept', () => {
  const file = loadText(devlog);
  const fm = file.fm!;
  const text = composeFrontMatter(fm, { data: { ...fm.data, deck: 'A new deck' }, comments: fm.comments });
  const old = file.fmRaw.split('\n');
  const neu = text.split('\n');
  assert.equal(neu.length, old.length);
  const diff = old.map((line, i) => (line === neu[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(diff.map((i) => neu[i as number]), ['deck: A new deck']);
});

test('a comment above a removed key moves to the next line rather than vanishing', () => {
  const raw = '---\ntitle: x\n# why this date\ndate: 2024-01-01\ndescription: y\n---\n';
  const fm = parse(raw);
  const { date: _gone, ...rest } = fm.data;
  const text = composeFrontMatter(fm, { data: rest, comments: fm.comments });
  assert.equal(text, '---\ntitle: x\n# why this date\ndescription: y\n---\n');
});

// --------------------------------------------------------- files and guards ---

function roots() {
  const base = mkdtempSync(join(tmpdir(), 'writing-editor-'));
  const r = { published: join(base, 'published'), drafts: join(base, 'drafts') };
  mkdirSync(r.published, { recursive: true });
  mkdirSync(r.drafts, { recursive: true });
  return { base, ...r };
}

const VALID = '---\ntitle: T\nauthor: A\ndate: 2026-10-01\ndescription: D\n---\n\nHello.\n';

function png(width: number, height: number): Uint8Array {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

test('a new draft refuses bad slugs and names already taken, here or published', () => {
  const r = roots();
  try {
    for (const bad of ['', 'Has-Caps', 'two--hyphens', '-lead', 'sp ace', '../up', 'drafts']) {
      assert.throws(() => createDraft(r, bad, 'T', 'A', '2026-10-22'), Refusal, bad);
    }
    assert.throws(() => createDraft(r, 'fine', '  ', 'A', '2026-10-22'), Refusal);
    createDraft(r, 'fine', 'A title: with a colon', 'A', '2026-10-22');
    assert.ok(existsSync(join(r.drafts, 'fine', 'media')));
    const text = readFileSync(join(r.drafts, 'fine', 'article.md'), 'utf8');
    assert.equal(parse(text).data['title'], 'A title: with a colon');
    assert.match(text, /^# deck: /m, 'optional fields are there, commented');
    assert.throws(() => createDraft(r, 'fine', 'Again', 'A', '2026-10-22'), Refusal);
    mkdirSync(join(r.published, 'taken'));
    assert.throws(() => createDraft(r, 'taken', 'T', 'A', '2026-10-22'), Refusal);
    // A fresh draft has an empty description, so it fails its check on purpose.
    const v = validate(r, 'drafts', 'fine', join(r.drafts, 'fine'), text);
    assert.ok(v.errors.some((p) => /description/.test(p.message)));
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test('publishing refuses a taken slug or a failing article, and otherwise moves the folder', () => {
  const r = roots();
  try {
    const dir = join(r.drafts, 'ready');
    mkdirSync(join(dir, 'media'), { recursive: true });
    writeFileSync(join(dir, 'article.md'), VALID);

    // A stray file in media/ fails a published build, so it blocks publishing.
    writeFileSync(join(dir, 'media', 'stray.png'), png(10, 10));
    assert.ok(publishPlan(r, 'ready').blockers.length);
    assert.throws(() => publish(r, 'ready'), Refusal);
    rmSync(join(dir, 'media', 'stray.png'));

    mkdirSync(join(r.published, 'ready'));
    assert.throws(() => publish(r, 'ready'), Refusal);
    rmSync(join(r.published, 'ready'), { recursive: true });

    const plan = publishPlan(r, 'ready');
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.files, ['article.md']);
    publish(r, 'ready');
    assert.ok(!existsSync(dir));
    assert.equal(readFileSync(join(r.published, 'ready', 'article.md'), 'utf8'), VALID);
    assert.throws(() => publishPlan(r, 'ready'), Refusal, 'no longer a draft');
    assert.throws(() => publishPlan(r, '../published/ready'), Refusal);
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test('save writes atomically with a backup, skips a no-op, and refuses a file that moved on', () => {
  const r = roots();
  try {
    const dir = join(r.published, 'piece');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'article.md'), VALID);
    const file = loadText(VALID);

    const same = save(dir, unchanged(file));
    assert.equal(same.unchanged, true);
    assert.ok(!existsSync(join(dir, '.edit-backups')), 'no backup for a no-op');

    const edited = save(dir, unchanged(file, [{ src: 'Hello, again.', orig: 0 }]), new Date('2026-10-22T10:00:00Z'));
    assert.equal(edited.unchanged, false);
    assert.equal(readFileSync(join(dir, 'article.md'), 'utf8'), VALID.replace('Hello.', 'Hello, again.'));
    assert.deepEqual(readdirSync(join(dir, '.edit-backups')), ['article.md.2026-10-22T10-00-00-000Z.bak']);
    assert.equal(readFileSync(edited.backup!, 'utf8'), VALID);
    assert.deepEqual(readdirSync(dir).sort(), ['.edit-backups', 'article.md'], 'no temp file left behind');

    // The editor still holds the old hash: its save is refused, nothing written.
    assert.throws(() => save(dir, unchanged(file, [{ src: 'Stale.', orig: 0 }])), Refusal);
    assert.equal(readFileSync(join(dir, 'article.md'), 'utf8'), VALID.replace('Hello.', 'Hello, again.'));
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test('media is added under a slugified name; GIF, video and SVG are refused', () => {
  const r = roots();
  try {
    const dir = join(r.drafts, 'pics');
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(addMedia(dir, 'My Screen Shot (2).PNG', png(20, 10)), { file: 'my-screen-shot-2.png', reused: false });
    assert.deepEqual(addMedia(dir, 'my screen shot 2.png', png(20, 10)), { file: 'my-screen-shot-2.png', reused: true });
    assert.deepEqual(addMedia(dir, 'my screen shot 2.png', png(30, 10)), { file: 'my-screen-shot-2-2.png', reused: false });
    for (const name of ['loop.gif', 'take.mp4', 'clip.mov', 'diagram.svg']) {
      assert.throws(() => addMedia(dir, name, png(1, 1)), Refusal, name);
    }
    assert.throws(() => addMedia(dir, 'fake.png', new Uint8Array([1, 2, 3])), Refusal);
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});
