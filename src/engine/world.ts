/**
 * The world: a pure function of (seed, epoch, now).
 *
 * Every visitor computing the same step number gets bit-identical cells. There
 * is no server, nothing is stored, and nothing about anybody is recorded — the
 * shared world exists because the maths is reproducible, not because a database
 * remembers it.
 *
 * Personal marks live in a separate layer and are never folded in here.
 */

import type { BanditState } from './bandit.ts';
import { DECISION_INTERVAL, currentRule, decide, initBandit, observe } from './bandit.ts';
import { CHECKPOINT_VERSION, decodeGrid, encodeGrid, isCompatible } from './checkpoint.ts';
import type { Checkpoint } from './checkpoint.ts';
import {
  IMMIGRATION_FLOOR,
  IMMIGRATION_PATCH_DENSITY,
  IMMIGRATION_TARGET,
  INITIAL_DENSITY,
  STEP_MS,
  WORLD_EPOCH_MS,
  WORLD_SEED,
  stepAt,
} from './config.ts';
import { measure } from './metrics.ts';
import type { WorldMetrics } from './metrics.ts';
import { RULE_ARMS, activeCounts } from './rules.ts';
import type { Rule } from './rules.ts';
import { Rng } from './prng.ts';
import {
  SUBSTRATE_SPEC,
  allocGrid,
  makeScratch,
  population,
} from './substrate.ts';
import type { GridSpec, StepScratch } from './substrate.ts';
import { step as stepGrid } from './substrate.ts';

export interface AdvanceResult {
  /** Steps actually simulated. */
  readonly stepped: number;
  /** True if the budget ran out before reaching the target. */
  readonly truncated: boolean;
  /** Wall-clock milliseconds spent. Diagnostics only — never fed back in. */
  readonly elapsedMs: number;
}

export interface WorldOptions {
  readonly spec?: GridSpec;
  readonly seed?: number;
  readonly epochMs?: number;
  readonly stepMs?: number;
}

export class World {
  readonly spec: GridSpec;
  readonly seed: number;
  readonly epochMs: number;
  readonly stepMs: number;

  private cur: Uint32Array;
  private next: Uint32Array;
  private readonly scratch: StepScratch;
  private cachedRule: Rule;
  private cachedCounts: readonly number[];

  step: number;
  bandit: BanditState;

  /**
   * Null until a generation has actually been simulated.
   *
   * Activity is a difference between two generations, so a world restored from
   * a checkpoint genuinely has no value for it — the previous grid was never
   * stored and cannot be recovered. Reporting zero would read as "nothing is
   * happening" when the truth is "not yet measured", and the harness was
   * displaying exactly that lie.
   */
  metrics: WorldMetrics | null;

  constructor(options: WorldOptions = {}) {
    this.spec = options.spec ?? SUBSTRATE_SPEC;
    this.seed = options.seed ?? WORLD_SEED;
    this.epochMs = options.epochMs ?? WORLD_EPOCH_MS;
    this.stepMs = options.stepMs ?? STEP_MS;

    this.cur = allocGrid(this.spec);
    this.next = allocGrid(this.spec);
    this.scratch = makeScratch(this.spec);
    this.step = 0;
    this.bandit = initBandit();
    this.cachedRule = currentRule(this.bandit);
    this.cachedCounts = activeCounts(this.cachedRule);
    this.metrics = null;

    this.seedInitial();
  }

  /**
   * Fill the grid at the epoch.
   *
   * Draws one 32-bit word at a time and masks it down to the target density by
   * ANDing independent draws — an integer route to a sub-50% fill that consumes
   * a fixed, reproducible number of draws per word.
   */
  private seedInitial(): void {
    const rng = new Rng((this.seed ^ 0x5eed_0001) | 0, 0);
    const threshold = Math.floor((INITIAL_DENSITY / 10_000) * 4294967296);
    for (let y = 0; y < this.spec.height; y++) {
      for (let w = 0; w < this.spec.words; w++) {
        let word = 0;
        for (let bit = 0; bit < 32; bit++) {
          if (rng.next() < threshold) word |= 1 << bit;
        }
        this.cur[y * this.spec.words + w] = word >>> 0;
      }
    }
  }

