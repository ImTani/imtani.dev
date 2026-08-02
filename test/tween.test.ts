import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CellTween, ease } from '../src/surface/tween.ts';
import { allocGrid, makeSpec, setCell } from '../src/engine/substrate.ts';

const spec = makeSpec(64, 8);

function gridWith(coords: readonly (readonly [number, number])[]): Uint32Array {
  const g = allocGrid(spec);
  for (const [x, y] of coords) setCell(g, spec, x, y, 1);
  return g;
}

const at = (t: CellTween, x: number, y: number): number => t.value[y * spec.width + x]!;

test('snap matches the grid exactly, with no intermediate values', () => {
  const t = new CellTween({ spec });
  t.snap(gridWith([[3, 1], [63, 7]]));

  assert.equal(at(t, 3, 1), 1);
  assert.equal(at(t, 63, 7), 1);
  assert.equal(at(t, 4, 1), 0);
  for (const v of t.value) assert.ok(v === 0 || v === 1, `snap left ${v} between states`);
});

test('a birth rises to fully alive over riseMs and then stops', () => {
  const t = new CellTween({ spec, riseMs: 100, fallMs: 100 });
  const g = gridWith([[10, 4]]);

  t.advance(50, g);
  const half = at(t, 10, 4);
  assert.ok(half > 0.4 && half < 0.6, `expected roughly half risen, got ${half}`);

  t.advance(50, g);
  assert.equal(at(t, 10, 4), 1);

  // Clamped: further advancing must not overshoot.
  t.advance(500, g);
  assert.equal(at(t, 10, 4), 1);
});

test('a death falls to fully dead over fallMs and then stops', () => {
  const t = new CellTween({ spec, riseMs: 100, fallMs: 200 });
  t.snap(gridWith([[10, 4]]));
  const empty = allocGrid(spec);

  t.advance(100, empty);
  const half = at(t, 10, 4);
  assert.ok(half > 0.4 && half < 0.6, `expected roughly half faded, got ${half}`);

  t.advance(100, empty);
  assert.equal(at(t, 10, 4), 0);

  t.advance(500, empty);
  assert.equal(at(t, 10, 4), 0);
});

test('the default rise is faster than the default fall', () => {
  // Births are events and deaths are aftermath — symmetric timing makes the
  // whole field look like it is breathing in unison.
  const rising = new CellTween({ spec });
  const falling = new CellTween({ spec });
  const g = gridWith([[1, 1]]);
  const empty = allocGrid(spec);

  rising.advance(100, g);
  falling.snap(g);
  falling.advance(100, empty);

  assert.ok(
    at(rising, 1, 1) > 1 - at(falling, 1, 1),
    'a cell should reach alive faster than it leaves',
  );
});

test('every value stays within 0..1 under a changing grid', () => {
  const t = new CellTween({ spec, riseMs: 30, fallMs: 30 });
  const a = gridWith([[5, 2], [6, 2], [7, 2]]);
  const b = gridWith([[5, 3], [6, 3], [7, 3]]);

  for (let i = 0; i < 40; i++) {
    t.advance(16, i % 2 === 0 ? a : b);
    for (const v of t.value) {
      assert.ok(v >= 0 && v <= 1, `value escaped the range: ${v}`);
      assert.ok(Number.isFinite(v), 'value became non-finite');
    }
  }
});

test('a reversal mid-fade resumes from where it was, not from the end', () => {
  const t = new CellTween({ spec, riseMs: 100, fallMs: 100 });
  const g = gridWith([[2, 2]]);
  const empty = allocGrid(spec);

  t.advance(50, g);
  const partway = at(t, 2, 2);
  t.advance(20, empty);
  const after = at(t, 2, 2);

  assert.ok(after < partway, 'should have started falling');
  assert.ok(after > 0, 'should not have jumped straight to dead');
});

test('ease is smoothstep: fixed at the ends, symmetric, monotonic', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
  // Flat at both ends is the point — it is what removes the constant-velocity
  // look that linear progress has.
  assert.ok(ease(0.1) < 0.1);
  assert.ok(ease(0.9) > 0.9);

  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const v = ease(i / 100);
    assert.ok(v > prev, `not monotonic at ${i / 100}`);
    prev = v;
  }
});
