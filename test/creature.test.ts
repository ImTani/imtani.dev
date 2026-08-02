import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Rng } from '../src/engine/prng.ts';
import { CREATURE_TUNING, Creature } from '../src/surface/creature.ts';
import type { CreatureOptions, CreatureSave, SubstrateWrite } from '../src/surface/creature.ts';

const VIEWPORT = { width: 1200, height: 800 } as const;
const GRID = { width: 192, height: 120 } as const;
const FRAME = 16;

function options(seed: number, trust?: number): CreatureOptions {
  const base = { rng: new Rng(seed), viewport: VIEWPORT, grid: GRID };
  return trust === undefined ? base : { ...base, trust };
}

/** Run `ms` of wall time with the pointer out of the window. */
function idle(c: Creature, ms: number): void {
  for (let t = 0; t < ms; t += FRAME) {
    c.update({ pointerX: null, pointerY: null, dtMs: FRAME });
  }
}

/** Hold the pointer at a fixed point for `ms`. */
function hold(c: Creature, px: number, py: number, ms: number): void {
  for (let t = 0; t < ms; t += FRAME) {
    c.update({ pointerX: px, pointerY: py, dtMs: FRAME });
  }
}

/**
 * Move the pointer in from off-target at a speed high enough to be noticed and
 * low enough to frighten nothing. Ends at (px, py).
 *
 * Starts with one absent frame so the first sample is not measured against
 * wherever the pointer was last seen — a teleport would read as a flick.
 */
function approach(c: Creature, px: number, py: number, frames = 12): void {
  c.update({ pointerX: null, pointerY: null, dtMs: FRAME });
  const step = 4; // 250 px/s at a 16 ms frame
  for (let i = frames; i > 0; i--) {
    c.update({ pointerX: px + i * step, pointerY: py, dtMs: FRAME });
  }
}

test('a fresh creature is dormant, trusts 0.1, and leaves no mark', () => {
  const c = new Creature(options(1));
  assert.equal(c.state, 'dormant');
  assert.equal(c.trust, CREATURE_TUNING.defaultTrust);
  assert.equal(c.trust, 0.1);
  assert.deepEqual(c.drainWrites(), []);

  // and stays silent through a long unobserved wander — default trust is below
  // the spectator gate, so it is never even in the world
  idle(c, 10_000);
  assert.equal(c.embedded, false);
  assert.deepEqual(c.drainWrites(), []);
});

test('a still cursor held nearby raises trust at the specified rate', () => {
  const c = new Creature(options(2));
  const px = c.x + 150;
  const py = c.y;

  approach(c, px, py);
  assert.notEqual(c.state, 'dormant', 'a moving cursor inside 400 px should be noticed');

  // eleven seconds of stillness is five whole 2 s windows at +0.06 each.
  // Deliberately not a multiple of the window, so a one-frame difference in
  // where the stillness starts cannot change the expected count.
  hold(c, px, py, 11_000);
  assert.ok(
    Math.abs(c.trust - 0.4) < 0.02,
    `expected roughly 0.1 + 5 * 0.06 = 0.4, got ${c.trust}`,
  );

  // and the rate holds over a second stretch, up to the per-sitting boredom cap
  hold(c, px, py, 6_000);
  assert.ok(Math.abs(c.trust - 0.58) < 0.03, `expected roughly 0.58, got ${c.trust}`);
});