  /**
   * Stamp live cells when the world falls below the floor.
   *
   * Deterministic: the generator is keyed on the step index, so every client
   * that reaches this step stamps the identical patch in the identical place.
   * Runs after measurement, so the reward still reflects what the rule did
   * rather than what the floor rescued — a lethal arm is punished properly and
   * the bandit learns to leave it alone.
   */
  private immigrate(currentDensity: number): void {
    const rng = new Rng((this.seed ^ 0x1_3f4a_9c) | 0, this.step);
    const threshold = Math.floor((IMMIGRATION_PATCH_DENSITY / 10_000) * 4294967296);
    const totalWords = this.cur.length;

    // Cells needed to reach the target, converted to a word count at the
    // patch's fill rate. Overlap with existing life makes this a slight
    // under-estimate, which is the right direction to err in.
    const cells = this.spec.width * this.spec.height;
    const deficit = Math.max(0, IMMIGRATION_TARGET - currentDensity);
    const wanted = Math.floor((deficit * cells) / 10_000);
    const perWord = Math.max(1, Math.floor((32 * IMMIGRATION_PATCH_DENSITY) / 10_000));
    const stamps = Math.min(totalWords, Math.ceil(wanted / perWord));

    for (let s = 0; s < stamps; s++) {
      const i = rng.int(totalWords);
      let word = 0;
      for (let bit = 0; bit < 32; bit++) {
        if (rng.next() < threshold) word |= 1 << bit;
      }
      this.cur[i] = (this.cur[i]! | word) >>> 0;
    }
  }

  get grid(): Uint32Array {
    return this.cur;
  }

  get rule(): Rule {
    return this.cachedRule;
  }

  get population(): number {
    return population(this.cur);
  }

  /** The step this world should be at for a given wall-clock time. */
  targetStepAt(timeMs: number): number {
    const elapsed = timeMs - this.epochMs;
    return elapsed <= 0 ? 0 : Math.floor(elapsed / this.stepMs);
  }

  /**
   * Simulate forward to `targetStep`.
   *
   * `maxSteps` bounds the work so a stale or incompatible checkpoint can never
   * hang the page — it returns `truncated` and the caller decides whether to
   * show a slightly-behind world or wait. Never silently gives up.
   */
  advanceTo(targetStep: number, maxSteps = 200_000): AdvanceResult {
    const startedAt = Date.now();
    const wanted = Math.max(0, targetStep - this.step);
    const budget = Math.min(wanted, maxSteps);

    for (let i = 0; i < budget; i++) {
      stepGrid(this.cur, this.next, this.spec, this.cachedRule, this.scratch, this.cachedCounts);
      const swap = this.cur;
      this.cur = this.next;
      this.next = swap;
      this.step += 1;

      // `next` now holds the previous generation, so this is prev-vs-current.
      const metrics = measure(this.next, this.cur, this.spec);
      this.metrics = metrics;
      observe(this.bandit, metrics.reward);

      if (metrics.density < IMMIGRATION_FLOOR) this.immigrate(metrics.density);

      if (this.step % DECISION_INTERVAL === 0) {
        decide(this.bandit, this.seed);
        this.cachedRule = currentRule(this.bandit);
        this.cachedCounts = activeCounts(this.cachedRule);
      }
    }

    return {
      stepped: budget,
      truncated: budget < wanted,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /** Advance to whatever step `timeMs` implies. */
  advanceToTime(timeMs: number, maxSteps?: number): AdvanceResult {
    return this.advanceTo(this.targetStepAt(timeMs), maxSteps);
  }

  toCheckpoint(): Checkpoint {
    return {
      version: CHECKPOINT_VERSION,
      seed: this.seed,
      epochMs: this.epochMs,
      stepMs: this.stepMs,
      width: this.spec.width,
      height: this.spec.height,
      step: this.step,
      grid: encodeGrid(this.cur),
      bandit: structuredClone(this.bandit),
      arms: RULE_ARMS.map((r) => r.name),
    };
  }

  /**
   * Resume from a checkpoint, or return null if it describes a different world.
   *
   * Returning null rather than throwing is deliberate: an incompatible snapshot
   * is an ordinary consequence of changing the seed or the rule set, and the
   * caller's correct response is to fall back to simulating from the epoch.
   */
  static fromCheckpoint(cp: Checkpoint, options: WorldOptions = {}): World | null {
    const spec = options.spec ?? SUBSTRATE_SPEC;
    const seed = options.seed ?? WORLD_SEED;
    const epochMs = options.epochMs ?? WORLD_EPOCH_MS;
    const stepMs = options.stepMs ?? STEP_MS;

    if (!isCompatible(cp, spec, seed, epochMs, stepMs)) return null;

    const world = new World(options);
    const grid = decodeGrid(cp.grid, spec.words * spec.height);
    world.cur.set(grid);
    world.step = cp.step;
    world.bandit = structuredClone(cp.bandit);
    world.cachedRule = currentRule(world.bandit);
    world.cachedCounts = activeCounts(world.cachedRule);
    return world;
  }
}

/** Convenience: the shared world as it should look right now. */
export function currentWorld(now = Date.now(), checkpoint?: Checkpoint): World {
  const world = (checkpoint && World.fromCheckpoint(checkpoint)) ?? new World();
  world.advanceTo(stepAt(now));
  return world;
}
