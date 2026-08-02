import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng, hashString, splitmix32 } from '../src/engine/prng.ts';
import { decodeGrid, encodeGrid, isCompatible } from '../src/engine/checkpoint.ts';
import { World } from '../src/engine/world.ts';
import { SUBSTRATE_SPEC, hammingDistance } from '../src/engine/substrate.ts';
import { bandPass, SCORE_SCALE } from '../src/engine/metrics.ts';
import { DECISION_INTERVAL } from '../src/engine/bandit.ts';

test('prng is a pure function of seed and counter', () => {
  assert.equal(splitmix32(1, 1), splitmix32(1, 1));
  assert.notEqual(splitmix32(1, 1), splitmix32(1, 2));
  assert.notEqual(splitmix32(1, 1), splitmix32(2, 1));

  const a = new Rng(99);
  const b = new Rng(99);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());

  // resuming from a stored counter reproduces the tail exactly
  const resumed = new Rng(99, 500);
  const fresh = new Rng(99);
  for (let i = 0; i < 500; i++) fresh.next();
  for (let i = 0; i < 200; i++) assert.equal(resumed.next(), fresh.next());
});

test('rng.int is unbiased in range and consumes draws deterministically', () => {
  const rng = new Rng(4242);
  const seen = new Set<number>();
  for (let i = 0; i < 5000; i++) {
    const v = rng.int(7);
    assert.ok(v >= 0 && v < 7, `${v} out of range`);
    seen.add(v);
  }
  assert.equal(seen.size, 7, 'every value in range should appear');

  const a = new Rng(4242);
  const b = new Rng(4242);
  for (let i = 0; i < 500; i++) a.int(13);
  for (let i = 0; i < 500; i++) b.int(13);
  assert.equal(a.counter, b.counter, 'same number of draws consumed');
});

test('hashString is stable', () => {
  assert.equal(hashString('imtani.dev'), hashString('imtani.dev'));
  assert.notEqual(hashString('imtani.dev'), hashString('imtani.de'));
});

test('bandPass is zero outside the band and peaks inside it', () => {
  assert.equal(bandPass(0, 10, 50, 90), 0);
  assert.equal(bandPass(10, 10, 50, 90), 0);
  assert.equal(bandPass(90, 10, 50, 90), 0);
  assert.equal(bandPass(50, 10, 50, 90), SCORE_SCALE);
  assert.ok(bandPass(30, 10, 50, 90) > 0);
  assert.ok(bandPass(30, 10, 50, 90) < SCORE_SCALE);
  // integer output, always
  for (let v = 0; v <= 100; v++) {
    assert.equal(Number.isInteger(bandPass(v, 10, 50, 90)), true);
  }
});

test('two worlds advanced to the same step are bit-identical', () => {
  const a = new World();
  const b = new World();
  a.advanceTo(500);
  b.advanceTo(500);
  assert.equal(hammingDistance(a.grid, b.grid), 0);
  assert.equal(a.step, b.step);
  assert.deepEqual(a.bandit, b.bandit);
  assert.deepEqual(a.metrics, b.metrics);
});

test('advancing in pieces equals advancing in one go', () => {
  const whole = new World();
  whole.advanceTo(437);

  const pieces = new World();
  for (const target of [17, 60, 61, 200, 359, 437]) pieces.advanceTo(target);

  assert.equal(
    hammingDistance(whole.grid, pieces.grid),
    0,
    'piecewise advance diverged from a single advance',
  );
  assert.deepEqual(pieces.bandit, whole.bandit);
});

test('advance is monotonic and never goes backwards', () => {
  const w = new World();
  w.advanceTo(100);
  const before = Uint32Array.from(w.grid);
  const result = w.advanceTo(50);
  assert.equal(result.stepped, 0);
  assert.equal(w.step, 100);
  assert.equal(hammingDistance(before, w.grid), 0);
});

test('advance respects its budget and reports truncation', () => {
  const w = new World();
  const result = w.advanceTo(10_000, 250);
  assert.equal(result.stepped, 250);
  assert.equal(result.truncated, true);
  assert.equal(w.step, 250);

  const finish = w.advanceTo(10_000, 10_000);
  assert.equal(finish.truncated, false);
  assert.equal(w.step, 10_000);
});

test('checkpoint round-trips to a bit-identical world', () => {
  const origin = new World();
  origin.advanceTo(1_000);
  const cp = origin.toCheckpoint();

  const restored = World.fromCheckpoint(cp);
  assert.ok(restored, 'checkpoint should be compatible with the current world');
  assert.equal(restored.step, 1_000);
  assert.equal(hammingDistance(origin.grid, restored.grid), 0);
  assert.deepEqual(restored.bandit, origin.bandit);

  // and continuing from it matches continuing from the original
  origin.advanceTo(1_337);
  restored.advanceTo(1_337);
  assert.equal(
    hammingDistance(origin.grid, restored.grid),
    0,
    'resumed world diverged after the checkpoint',
  );
});

test('a checkpoint from a different world is rejected, not silently used', () => {
  const other = new World({ seed: 12345 });
  other.advanceTo(10);
  const cp = other.toCheckpoint();

  assert.equal(World.fromCheckpoint(cp), null, 'foreign seed must be rejected');
  assert.equal(
    isCompatible(cp, SUBSTRATE_SPEC, 999, cp.epochMs, cp.stepMs),
    false,
  );
  assert.equal(
    isCompatible({ ...cp, arms: ['B3/S23'] }, SUBSTRATE_SPEC, cp.seed, cp.epochMs, cp.stepMs),
    false,
    'a changed rule set must invalidate the snapshot',
  );
});

test('grid encoding is byte-exact and endian-explicit', () => {
  const g = new Uint32Array([0x00000000, 0xffffffff, 0x12345678, 0x80000001]);
  const round = decodeGrid(encodeGrid(g), g.length);
  assert.deepEqual([...round], [...g]);
  assert.throws(() => decodeGrid(encodeGrid(g), g.length + 1), /expected/);
});

test('the bandit makes a decision on the interval and tries every arm first', () => {
  const w = new World();
  assert.equal(w.bandit.decisions, 0);
  w.advanceTo(DECISION_INTERVAL - 1);
  assert.equal(w.bandit.decisions, 0, 'no decision before the interval elapses');
  w.advanceTo(DECISION_INTERVAL);
  assert.equal(w.bandit.decisions, 1);

  w.advanceTo(DECISION_INTERVAL * 40);
  assert.ok(
    w.bandit.counts.every((c) => c > 0),
    'every arm should have been tried at least once',
  );
  const totalCredited = w.bandit.counts.reduce((a, b) => a + b, 0);
  assert.equal(totalCredited, w.bandit.decisions);
});

test('the world stays alive over a long run', () => {
  // Regression guard: the reward function exists to stop the world dying or
  // saturating. If this fails, the bands in metrics.ts need retuning.
  const w = new World();
  w.advanceTo(20_000);
  const cells = SUBSTRATE_SPEC.width * SUBSTRATE_SPEC.height;
  const density = w.population / cells;
  assert.ok(density > 0.005, `world died out, density ${density}`);
  assert.ok(density < 0.75, `world saturated, density ${density}`);
});