test('a flick inside 220 px startles it, costs 0.35 trust, and tears a hole', () => {
  // trust 0.6: high enough to be embedded, so there is something there to tear
  const warm = new Creature(options(3, 0.6));

  // settle first: the scar can only be torn if it is actually in the automaton
  idle(warm, 1_500);
  assert.equal(warm.embedded, true);
  warm.drainWrites();

  const before = warm.trust;
  const cx = warm.x;
  const cy = warm.y;
  // parked at 200 px, then 160 px of travel in one 16 ms frame — 10,000 px/s
  warm.update({ pointerX: cx + 200, pointerY: cy, dtMs: FRAME });
  warm.update({ pointerX: cx + 40, pointerY: cy, dtMs: FRAME });

  assert.equal(warm.state, 'startled');
  assert.ok(
    Math.abs(warm.trust - (before - 0.35)) < 1e-3,
    `expected ${before - 0.35}, got ${warm.trust}`,
  );
  assert.equal(warm.embedded, false, 'panic ejects it from the grid');

  const writes = warm.drainWrites();
  const cleared = writes.filter((w) => w.alive === 0);
  assert.ok(cleared.length > 0, 'a startle must clear cells');
  assert.ok(cleared.length <= 32, `clear burst should stay small, got ${cleared.length}`);

  // and it actually bolts. Measured as distance travelled rather than as final
  // distance from the cursor: a creature startled near an edge rebounds off it,
  // which is correct behaviour and would make a net-displacement check flaky.
  let travelled = 0;
  let px = warm.x;
  let py = warm.y;
  for (let t = 0; t < CREATURE_TUNING.fleeBurstMs; t += FRAME) {
    warm.update({ pointerX: cx + 40, pointerY: cy, dtMs: FRAME });
    travelled += Math.hypot(warm.x - px, warm.y - py);
    px = warm.x;
    py = warm.y;
  }
  // 900 px/s for 250 ms, less a frame of setup
  assert.ok(travelled > 150, `expected a burst of travel, got ${travelled} px`);
});

test('below trust 0.2 it writes nothing, whatever happens to it', () => {
  const c = new Creature(options(4, 0.19));
  const all: SubstrateWrite[] = [];

  const collect = (): void => {
    for (const w of c.drainWrites()) all.push(w);
  };

  // unobserved wandering
  idle(c, 5_000);
  collect();

  // a cursor circling it, always faster than the stillness threshold so trust
  // can never climb out of the spectator band
  let angle = 0;
  for (let i = 0; i < 600; i++) {
    angle += 0.08;
    c.update({
      pointerX: c.x + Math.cos(angle) * 160,
      pointerY: c.y + Math.sin(angle) * 160,
      dtMs: FRAME,
    });
    collect();
  }

  // and twenty flicks straight at it
  for (let i = 0; i < 20; i++) {
    const cx = c.x;
    const cy = c.y;
    c.update({ pointerX: cx + 210, pointerY: cy, dtMs: FRAME });
    c.update({ pointerX: cx + 30, pointerY: cy, dtMs: FRAME });
    idle(c, 400);
    collect();
  }

  assert.ok(c.trust < 0.2, `trust must have stayed in the spectator band, got ${c.trust}`);
  assert.equal(c.embedded, false, 'a spectator is never grid-bound');
  assert.equal(all.length, 0, `expected no writes, got ${all.length}`);
});

test('above trust 0.5 it lays a live trail as it moves', () => {
  const c = new Creature(options(5, 0.7));
  idle(c, 6_000);

  const writes = c.drainWrites();
  const live = writes.filter((w) => w.alive === 1);
  assert.ok(live.length > 0, 'a trusting creature should mark the world it moves through');
  assert.equal(
    writes.some((w) => w.alive === 0),
    false,
    'nothing here should have startled it',
  );

  // thin, not a flood: six seconds of wandering is not a filled region
  assert.ok(live.length < 300, `trail should be thin, got ${live.length} cells`);
});

test('serialize and restore round-trip trust, state and position', () => {
  const c = new Creature(options(6, 0.42));
  approach(c, c.x + 180, c.y);
  hold(c, c.x + 180, c.y, 300);

  const save = c.serialize();
  assert.notEqual(save.state, 'dormant', 'the fixture should be in a reactive state');

  // it has to survive localStorage, so it has to survive JSON
  const json = JSON.parse(JSON.stringify(save)) as CreatureSave;
  const restored = Creature.restore(json, options(999));

  assert.equal(restored.trust, c.trust);
  assert.equal(restored.state, c.state);
  assert.ok(Math.abs(restored.x - c.x) < 1, `x drifted: ${restored.x} vs ${c.x}`);
  assert.ok(Math.abs(restored.y - c.y) < 1, `y drifted: ${restored.y} vs ${c.y}`);
  assert.equal(restored.heading, c.heading);
  assert.equal(restored.embedded, c.embedded);

  // a corrupt save degrades to a stranger rather than throwing
  const junk = { v: 1, trust: NaN, state: 'wrong', nx: 9, ny: -9, heading: NaN, embedded: 1, rngCounter: 'x' };
  const salvaged = Creature.restore(junk as unknown as CreatureSave, options(7));
  assert.equal(salvaged.state, 'dormant');
  assert.equal(salvaged.trust, CREATURE_TUNING.defaultTrust);
  assert.ok(salvaged.x >= 0 && salvaged.x <= VIEWPORT.width);
});

