/**
 * World constants. Changing any of these changes the world for everybody, and
 * invalidates every baked checkpoint — treat them as published, not as tuning.
 */

/**
 * The seed. Public on purpose: with this, the epoch and the rule set, anyone
 * can recompute the entire history from scratch and check that what the site
 * claims to be showing is what it is actually showing.
 */
export const WORLD_SEED = 0x746e_6169; // "tnai"

/** Substrate epoch — the moment the world started. */
export const WORLD_EPOCH_ISO = '2026-07-26T00:00:00.000Z';
export const WORLD_EPOCH_MS = Date.parse(WORLD_EPOCH_ISO);

/**
 * Milliseconds per substrate step.
 *
 * One second. The first version was one minute, chosen so a week of absence
 * caught up in half a second — and that was optimising the wrong thing. It
 * bought a fast page load at the cost of a world that visibly changed once a
 * minute, which reads as a still image rather than a simulation.
 *
 * Measured at 192x120: 57.8 microseconds per step. At one second per step and
 * a six-hourly rebake, the worst-case catch-up is 21,600 steps, about 1.2
 * seconds of compute — and it no longer blocks anything, because the client
 * advances in bounded chunks across frames instead of in one call.
 *
 * The surface layer still runs at animation rate on top of this; a one-second
 * substrate is structure, not motion.
 */
export const STEP_MS = 1_000;

/** Fraction of cells seeded live at epoch, in parts per 10,000. */
export const INITIAL_DENSITY = 3_200;

/**
 * Immigration floor, in parts per 10,000.
 *
 * The empty grid is an absorbing state: no rule in the arm set has B0, so a
 * world that reaches zero population stays there forever, and every arm then
 * scores zero so the bandit can never learn its way out. Since the search is
 * guaranteed to try every arm — including ones that are lethal from some states
 * — extinction was not a risk but a certainty. Measured: B34/S34 emptied the
 * grid at step 420 on the first run.
 *
 * So the world has a floor. Below it, cells arrive. This is a rule of the world
 * rather than a patch on one: it is deterministic, it is keyed on the step, and
 * it makes the state space non-absorbing so that a bad arm is punished with a
 * low reward instead of ending the simulation.
 */
export const IMMIGRATION_FLOOR = 400;

/**
 * Density immigration restores, in parts per 10,000.
 *
 * Deliberately the peak of the reward band rather than a hair above the floor.
 * The first attempt topped the world up to just past the floor and it then sat
 * there — 2 to 4 percent, scoring around 2,700 where it had opened at 9,026,
 * because no rule can rebuild structure from a grid that sparse. A floor that
 * only prevents death produces a permanently impoverished world. Recovery has
 * to return it to somewhere rules can actually work.
 */
export const IMMIGRATION_TARGET = 1_200;

/** Fill density within a stamped word, in parts per 10,000. */
export const IMMIGRATION_PATCH_DENSITY = 4_000;

export function stepAt(timeMs: number): number {
  const elapsed = timeMs - WORLD_EPOCH_MS;
  return elapsed <= 0 ? 0 : Math.floor(elapsed / STEP_MS);
}

export function timeOfStep(step: number): number {
  return WORLD_EPOCH_MS + step * STEP_MS;
}
