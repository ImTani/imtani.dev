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

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WORLD_EPOCH_ISO, stepAt } from '../src/engine/config.ts';
import { World } from '../src/engine/world.ts';
import { RULE_ARMS } from '../src/engine/rules.ts';
import { SUBSTRATE_SPEC } from '../src/engine/substrate.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, '../src/generated/checkpoint.json');

const now = Date.now();
const target = stepAt(now);

const world = new World();
const started = Date.now();
const result = world.advanceTo(target, Number.MAX_SAFE_INTEGER);
const elapsed = Date.now() - started;

const checkpoint = world.toCheckpoint();
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(checkpoint)}\n`, 'utf8');

const cells = SUBSTRATE_SPEC.width * SUBSTRATE_SPEC.height;
const bytes = Buffer.byteLength(JSON.stringify(checkpoint), 'utf8');

console.log(`baked ${outPath}`);
console.log(`  epoch      ${WORLD_EPOCH_ISO}`);
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
