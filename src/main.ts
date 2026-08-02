/**
 * Engine harness entry point. Scaffolding, not the site.
 *
 * Loads the baked checkpoint, catches the world up to now, and draws it. The
 * point is to watch the numbers and confirm the substrate behaves the way the
 * tests claim. Everything visible here is a placeholder.
 */

import checkpointJson from './generated/checkpoint.json';
import type { Checkpoint } from './engine/checkpoint.ts';
import { STEP_MS, WORLD_EPOCH_ISO, stepAt } from './engine/config.ts';
import { armMeans } from './engine/bandit.ts';
import { RULE_ARMS } from './engine/rules.ts';
import { SUBSTRATE_SPEC } from './engine/substrate.ts';
import { World } from './engine/world.ts';
import { DebugRenderer } from './render/debug.ts';

/** Narrows at the point of lookup, so hoisted functions below still see it. */
function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`harness markup missing: ${selector}`);
  return el;
}

const canvas = must<HTMLCanvasElement>('#view');
const statsEl = must<HTMLDListElement>('#stats');
const fastBtn = must<HTMLButtonElement>('#fast');
const realBtn = must<HTMLButtonElement>('#real');

const cells = SUBSTRATE_SPEC.width * SUBSTRATE_SPEC.height;
const checkpoint = checkpointJson as Checkpoint;

const loadStarted = performance.now();
const restored = World.fromCheckpoint(checkpoint);
const world = restored ?? new World();
const fromCheckpoint = restored !== null;
const catchUp = world.advanceTo(stepAt(Date.now()));
const loadMs = performance.now() - loadStarted;

const renderer = new DebugRenderer(canvas, SUBSTRATE_SPEC);

let fast = false;
fastBtn.addEventListener('click', () => {
  fast = true;
});
realBtn.addEventListener('click', () => {
  fast = false;
});

function row(term: string, value: string): string {
  return `<dt>${term}</dt><dd>${value}</dd>`;
}

function paint(): void {
  renderer.draw(world.grid);

  const means = armMeans(world.bandit);
  const ranked = RULE_ARMS.map((r, i) => ({ name: r.name, mean: means[i]!, n: world.bandit.counts[i]! }))
    .sort((a, b) => b.mean - a.mean)
    .map((a) => `${a.name}=${Math.round(a.mean)}${a.n === 0 ? '?' : ''}`)
    .join('  ');

  statsEl.innerHTML = [
    row('source', fromCheckpoint ? `checkpoint @ step ${checkpoint.step}` : 'epoch (checkpoint rejected)'),
    row('load', `${loadMs.toFixed(1)} ms, caught up ${catchUp.stepped} steps${catchUp.truncated ? ' (TRUNCATED)' : ''}`),
    row('epoch', WORLD_EPOCH_ISO),
    row('step', `${world.step}  (${((world.step * STEP_MS) / 86_400_000).toFixed(2)} days of world time)`),
    row('rule', `${world.rule.name}  arm ${world.bandit.arm}, ${world.bandit.decisions} decisions`),
    row('population', `${world.population} / ${cells}  (${((world.population / cells) * 100).toFixed(2)}%)`),
    row('activity', world.metrics ? `${(world.metrics.activity / 100).toFixed(2)}%` : 'not yet measured'),
    row('reward', world.metrics ? String(world.metrics.reward) : 'not yet measured'),
    row('arms', ranked),
  ].join('');
}

function frame(): void {
  if (fast) {
    world.advanceTo(world.step + 1);
  } else {
    world.advanceTo(stepAt(Date.now()));
  }
  paint();
  requestAnimationFrame(frame);
}

paint();
requestAnimationFrame(frame);
