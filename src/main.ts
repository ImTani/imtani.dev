/**
 * Engine harness entry point. Scaffolding, not the site.
 *
 * Wires the three layers together so their interaction can be watched: the
 * deterministic substrate, the ephemeral surface field on top of it, and the
 * creature on top of that. Everything visible is a placeholder.
 */

import checkpointJson from './generated/checkpoint.json';
import { armMeans } from './engine/bandit.ts';
import type { Checkpoint } from './engine/checkpoint.ts';
import { STEP_MS, stepAt } from './engine/config.ts';
import { Rng, hashString } from './engine/prng.ts';
import { RULE_ARMS } from './engine/rules.ts';
import { SUBSTRATE_SPEC, setCell } from './engine/substrate.ts';
import { World } from './engine/world.ts';
import { CompositeRenderer } from './render/composite.ts';
import { SurfaceField } from './surface/field.ts';
import { Creature } from './surface/creature.ts';
import type { CreatureSave } from './surface/creature.ts';

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`harness markup missing: ${selector}`);
  return el;
}

const canvas = must<HTMLCanvasElement>('#view');
const statsEl = must<HTMLDListElement>('#stats');
const realBtn = must<HTMLButtonElement>('#real');
const fastBtn = must<HTMLButtonElement>('#fast');
const trustUpBtn = must<HTMLButtonElement>('#trust-up');
const trustResetBtn = must<HTMLButtonElement>('#trust-reset');

const spec = SUBSTRATE_SPEC;
const cells = spec.width * spec.height;

/* ---- the shared world ---------------------------------------------------- */

const checkpoint = checkpointJson as Checkpoint;
const loadStarted = performance.now();
const restored = World.fromCheckpoint(checkpoint);
const world = restored ?? new World();
const fromCheckpoint = restored !== null;
const loadMs = performance.now() - loadStarted;

/**
 * Steps to simulate per frame while catching up to now.
 *
 * At 57.8 microseconds per step this is roughly 8 ms, half a frame, which
 * leaves room for the surface layer and the draw. Catch-up is deliberately
 * *not* done in one blocking call before the first paint: at a one-second tick
 * and a six-hourly rebake the worst case is 21,600 steps, and a page that
 * freezes for a second before showing anything is a worse outcome than one
 * that shows the world immediately and races it forward.
 *
 * It is also the more honest presentation. The visitor watches the world
 * fast-forward from the last snapshot to the present, which demonstrates that
 * the history is real rather than asserting it in a paragraph.
 */
const CATCHUP_STEPS_PER_FRAME = 140;

const catchUpTarget = stepAt(Date.now());
const catchUpFrom = world.step;
let catchingUp = world.step < catchUpTarget;

/* ---- the personal layer -------------------------------------------------- */

const SAVE_KEY = 'imtani.creature.v1';

function loadSave(): CreatureSave | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as CreatureSave) : null;
  } catch {
    // Safari in private mode throws on access, and a corrupt value is just as
    // likely. Losing the personal layer is survivable; throwing here is not.
    return null;
  }
}

function persist(): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(creature.serialize()));
  } catch {
    /* storage unavailable or full — the shared world is unaffected */
  }
}

/* ---- layers -------------------------------------------------------------- */

const renderer = new CompositeRenderer(canvas, spec);
const surface = new SurfaceField({ spec });

// Prime the field. It is session-only and starts empty, and it only gains
// energy from a substrate transition — which in real time is once a minute. A
// cold start would therefore show a completely dark surface for the first
// sixty seconds, which is the worst possible first impression for the layer
// whose entire job is making that minute feel alive. Treating every currently
// live cell as a birth gives it something to decay from immediately.
surface.injectTransition(new Uint32Array(world.grid.length), world.grid);

const creatureOptions = {
  rng: new Rng(hashString('creature') ^ 0x51ee7),
  viewport: renderer.viewport,
  grid: { width: spec.width, height: spec.height },
} as const;

const save = loadSave();
const creature = save ? Creature.restore(save, creatureOptions) : new Creature(creatureOptions);

/* ---- input --------------------------------------------------------------- */

let pointerX: number | null = null;
let pointerY: number | null = null;

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  pointerX = e.clientX - rect.left;
  pointerY = e.clientY - rect.top;
});
canvas.addEventListener('pointerleave', () => {
  pointerX = null;
  pointerY = null;
});
window.addEventListener('resize', () => {
  renderer.resize();
  creature.resize(renderer.viewport);
});
window.addEventListener('beforeunload', persist);

