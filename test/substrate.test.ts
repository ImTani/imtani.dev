import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/engine/prng.ts';
import { RULE_ARMS, parseRule } from '../src/engine/rules.ts';
import {
  allocGrid,
  getCell,
  hammingDistance,
  makeScratch,
  makeSpec,
  pack,
  population,
  setCell,
  step,
  stepReference,
  unpack,
} from '../src/engine/substrate.ts';

test('width must be a multiple of 32', () => {
  assert.throws(() => makeSpec(200, 120), RangeError);
  assert.doesNotThrow(() => makeSpec(192, 120));
});

test('get and set round-trip, including toroidal indices', () => {
  const spec = makeSpec(64, 8);
  const g = allocGrid(spec);
  setCell(g, spec, 0, 0, 1);
  setCell(g, spec, 63, 7, 1);
  setCell(g, spec, 32, 4, 1);
  assert.equal(getCell(g, spec, 0, 0), 1);
  assert.equal(getCell(g, spec, 63, 7), 1);
  assert.equal(getCell(g, spec, 32, 4), 1);
  assert.equal(getCell(g, spec, 1, 0), 0);
  // negative and overflowing coordinates wrap
  assert.equal(getCell(g, spec, -1, -1), 1);
  assert.equal(getCell(g, spec, 64, 8), 1);
  assert.equal(population(g), 3);

  setCell(g, spec, 0, 0, 0);
  assert.equal(getCell(g, spec, 0, 0), 0);
  assert.equal(population(g), 2);
});

test('pack and unpack are inverses', () => {
  const spec = makeSpec(96, 17);
  const rng = new Rng(7);
  const flat = new Uint8Array(spec.width * spec.height);
  for (let i = 0; i < flat.length; i++) flat[i] = rng.float() < 0.4 ? 1 : 0;
  const packed = pack(flat, spec);
  assert.deepEqual(unpack(packed, spec), flat);
});

test('a glider moves one cell diagonally every four generations', () => {
  const spec = makeSpec(32, 32);
  const g = allocGrid(spec);
  // canonical glider, travelling down-right
  for (const [x, y] of [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
  ] as const) {
    setCell(g, spec, x, y, 1);
  }

  const rule = parseRule('B3/S23');
  const scratch = makeScratch(spec);
  let cur = g;
  let next = allocGrid(spec);
  for (let i = 0; i < 4; i++) {
    step(cur, next, spec, rule, scratch);
    [cur, next] = [next, cur];
  }

  assert.equal(population(cur), 5, 'glider keeps its five cells');
  for (const [x, y] of [
    [2, 1],
    [3, 2],
    [1, 3],
    [2, 3],
    [3, 3],
  ] as const) {
    assert.equal(getCell(cur, spec, x, y), 1, `expected live cell at ${x},${y}`);
  }
});

test('a block is stable and a blinker has period two', () => {
  const spec = makeSpec(32, 32);
  const rule = parseRule('B3/S23');
  const scratch = makeScratch(spec);

  const block = allocGrid(spec);
  for (const [x, y] of [
    [4, 4],
    [5, 4],
    [4, 5],
    [5, 5],
  ] as const) {
    setCell(block, spec, x, y, 1);
  }
  const blockNext = allocGrid(spec);
  step(block, blockNext, spec, rule, scratch);
  assert.equal(hammingDistance(block, blockNext), 0, 'block should not change');

  const blinker = allocGrid(spec);
  for (const [x, y] of [
    [10, 10],
    [11, 10],
    [12, 10],
  ] as const) {
    setCell(blinker, spec, x, y, 1);
  }
  const a = allocGrid(spec);
  const b = allocGrid(spec);
  step(blinker, a, spec, rule, scratch);
  step(a, b, spec, rule, scratch);
  assert.notEqual(hammingDistance(blinker, a), 0, 'blinker should change');
  assert.equal(hammingDistance(blinker, b), 0, 'blinker should return after two steps');
});

test('packed stepper matches the reference across every rule arm', () => {
  // Deliberately awkward: 64 is two words exactly, 37 rows exercises vertical
  // wrap on an odd boundary, and dense soup keeps every branch live.
  const spec = makeSpec(64, 37);
  // plus two degenerate edges: a rule that does nothing, and one that fires on
  // every possible neighbour count
  const rules = [...RULE_ARMS, parseRule('B/S'), parseRule('B012345678/S012345678')];

  for (const rule of rules) {
    const rng = new Rng(0xc0ffee);
    const flat = new Uint8Array(spec.width * spec.height);
    for (let i = 0; i < flat.length; i++) flat[i] = rng.float() < 0.38 ? 1 : 0;

    let packedCur = pack(flat, spec);
    let packedNext = allocGrid(spec);
    let refCur = Uint8Array.from(flat);
    let refNext = new Uint8Array(flat.length);
    const scratch = makeScratch(spec);

    for (let gen = 1; gen <= 60; gen++) {
      step(packedCur, packedNext, spec, rule, scratch);
      stepReference(refCur, refNext, spec.width, spec.height, rule);
      [packedCur, packedNext] = [packedNext, packedCur];
      [refCur, refNext] = [refNext, refCur];

      assert.deepEqual(
        unpack(packedCur, spec),
        refCur,
        `rule ${rule.name} diverged from reference at generation ${gen}`,
      );
    }
  }
});

test('horizontal wrap is exact at the word seam', () => {
  // A blinker straddling x=0 must wrap to x=width-1 rather than being clipped.
  const spec = makeSpec(64, 8);
  const rule = parseRule('B3/S23');
  const scratch = makeScratch(spec);

  const g = allocGrid(spec);
  setCell(g, spec, 63, 3, 1);
  setCell(g, spec, 0, 3, 1);
  setCell(g, spec, 1, 3, 1);

  const next = allocGrid(spec);
  step(g, next, spec, rule, scratch);

  assert.equal(getCell(next, spec, 0, 2), 1);
  assert.equal(getCell(next, spec, 0, 3), 1);
  assert.equal(getCell(next, spec, 0, 4), 1);
  assert.equal(population(next), 3, 'vertical blinker, nothing lost at the seam');
});
