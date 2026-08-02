/**
 * Epsilon-greedy bandit over rule variants.
 *
 * The same method as the repricer's retraining loop, pointed at a different
 * problem: which rule keeps this world worth looking at. It observes the
 * automaton, not the visitor.
 *
 * Deterministic by construction. Exploration draws come from a counter-based
 * PRNG keyed on the decision index, so a client resuming from a checkpoint
 * makes exactly the choices the original run made. Arm comparison is done by
 * cross-multiplication rather than by computing means, so no floating-point
 * division ever decides which rule the world runs.
 */

import { Rng } from './prng.ts';
import { RULE_ARMS } from './rules.ts';
import type { Rule } from './rules.ts';

/** Substrate steps between decisions. At one step per minute, one hour. */
export const DECISION_INTERVAL = 60;

/** Exploration rate in parts per thousand. Constant — no decay, deliberately. */
export const EPSILON_PER_MILLE = 100;

export interface BanditState {
  /** Index into RULE_ARMS of the arm currently running. */
  arm: number;
  /** Total reward observed per arm. Integers, summed without division. */
  readonly sums: number[];
  /** Number of decisions credited to each arm. */
  readonly counts: number[];
  /** Reward accumulated for the current arm since it was selected. */
  pending: number;
  /** Samples accumulated for the current arm since it was selected. */
  pendingSamples: number;
  /** Monotonic decision index. Also the PRNG stream position. */
  decisions: number;
}

export function initBandit(startingArm = 0): BanditState {
  return {
    arm: startingArm,
    sums: new Array<number>(RULE_ARMS.length).fill(0),
    counts: new Array<number>(RULE_ARMS.length).fill(0),
    pending: 0,
    pendingSamples: 0,
    decisions: 0,
  };
}

export function currentRule(state: BanditState): Rule {
  return RULE_ARMS[state.arm] ?? RULE_ARMS[0]!;
}

/** Fold one generation's reward into the running arm's tally. */
export function observe(state: BanditState, reward: number): void {
  state.pending += reward;
  state.pendingSamples += 1;
}

/**
 * Is arm `a` strictly better than arm `b` on observed mean reward?
 *
 * Compares sums[a]/counts[a] > sums[b]/counts[b] by cross-multiplication.
 * Every quantity is a non-negative integer well inside 2^53 — a year of
 * hourly decisions caps the products around 7.7e11 — so this is exact.
 */
function better(state: BanditState, a: number, b: number): boolean {
  const ca = state.counts[a]!;
  const cb = state.counts[b]!;
  if (ca === 0 && cb === 0) return false;
  if (cb === 0) return false;
  if (ca === 0) return false;
  return state.sums[a]! * cb > state.sums[b]! * ca;
}

/**
 * Close out the current arm and choose the next one.
 *
 * Called every DECISION_INTERVAL steps. `seed` is the world seed; the decision
 * index supplies the stream position, so this is reproducible from a checkpoint
 * without storing any generator state beyond `decisions`.
 */
export function decide(state: BanditState, seed: number): void {
  if (state.pendingSamples > 0) {
    // Credit the mean of the window rather than the sum, so an arm is not
    // rewarded for having been observed longer than another.
    state.sums[state.arm] =
      state.sums[state.arm]! + Math.floor(state.pending / state.pendingSamples);
    state.counts[state.arm] = state.counts[state.arm]! + 1;
  }
  state.pending = 0;
  state.pendingSamples = 0;

  const rng = new Rng(seed ^ 0x1d5c0de, state.decisions);
  state.decisions += 1;

  // Every arm gets one forced trial before exploitation begins, otherwise the
  // first arm to score anything at all monopolises the greedy branch.
  const untried = state.counts.findIndex((c) => c === 0);
  if (untried !== -1) {
    state.arm = untried;
    return;
  }

  if (rng.int(1000) < EPSILON_PER_MILLE) {
    state.arm = rng.int(RULE_ARMS.length);
    return;
  }

  let best = 0;
  for (let i = 1; i < RULE_ARMS.length; i++) {
    if (better(state, i, best)) best = i;
  }
  state.arm = best;
}

/** Mean reward per arm, for display. Never used to make a decision. */
export function armMeans(state: BanditState): number[] {
  return state.sums.map((sum, i) => {
    const n = state.counts[i]!;
    return n === 0 ? 0 : sum / n;
  });
}
