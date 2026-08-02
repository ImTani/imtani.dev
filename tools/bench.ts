/**
 * Substrate throughput, and what it implies for catch-up.
 *
 * The numbers here are the reason the design is shaped the way it is: a fast
 * clock cannot be fast-forwarded (a week at 30 steps/second is 18,144,000
 * steps), and a slow clock can (a week at one step/minute is 10,080).
 */

import { DEFAULT_RULE, RULE_ARMS } from '../src/engine/rules.ts';
import { STEP_MS } from '../src/engine/config.ts';
import {
  allocGrid,
  makeScratch,
  makeSpec,
  pack,
  step,
} from '../src/engine/substrate.ts';
import { Rng } from '../src/engine/prng.ts';
import { activeCounts } from '../src/engine/rules.ts';

const SIZES: readonly (readonly [number, number])[] = [
  [128, 72],
  [160, 96],
  [192, 120],
  [320, 192],
  [480, 288],
  [960, 544],
];

function soup(width: number, height: number): Uint8Array {
  const rng = new Rng(0xbeef);
  const a = new Uint8Array(width * height);
  for (let i = 0; i < a.length; i++) a[i] = rng.float() < 0.35 ? 1 : 0;
  return a;
}

function msPerStep(width: number, height: number, target = 600): number {
  const spec = makeSpec(width, height);
  let cur = pack(soup(width, height), spec);
  let next = allocGrid(spec);
  const scratch = makeScratch(spec);
  const counts = activeCounts(DEFAULT_RULE);

  for (let i = 0; i < 5; i++) step(cur, next, spec, DEFAULT_RULE, scratch, counts);

  let n = 16;
  for (;;) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < n; i++) {
      step(cur, next, spec, DEFAULT_RULE, scratch, counts);
      [cur, next] = [next, cur];
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms >= target || n > 1 << 20) return ms / n;
    n *= 2;
  }
}

const WEEK = Math.floor((7 * 24 * 60 * 60 * 1000) / STEP_MS);
const YEAR = Math.floor((365 * 24 * 60 * 60 * 1000) / STEP_MS);
const FAST_WEEK = 30 * 7 * 24 * 60 * 60;

console.log(`node ${process.version}   rule ${DEFAULT_RULE.name}   ${RULE_ARMS.length} arms`);
console.log(`slow clock: ${STEP_MS} ms/step -> ${WEEK} steps/week, ${YEAR} steps/year\n`);
console.log('grid          cells    ms/step     week      year   |  7d at 30/s');
console.log('-'.repeat(74));

for (const [w, h] of SIZES) {
  const ms = msPerStep(w, h);
  const marker = w === 192 && h === 120 ? '  <- substrate' : '';
  console.log(
    `${`${w}x${h}`.padEnd(10)} ${String(w * h).padStart(7)}   ${ms.toFixed(4).padStart(8)}  ` +
      `${`${((ms * WEEK) / 1000).toFixed(2)}s`.padStart(8)}  ` +
      `${`${((ms * YEAR) / 1000).toFixed(1)}s`.padStart(8)}   |  ` +
      `${((ms * FAST_WEEK) / 1000 / 60).toFixed(0).padStart(5)} min${marker}`,
  );
}
