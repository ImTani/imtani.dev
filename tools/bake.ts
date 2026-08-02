/**
 * Bake a world snapshot at build time.
 *
 * This is what stops catch-up cost from growing with the age of the site.
 * Without it, a first-time visitor two years after launch simulates every step
 * from the epoch — measured at 37 seconds. With a snapshot shipped in the
 * bundle and a weekly scheduled rebuild, the worst case is bounded by the
 * deploy interval instead.
 *
 * The snapshot is a shortcut, never a source of truth: the seed and epoch are
 * public, so anyone can recompute the same state from scratch and check it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_EPOCH_ISO, stepAt } from '../src/engine/config.ts';
import type { Checkpoint } from '../src/engine/checkpoint.ts';
import { World } from '../src/engine/world.ts';
import { RULE_ARMS } from '../src/engine/rules.ts';
import { SUBSTRATE_SPEC } from '../src/engine/substrate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../src/generated/checkpoint.json');

const now = Date.now();
const target = stepAt(now);

/**
 * Resume from the previous snapshot when there is a usable one.
 *
 * Baking from the epoch every time makes this job's cost grow with the age of
 * the site rather than with the interval since the last bake — at a one-second
 * tick that is 51 seconds after a week and roughly half an hour after a year,
 * for a job that runs four times a day. Resuming bounds it at the rebake
 * interval instead: six hours of world time is 21,600 steps, about 1.2 seconds.
 *
 * This is caching, not a change to the world. Resuming from a checkpoint at
 * step N produces exactly what replaying from the epoch to step N produces —
 * that property is what `test/determinism.test.ts` exists to hold — so the
 * world stays independently verifiable from the seed by anyone willing to
 * spend the half hour. `fromCheckpoint` returns null for a snapshot describing
 * a different world (changed seed, tick, geometry or rule set), so a stale one
 * degrades to a slow correct bake rather than a fast wrong one.
 */
function resume(): World | null {
  if (!existsSync(outPath)) return null;
  try {
    const previous = JSON.parse(readFileSync(outPath, 'utf8')) as Checkpoint;
    const world = World.fromCheckpoint(previous);
    if (!world) {
      console.log('previous checkpoint describes a different world — baking from the epoch');
      return null;
    }
    if (world.step > target) {
      console.log('previous checkpoint is ahead of now — baking from the epoch');
      return null;
    }
    return world;
  } catch (cause) {
    console.log(`previous checkpoint unreadable (${String(cause)}) — baking from the epoch`);
    return null;
  }
}

const resumed = resume();
const world = resumed ?? new World();
const started = Date.now();
const result = world.advanceTo(target, Number.MAX_SAFE_INTEGER);
const elapsed = Date.now() - started;

const checkpoint = world.toCheckpoint();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(checkpoint)}\n`, 'utf8');

const cells = SUBSTRATE_SPEC.width * SUBSTRATE_SPEC.height;
const bytes = Buffer.byteLength(JSON.stringify(checkpoint), 'utf8');

console.log(`baked ${outPath}`);
console.log(`  from       ${resumed ? `checkpoint @ step ${target - result.stepped}` : `epoch ${WORLD_EPOCH_ISO}`}`);
console.log(`  now        ${new Date(now).toISOString()}`);
console.log(`  step       ${world.step} (${result.stepped} simulated in ${elapsed} ms)`);
console.log(`  rule       ${world.rule.name}  arm ${world.bandit.arm}/${RULE_ARMS.length}`);
console.log(
  `  population ${world.population} of ${cells}` +
    ` (${((world.population / cells) * 100).toFixed(2)}%)`,
);
console.log(`  decisions  ${world.bandit.decisions}`);
console.log(`  size       ${(bytes / 1024).toFixed(1)} kB`);

if (result.truncated) {
  console.error('bake did not reach the target step');
  process.exit(1);
}