let fast = false;
function setSpeed(next: boolean): void {
  fast = next;
  fastBtn.setAttribute('aria-pressed', String(fast));
  realBtn.setAttribute('aria-pressed', String(!fast));
}
realBtn.addEventListener('click', () => setSpeed(false));
fastBtn.addEventListener('click', () => setSpeed(true));

// Trust takes minutes to earn by design. These exist so the gated behaviours
// can be inspected without sitting still for ten minutes.
trustUpBtn.addEventListener('click', () => {
  // Written through the save and reloaded rather than mutated in place: trust
  // is private state behind a getter, and reaching into the instance would
  // couple the harness to the creature's internals for a debug affordance.
  const s = creature.serialize();
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...s, trust: Math.min(1, s.trust + 0.25) }));
  location.reload();
});
trustResetBtn.addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

/* ---- loop ---------------------------------------------------------------- */

// The surface field needs both generations to know what was born and what
// died, and World swaps its buffers internally without exposing the previous
// one. Snapshotting before each advance is 2,880 bytes and sidesteps adding a
// hook to the engine for something only the harness needs.
const previous = new Uint32Array(world.grid.length);

let lastFrame = performance.now();
let stepsApplied = 0;
let writesApplied = 0;

function frame(now: number): void {
  const dtMs = Math.max(0, now - lastFrame);
  lastFrame = now;

  previous.set(world.grid);
  const before = world.step;

  if (catchingUp) {
    // Bounded chunk per frame. `advanceTo` reports truncation, so the loop
    // knows whether it is still behind without recomputing the target.
    const result = world.advanceTo(stepAt(Date.now()), CATCHUP_STEPS_PER_FRAME);
    catchingUp = result.truncated;
  } else {
    world.advanceTo(fast ? world.step + 1 : stepAt(Date.now()));
  }

  if (world.step !== before) {
    surface.injectTransition(previous, world.grid);
    stepsApplied += world.step - before;
  }

  surface.advance(dtMs);

  creature.update({ pointerX, pointerY, dtMs });

  // The creature writes into this visitor's copy of the world. The global
  // substrate is untouched — divergence from the shared world is exactly what
  // the personal layer is.
  for (const w of creature.drainWrites()) {
    setCell(world.grid, spec, w.x, w.y, w.alive);
    surface.injectPoint(w.x, w.y, w.alive ? 0.9 : 1.4);
    writesApplied++;
  }

  renderer.draw(world.grid, surface.energy, surface.peak, creature);
  paintStats();
  requestAnimationFrame(frame);
}

/* ---- readout ------------------------------------------------------------- */

function row(term: string, value: string): string {
  return `<dt>${term}</dt><dd>${value}</dd>`;
}

let lastStatsAt = 0;
function paintStats(): void {
  // Rebuilding this string every frame dominates the profile and tells us
  // nothing; four times a second is plenty for reading numbers.
  if (performance.now() - lastStatsAt < 250) return;
  lastStatsAt = performance.now();

  const means = armMeans(world.bandit);
  const arms = RULE_ARMS.map((r, i) => `${r.name}=${Math.round(means[i]!)}`).join('  ');

  statsEl.innerHTML = [
    row('source', fromCheckpoint ? `checkpoint @ step ${checkpoint.step}` : 'epoch (checkpoint rejected)'),
    row('load', `${loadMs.toFixed(1)} ms to restore checkpoint`),
    row(
      'catch-up',
      catchingUp
        ? `running — ${world.step - catchUpFrom} of ${catchUpTarget - catchUpFrom} steps`
        : `done (${catchUpTarget - catchUpFrom} steps from the snapshot)`,
    ),
    row('step', `${world.step}  (${((world.step * STEP_MS) / 86_400_000).toFixed(2)} days of world time, +${stepsApplied} this session)`),
    row('rule', `${world.rule.name}  arm ${world.bandit.arm}, ${world.bandit.decisions} decisions`),
    row('population', `${world.population} / ${cells}  (${((world.population / cells) * 100).toFixed(2)}%)`),
    row('activity', world.metrics ? `${(world.metrics.activity / 100).toFixed(2)}%` : 'not yet measured'),
    row('surface peak', surface.peak.toFixed(3)),
    row('creature', `${creature.state}  trust ${creature.trust.toFixed(3)}  ${creature.embedded ? 'embedded' : 'vector'}  (${creature.x.toFixed(0)}, ${creature.y.toFixed(0)})`),
    row('creature writes', String(writesApplied)),
    row('arms', arms),
  ].join('');
}

setInterval(persist, 5_000);
requestAnimationFrame(frame);