test('a null pointer does not freeze it', () => {
  const c = new Creature(options(8, 0.3));
  let travelled = 0;
  let px = c.x;
  let py = c.y;

  for (let t = 0; t < 6_000; t += FRAME) {
    c.update({ pointerX: null, pointerY: null, dtMs: FRAME });
    travelled += Math.hypot(c.x - px, c.y - py);
    px = c.x;
    py = c.y;
  }

  assert.equal(c.state, 'dormant');
  assert.ok(travelled > 100, `expected it to wander, travelled ${travelled} px`);
});

test('drainWrites empties the queue', () => {
  const c = new Creature(options(9, 0.9));
  idle(c, 5_000);

  const first = c.drainWrites();
  assert.ok(first.length > 0, 'fixture should have produced writes');
  assert.deepEqual(c.drainWrites(), [], 'a second drain returns nothing');
  assert.deepEqual(c.drainWrites(), []);
});

test('every emitted write is inside the grid', () => {
  const c = new Creature(options(10, 0.95));
  const all: SubstrateWrite[] = [];

  // a long mixed run: wandering, following, being frightened, near the edges
  for (let round = 0; round < 12; round++) {
    idle(c, 2_000);
    for (const w of c.drainWrites()) all.push(w);

    approach(c, c.x + 120, c.y);
    hold(c, c.x + 120, c.y, 1_500);
    for (const w of c.drainWrites()) all.push(w);

    const cx = c.x;
    const cy = c.y;
    c.update({ pointerX: cx + 200, pointerY: cy, dtMs: FRAME });
    c.update({ pointerX: cx + 10, pointerY: cy, dtMs: FRAME });
    for (const w of c.drainWrites()) all.push(w);

    c.resize(round % 2 === 0 ? { width: 640, height: 480 } : { width: 1920, height: 1080 });
  }

  assert.ok(all.length > 50, `fixture should have produced writes, got ${all.length}`);
  for (const w of all) {
    assert.ok(Number.isInteger(w.x), `x must be an integer cell index, got ${w.x}`);
    assert.ok(Number.isInteger(w.y), `y must be an integer cell index, got ${w.y}`);
    assert.ok(w.x >= 0 && w.x < GRID.width, `x out of bounds: ${w.x}`);
    assert.ok(w.y >= 0 && w.y < GRID.height, `y out of bounds: ${w.y}`);
    assert.ok(w.alive === 0 || w.alive === 1, `alive must be 0 or 1, got ${w.alive}`);
  }
});

test('it loses interest in a motionless visitor and notices them coming back', () => {
  // starts at the default: twenty seconds of stillness is worth +0.6, which
  // stops short of `bold` and its longer tolerance for a motionless visitor
  const c = new Creature(options(11));
  const px = c.x + 200;
  const py = c.y;

  approach(c, px, py);
  assert.notEqual(c.state, 'dormant');

  // held perfectly still past the boredom threshold, it goes back to its own business
  hold(c, px, py, CREATURE_TUNING.boredomMs + 2_000);
  assert.equal(c.state, 'dormant', 'a statue should stop being interesting');

  // and moving again is enough to be noticed
  approach(c, c.x + 150, c.y);
  assert.notEqual(c.state, 'dormant', 'it should notice the visitor returning');
});

test('the same seed replays the same creature', () => {
  const script = (c: Creature): number[] => {
    const out: number[] = [];
    idle(c, 3_000);
    approach(c, c.x + 200, c.y);
    hold(c, c.x + 200, c.y, 3_000);
    for (const w of c.drainWrites()) out.push(w.x, w.y, w.alive);
    out.push(Math.round(c.x * 1000), Math.round(c.y * 1000), c.trust);
    return out;
  };

  assert.deepEqual(script(new Creature(options(77, 0.6))), script(new Creature(options(77, 0.6))));
});
