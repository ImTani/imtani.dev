import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeSpec, pack } from '../src/engine/substrate.ts';
import { SurfaceField } from '../src/surface/field.ts';

function totalEnergy(field: SurfaceField): number {
  let total = 0;
  for (const v of field.energy) total += v;
  return total;
}

test('total energy strictly decreases over time with no injection', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec });
  field.injectPoint(10, 10, 5);

  let previous = totalEnergy(field);
  for (let i = 0; i < 20; i++) {
    field.advance(100);
    const current = totalEnergy(field);
    assert.ok(current < previous, `energy did not decrease on step ${i}: ${current} >= ${previous}`);
    previous = current;
  }
});

test('energy actually spreads: neighbours of an injected point become non-zero', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec, drift: { x: 0, y: 0 } });
  field.injectPoint(32, 16, 10);

  const { width } = spec;
  const centre = 16 * width + 32;
  assert.equal(field.energy[centre - 1], 0, 'sanity: west neighbour started at zero');

  field.advance(17); // one fixed internal step's worth of wall-clock time

  assert.ok(field.energy[centre - 1]! > 0, 'west neighbour should have gained energy');
  assert.ok(field.energy[centre + 1]! > 0, 'east neighbour should have gained energy');
  assert.ok(field.energy[centre - width]! > 0, 'north neighbour should have gained energy');
  assert.ok(field.energy[centre + width]! > 0, 'south neighbour should have gained energy');
});

test('diffusion wraps toroidally: energy injected at x=0 reaches x=width-1', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec, drift: { x: 0, y: 0 } });
  field.injectPoint(0, 10, 10);

  field.advance(17);

  const { width } = spec;
  const wrapped = 10 * width + (width - 1);
  assert.ok(field.energy[wrapped]! > 0, 'energy should have wrapped to the last column');
});

test('a birth injects more energy than a death', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec });

  const prevFlat = new Uint8Array(spec.width * spec.height);
  const curFlat = new Uint8Array(spec.width * spec.height);

  const birthIndex = 5 * spec.width + 5;
  const deathIndex = 5 * spec.width + 6;
  prevFlat[deathIndex] = 1; // alive, about to die
  curFlat[birthIndex] = 1; // dead, about to be born

  const prev = pack(prevFlat, spec);
  const cur = pack(curFlat, spec);

  field.injectTransition(prev, cur);

  const birthEnergy = field.energy[birthIndex]!;
  const deathEnergy = field.energy[deathIndex]!;
  assert.ok(birthEnergy > deathEnergy, `birth (${birthEnergy}) should exceed death (${deathEnergy})`);
});

test('a huge dtMs is clamped and returns promptly rather than running thousands of steps', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec });
  field.injectPoint(10, 10, 10);

  const started = Date.now();
  field.advance(100_000);
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `advance took too long: ${elapsed}ms`);

  // A second huge delta must cost the same again, not accumulate a debt from
  // the first — proof that the clamp drops the remainder instead of queuing it.
  const secondStarted = Date.now();
  field.advance(100_000);
  const secondElapsed = Date.now() - secondStarted;
  assert.ok(secondElapsed < 1000, `second advance took too long: ${secondElapsed}ms`);
});

test('peak tracks the actual maximum', () => {
  const spec = makeSpec(64, 32);
  const field = new SurfaceField({ spec });
  assert.equal(field.peak, 0);

  field.injectPoint(1, 1, 3);
  assert.equal(field.peak, 3);

  field.injectPoint(20, 20, 7);
  assert.equal(field.peak, 7);

  // after enough decay the tracked peak must have fallen with it
  for (let i = 0; i < 50; i++) field.advance(100);
  assert.ok(field.peak < 7, `peak should have decayed below 7, got ${field.peak}`);

  let actualMax = 0;
  for (const v of field.energy) if (v > actualMax) actualMax = v;
  assert.equal(field.peak, actualMax, 'peak must equal the true max of the current field');
});
