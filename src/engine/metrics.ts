/**
 * The reward signal, computed from the automaton and nothing else.
 *
 * This is the whole basis for the claim that the background is "running the
 * same method as the pricing engine" without collecting anything about anyone.
 * No visitor behaviour enters here. The bandit optimises the world's own
 * liveliness: alive but not saturated, changing but not pure noise.
 *
 * INTEGER ARITHMETIC ONLY, and this is a hard requirement rather than a
 * preference. The reward feeds arm selection, which selects the rule, which
 * determines every subsequent cell — so a reward that differs by one ulp
 * between V8 and JavaScriptCore would eventually produce a visibly different
 * world on Safari. Math.exp and Math.pow are explicitly implementation-defined
 * in ECMA-262 and must never appear in this file.
 */

import { hammingDistance, population } from './substrate.ts';
import type { GridSpec } from './substrate.ts';

/** Fixed-point scale for all scores in this module. 1 unit = 1/10000. */
export const SCORE_SCALE = 10_000;

export interface WorldMetrics {
  /** Live cells per 10,000. */
  readonly density: number;
  /** Cells changed since the previous generation, per 10,000. */
  readonly activity: number;
  /** Combined band-pass score, 0..SCORE_SCALE. */
  readonly reward: number;
}

/**
 * Triangular band-pass. Zero outside (lo, hi), peaking at SCORE_SCALE at `peak`.
 *
 * Triangular rather than Gaussian precisely because it needs no transcendental
 * function — see the note at the top of this file.
 */
export function bandPass(v: number, lo: number, peak: number, hi: number): number {
  if (v <= lo || v >= hi) return 0;
  if (v === peak) return SCORE_SCALE;
  if (v < peak) return Math.floor(((v - lo) * SCORE_SCALE) / (peak - lo));
  return Math.floor(((hi - v) * SCORE_SCALE) / (hi - peak));
}

/**
 * Tuning constants, in units of 1/10000.
 *
 * These are hand-picked, not derived. They encode a judgement about what
 * "interesting" means — roughly 12% of the grid alive and roughly 8% of it
 * changing every generation — and they are the correct thing to argue about
 * once there is something on screen to look at.
 */
export const DENSITY_BAND = { lo: 100, peak: 1_200, hi: 5_000 } as const;
export const ACTIVITY_BAND = { lo: 20, peak: 800, hi: 4_000 } as const;

export function measure(
  prev: Uint32Array,
  cur: Uint32Array,
  spec: GridSpec,
): WorldMetrics {
  const cells = spec.width * spec.height;
  const density = Math.floor((population(cur) * SCORE_SCALE) / cells);
  const activity = Math.floor((hammingDistance(prev, cur) * SCORE_SCALE) / cells);

  const d = bandPass(density, DENSITY_BAND.lo, DENSITY_BAND.peak, DENSITY_BAND.hi);
  const a = bandPass(activity, ACTIVITY_BAND.lo, ACTIVITY_BAND.peak, ACTIVITY_BAND.hi);

  // Product, renormalised back to the same scale. A rule must satisfy both
  // conditions: a still life scores zero however good its density, and a
  // saturated boiling mess scores zero however active it is.
  return { density, activity, reward: Math.floor((d * a) / SCORE_SCALE) };
}
