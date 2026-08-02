/**
 * Drive the creature over simulated time and print what it does.
 *
 * Exists because a headless screenshot cannot answer the only question that
 * matters about this module — whether it behaves — and `--virtual-time-budget`
 * does not drive requestAnimationFrame for enough frames to tell. Tests assert
 * that behaviours occur; this shows their shape, which is what tuning needs.
 */

import { Rng } from '../src/engine/prng.ts';
import { CREATURE_TUNING, Creature } from '../src/surface/creature.ts';
import type { CreatureState } from '../src/surface/creature.ts';

const VIEWPORT = { width: 1100, height: 687 };
const GRID = { width: 192, height: 120 };
const FRAME_MS = 16;

function make(trust?: number): Creature {
  return new Creature(
    trust === undefined
      ? { rng: new Rng(0xc0ffee), viewport: VIEWPORT, grid: GRID }
      : { rng: new Rng(0xc0ffee), viewport: VIEWPORT, grid: GRID, trust },
  );
}

interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
  readonly state: CreatureState;
  readonly trust: number;
  readonly writes: number;
}

function run(
  creature: Creature,
  seconds: number,
  pointer: (t: number) => { x: number | null; y: number | null },
  sampleEvery = 5,
): Sample[] {
  const samples: Sample[] = [];
  let writes = 0;
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  let nextSample = 0;

  for (let f = 0; f <= frames; f++) {
    const t = (f * FRAME_MS) / 1000;
    const p = pointer(t);
    creature.update({ pointerX: p.x, pointerY: p.y, dtMs: FRAME_MS });
    writes += creature.drainWrites().length;

    if (t >= nextSample) {
      samples.push({ t, x: creature.x, y: creature.y, state: creature.state, trust: creature.trust, writes });
      nextSample += sampleEvery;
    }
  }
  return samples;
}

function table(title: string, samples: readonly Sample[]): void {
  console.log(`\n=== ${title}`);
  console.log('    t      x      y   state         trust   writes');
  let prev: Sample | null = null;
  let travelled = 0;
  for (const s of samples) {
    if (prev) travelled += Math.hypot(s.x - prev.x, s.y - prev.y);
    console.log(
      `${s.t.toFixed(0).padStart(5)}s ${s.x.toFixed(0).padStart(6)} ${s.y.toFixed(0).padStart(6)}   ` +
        `${s.state.padEnd(12)} ${s.trust.toFixed(3).padStart(5)} ${String(s.writes).padStart(8)}`,
    );
    prev = s;
  }
  console.log(`  sampled path length: ${travelled.toFixed(0)} px`);
}

// 1. Nobody is here. It must not freeze.
table(
  'idle, pointer absent, 60s',
  run(make(), 60, () => ({ x: null, y: null })),
);

// 2. The realistic path a visitor takes: move the cursor in so it notices you,
//    then hold still. A cursor that is already stationary at t=0 never exceeds
//    `noticeSpeed`, so it never wakes the creature and reads as an empty room —
//    which is correct behaviour, and makes "hold still from the start" a
//    meaningless test rather than a failing one.
table(
  'cursor sweeps in over 2s, then holds still at (520, 400), 60s',
  run(make(), 60, (t) => {
    if (t < 2) return { x: 200 + t * 160, y: 660 - t * 130 };
    return { x: 520, y: 400 };
  }),
);

// 2b. The same intent, but with the cursor moving *while already close*.
//     Isolates whether the trust mechanism works at all from whether its entry
//     condition is reachable: waking requires proximity and motion in the same
//     frame, and a visitor who moves in from far away then stops never has both.
table(
  'cursor jiggles continuously beside the creature, 60s',
  run(make(), 60, (t) => ({
    x: 820 + Math.sin(t * 3) * 90,
    y: 520 + Math.cos(t * 2.2) * 70,
  })),
);

// 3. Already trusted, idle. It should be marking the world unprompted.
table(
  'trust 0.7, pointer absent, 60s — should be writing',
  run(make(0.7), 60, () => ({ x: null, y: null })),
);

// 4. Calm, then a flick straight at it at t=20s.
const startled = make(0.6);
table(
  'trust 0.6, calm then a flick at t=20s',
  run(startled, 40, (t) => {
    if (t < 20) return { x: 520, y: 400 };
    // ~2,400 px/s sweep across where it is standing
    const k = (t - 20) * 2400;
    return { x: 520 + (k % 800) - 400, y: 400 };
  }, 2),
);

console.log(
  `\ntuning: startle ${CREATURE_TUNING.startleSpeed} px/s within ${CREATURE_TUNING.startleRadius} px` +
    ` · approach ${CREATURE_TUNING.approachSpeed} px/s · wander ${CREATURE_TUNING.wanderSpeed} px/s` +
    ` · gates ${CREATURE_TUNING.spectatorTrust}/${CREATURE_TUNING.trailTrust}/${CREATURE_TUNING.boldTrust}`,
);
