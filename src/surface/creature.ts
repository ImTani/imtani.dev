/**
 * The creature. There is exactly one, it cannot die, and it is not a pet.
 *
 * "If a cat was a cell." It is grid-bound and pixelated while it is *inside* the
 * automaton and lives in vector space otherwise, so `embedded` is not a cosmetic
 * flag — it is the same predicate that decides whether it can touch cells at all.
 * A creature that is not embedded is not in the world and cannot write to it.
 *
 * Deliberately outside `src/engine/`. The engine is the shared world: bit-exact
 * for every visitor, a pure function of (seed, epoch, now), and nothing a human
 * does may enter it. This file is the opposite — it exists only for the current
 * session, it responds to one person, and its output is a *request* to edit the
 * substrate that the caller applies to the personal layer. It still takes an
 * `Rng` and never calls `Math.random`, because a behavioural test that fails one
 * run in twenty is worse than no test at all.
 *
 * It does not render. It has no idea what it looks like. `x`, `y`, `heading` and
 * `embedded` are everything a renderer is given, and drawing decisions are made
 * somewhere else.
 *
 * ## The trust gate
 *
 * The one mechanic worth understanding. Trust is 0..1, persists across sessions
 * via `serialize`/`restore`, and gates *how much of the world the creature is
 * willing to be part of* — not how friendly it acts:
 *
 * - **below 0.2** it never embeds. It floats over the automaton as a spectator
 *   and keeps 200 px away. Nothing it does leaves a mark, including panic.
 * - **0.2 to 0.5** it embeds and will close to 120 px, but every mark it makes
 *   is involuntary: it scars cells when startled and writes nothing on purpose.
 * - **above 0.5** it comes to the cursor and drags a thin line of live cells
 *   behind it. This is the first moment the world registers that it exists.
 * - **above 0.8** it follows, tolerates movement that would have sent it fleeing
 *   before, and enters `bold`. Integration note: `state === 'bold'` is the gate
 *   for letting the *visitor* write to the substrate. There is no other one.
 *
 * The gates are trust-shaped rather than time-shaped so that the terrain becomes
 * a record of the relationship. A visitor who keeps flicking the mouse at it
 * leaves a field of holes; one who sits still leaves a trail. Both are still
 * legible in the substrate minutes later, because the automaton heals through
 * ordinary rules and takes its time about it.
 *
 * ## Independence
 *
 * When unobserved it wanders and meddles with the automaton on its own, and it
 * stops accruing trust from a visitor it has stopped attending to — holding a
 * cursor still forever bores it, and boredom is what caps trust in one sitting.
 * Reaching `bold` therefore requires coming back, which is the point.
 */

import type { Rng } from '../engine/prng.ts';

export type CreatureState =
  | 'dormant' // visitor absent or long idle; wanders, interacts with the world
  | 'aware' // has noticed the cursor, orients, does not approach
  | 'curious' // cursor has been still; begins closing distance
  | 'approaching' // actively moving toward the cursor
  | 'startled' // fleeing after a sudden movement
  | 'bold'; // high trust; follows, and writes to the substrate

export interface CreatureInput {
  /** CSS pixels, or null when the pointer has left the window entirely. */
  readonly pointerX: number | null;
  readonly pointerY: number | null;
  readonly dtMs: number;
}

/** A substrate edit the creature wants made. Grid coordinates. */
export interface SubstrateWrite {
  readonly x: number;
  readonly y: number;
  readonly alive: 0 | 1;
}

export interface CreatureOptions {
  readonly rng: Rng;
  /** Canvas size in CSS pixels. */
  readonly viewport: { readonly width: number; readonly height: number };
  /** Substrate dimensions, for converting position to grid coordinates. */
  readonly grid: { readonly width: number; readonly height: number };
  /** Restored from the personal layer. Defaults to 0.1. */
  readonly trust?: number;
}

/**
 * Everything needed for continuity across a page load. Plain JSON — it goes into
 * `localStorage`, which means a user can edit it, so `restore` validates rather
 * than trusts.
 *
 * Position is stored normalised because the window it is restored into is very
 * often not the window it was saved from.
 */
export interface CreatureSave {
  /** Save format version. Bump when a field changes meaning. */
  readonly v: number;
  /** 0..1. */
  readonly trust: number;
  readonly state: CreatureState;
  /** Position as a fraction of the viewport, 0..1. */
  readonly nx: number;
  readonly ny: number;
  /** Radians. */
  readonly heading: number;
  readonly embedded: boolean;
  /**
   * The `Rng` counter at save time. Counter-based generators checkpoint to one
   * integer (see `src/engine/prng.ts`), so restoring it resumes the exact stream
   * rather than restarting it — two reloads do not replay the same wander.
   */
  readonly rngCounter: number;
}

export const CREATURE_SAVE_VERSION = 1;

/**
 * Every threshold, in one place, because these will be tuned.
 *
 * **These numbers are a starting point.** They come from the brief and from
 * arithmetic, not from watching the thing move, and behaviour tuning is not a
 * problem anyone has ever solved on paper. Expect to change most of them once
 * there is something on screen — particularly `trustGain`, which as specified
 * takes a still cursor from a stranger to `bold` in about twenty-three seconds,
 * and the wander speeds, which read completely differently at 60 fps than they
 * do in a test harness.
 *
 * Units: distances in CSS pixels, speeds in px/s, times in ms, angles in
 * radians, radii on the `*Cell*` constants in grid cells.
 */
export const CREATURE_TUNING = {
  // --- Trust -------------------------------------------------------------
  /** A fresh visitor. Enough to be watched, not enough to be touched. */
  defaultTrust: 0.1,
  /** Gained per continuous window of a still cursor held nearby. */
  trustGain: 0.06,
  trustWindowMs: 2_000,
  /** Cursor speed under which the cursor counts as "still". */
  stillnessSpeed: 40,
  /** Lost on every startle. Roughly six windows of stillness, undone instantly. */
  startleTrustLoss: 0.35,
  /** Lost per window of no interaction within a session. */
  idleTrustDecay: 0.02,
  idleTrustWindowMs: 60_000,

  // --- Trust gates -------------------------------------------------------
  /** Below this it never embeds: pure spectator, and nothing it does marks. */
  spectatorTrust: 0.2,
  /** Above this it writes on purpose — trails, and meddling while unobserved. */
  trailTrust: 0.5,
  /** Above this it follows, and the visitor is allowed to write. */
  boldTrust: 0.8,

  // --- Distances ---------------------------------------------------------
  awarenessRadius: 400,
  personalSpace: 120,
  /** Standoff below `spectatorTrust`. It will not come closer than this. */
  spectatorStandoff: 200,
  /** Standoff above `trailTrust`. Close enough to read as "at" the cursor. */
  contactDistance: 48,
  /** Standoff above `boldTrust`, while following. */
  followDistance: 24,
  /** Below this the creature considers itself arrived. Stops jitter at rest. */
  arriveEpsilon: 6,
  /** Keeps it off the edges of the canvas. */
  edgeMargin: 24,
  /** Range past `awarenessRadius` before it stops caring. Pure hysteresis. */
  loseInterestFactor: 1.15,
  /** `bold` gives up on a distant cursor later than the other states do. */
  boldRangeFactor: 1.8,

  // --- Speeds ------------------------------------------------------------
  /** Reference: a casual mouse move is 200-600 px/s, a flick 2,000-4,000. */
  startleSpeed: 1_400,
  startleRadius: 220,
  /**
   * Startle threshold scale across the trust range, piecewise linear with a
   * knot at `trailTrust` where it is exactly 1. So `startleSpeed` is the
   * literal threshold at trust 0.5, a nervous creature spooks at under half a
   * flick, and a bold one takes a deliberate one.
   */
  startleScaleAtZeroTrust: 0.6,
  startleScaleAtFullTrust: 1.6,
  approachSpeed: 35,
  /** `curious` only edges in. Committing to the approach is a state change. */
  curiousSpeedFactor: 0.4,
  followSpeed: 220,
  /** Backing off when the cursor is inside its standoff. Faster than approach. */
  retreatSpeed: 90,
  /**
   * Cursor speed that makes an approaching creature think again, scaled by
   * trust. At 0.2 it takes 360 px/s — barely a real movement — and at 0.8 it
   * takes 720. This is what "flees easily" means below 0.5.
   */
  flinchSpeed: 600,
  /** Cursor speed that pulls it out of `dormant`. It notices you moving. */
  noticeSpeed: 60,
  /** Multiple of `stillnessSpeed` that breaks `curious` back to `aware`. */
  spookFactor: 3,
  fleeSpeed: 900,
  fleeBurstMs: 250,
  /** Seconds for the post-burst drag to bleed off the flee velocity. */
  fleeDecayTau: 0.55,
  /** Speed under which a fled creature counts as recovered. */
  recoverSpeed: 40,
  /** Randomised deflection on the flee heading, so escapes are never identical. */
  fleeSpreadRad: 1.2,
  /**
   * Distance from an edge at which the escape direction is folded back into the
   * canvas. Roughly how far the burst carries it. Without this a creature
   * startled in a corner flees into the wall and vibrates there, which reads as
   * a bug rather than as fear; with it, a cornered one darts along the edge or
   * straight past the cursor, which is what a cornered animal does.
   */
  fleeWallAvoid: 140,
  /** Seconds for velocity to converge on its target. Gives it mass. */
  velocityTau: 0.18,

  // --- Timings -----------------------------------------------------------
  /** Stillness that makes it curious. */
  stillnessTriggerMs: 900,
  /** Hesitation before it commits to closing the distance, or thinks better. */
  commitMsMin: 300,
  commitMsSpan: 900,
  /** Chance of committing, at trust 0. Add `commitChanceTrust * trust`. */
  commitChanceBase: 0.35,
  commitChanceTrust: 0.55,
  /**
   * A still cursor stops being interesting after this and it goes back to its
   * own business. Also the cap on trust gained in one sitting: gain requires
   * attention, so twenty seconds of stillness is worth +0.6 and no more.
   */
  boredomMs: 20_000,
  /** `bold` tolerates a motionless visitor for longer before wandering off. */
  boldBoredomFactor: 2,
  /** Refusal to re-engage after a fright. */
  waryMsMin: 3_000,
  waryMsSpan: 3_000,
  /**
   * Frame clamp. A backgrounded tab returns with a `dtMs` in the tens of
   * seconds; integrating that once teleports the creature across the screen and
   * fires every timer at the same instant. Callers get simulated time, not
   * wall-clock time, and the difference is only visible after a tab switch.
   */
  maxFrameMs: 100,

  // --- Wandering ---------------------------------------------------------
  wanderSpeed: 70,
  wanderMinDist: 120,
  wanderSpanDist: 260,
  /** Upper bound on how long it will pursue one wander target. */
  wanderRetargetMs: 4_000,
  /** Chance of pausing on arrival at a wander target. */
  restChance: 0.25,
  restMsMin: 200,
  restMsSpan: 600,

  // --- Substrate contact -------------------------------------------------
  /** Settling time before it counts as inside the automaton. Kills flicker. */
  embedDelayMs: 500,
  /** Fraction of newly entered cells the trail actually marks. Thin on purpose. */
  trailDensity: 0.7,
  /** Grid radius of the hole a startle tears in the world. */
  startleClearRadius: 3,
  startleClearDensity: 0.85,
  /** Unobserved meddling: a small cluster of live cells, now and then. */
  meddleMsMin: 2_500,
  meddleMsSpan: 3_500,
  meddleCellsMin: 3,
  meddleCellsSpan: 4,
  meddleRadius: 2,
  /**
   * Backstop for a caller that stops draining. Bounded because `update` runs
   * every frame forever and an undrained queue is otherwise a slow leak.
   */
  maxQueuedWrites: 512,
} as const;

const T = CREATURE_TUNING;

const TAU = Math.PI * 2;

const STATES: ReadonlySet<CreatureState> = new Set<CreatureState>([
  'dormant',
  'aware',
  'curious',
  'approaching',
  'startled',
  'bold',
]);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Non-negative modulo. The substrate is toroidal, so out-of-range is not an error. */
function wrap(v: number, n: number): number {
  const m = v % n;
  return m < 0 ? m + n : m;
}

function len(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Falls back to `fallback` for NaN, Infinity and anything localStorage invented. */
function finite(v: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class Creature {
  private readonly rng: Rng;
  private readonly gridW: number;
  private readonly gridH: number;
  private vw: number;
  private vh: number;

  private posX: number;
  private posY: number;
  private velX = 0;
  private velY = 0;
  private headingR = 0;
  private trustV: number;
  private stateV: CreatureState = 'dormant';
  private embeddedV = false;

  // Pointer tracking. `lastPointer*` is null whenever the pointer is absent, so
  // a cursor re-entering the window never reads as a several-hundred-px flick.
  private lastPointerX: number | null = null;
  private lastPointerY: number | null = null;
  private pointerSpeed = 0;
  /**
   * Continuous stillness of the pointer itself. Reset only by the visitor
   * moving or leaving — never by the creature's own deliberation, or a creature
   * that keeps changing its mind would never get bored.
   */
  private pointerStillMs = 0;
  /** Continuous stillness *while attending*, which is what earns trust. */
  private attendedStillMs = 0;
  /** Cooldown after thinking better of an approach, before it may try again. */
  private reconsiderMs = 0;

  // Timers.
  private fleeMs = 0;
  private waryMs = 0;
  private commitMs = 0;
  private embedMs = 0;
  private meddleMs: number;
  private restMs = 0;
  private retargetMs = 0;
  private wanderX = 0;
  private wanderY = 0;
  /** Scratch for `wanderVelocity`, so the wander path allocates nothing. */
  private wanderVX = 0;
  private wanderVY = 0;

  /**
   * Pending writes as three parallel number arrays plus a count.
   *
   * `update` runs every frame; allocating a `SubstrateWrite` object per marked
   * cell would produce garbage forever. The arrays only ever grow, indices are
   * assigned rather than pushed once they have, and objects are materialised
   * exactly once, in `drainWrites`, where an allocation is already unavoidable.
   */
  private readonly wX: number[] = [];
  private readonly wY: number[] = [];
  private readonly wA: number[] = [];
  private wCount = 0;
  private lastCellX = -1;
  private lastCellY = -1;

  constructor(options: CreatureOptions) {
    this.rng = options.rng;
    this.gridW = Math.max(1, Math.floor(options.grid.width));
    this.gridH = Math.max(1, Math.floor(options.grid.height));
    this.vw = Math.max(1, options.viewport.width);
    this.vh = Math.max(1, options.viewport.height);
    this.trustV = clamp(finite(options.trust ?? T.defaultTrust, T.defaultTrust), 0, 1);

    // Somewhere in the room, not the middle of it. A creature that is always at
    // the centre on load reads as a widget.
    const m = this.margin();
    this.posX = m + this.rng.float() * Math.max(1, this.vw - m * 2);
    this.posY = m + this.rng.float() * Math.max(1, this.vh - m * 2);
    this.headingR = this.rng.float() * TAU;
    this.meddleMs = T.meddleMsMin + this.rng.int(T.meddleMsSpan);
    this.pickWanderTarget();
  }

  /** Position in CSS pixels. */
  get x(): number {
    return this.posX;
  }

  get y(): number {
    return this.posY;
  }

  get state(): CreatureState {
    return this.stateV;
  }

  /** 0..1. */
  get trust(): number {
    return this.trustV;
  }

  /** Facing direction in radians, for whoever draws it. */
  get heading(): number {
    return this.headingR;
  }

  /** True while inside the automaton (grid-bound, pixelated). */
  get embedded(): boolean {
    return this.embeddedV;
  }

  update(input: CreatureInput): void {
    const dt = clamp(finite(input.dtMs, 0), 0, T.maxFrameMs);
    if (dt <= 0) return;
    const dts = dt / 1000;

    const ptrX = input.pointerX;
    const ptrY = input.pointerY;
    const hasPointer = ptrX !== null && ptrY !== null;

    // --- Pointer velocity -------------------------------------------------
    // Instantaneous, not smoothed. A flick is one or two frames long and any
    // averaging window wide enough to be stable is wide enough to swallow it.
    if (hasPointer) {
      if (this.lastPointerX !== null && this.lastPointerY !== null) {
        this.pointerSpeed = len(ptrX - this.lastPointerX, ptrY - this.lastPointerY) / dts;
      } else {
        this.pointerSpeed = 0;
      }
      this.lastPointerX = ptrX;
      this.lastPointerY = ptrY;
    } else {
      this.pointerSpeed = 0;
      this.lastPointerX = null;
      this.lastPointerY = null;
    }

    let dx = 0;
    let dy = 0;
    let dist = Infinity;
    if (hasPointer) {
      dx = ptrX - this.posX;
      dy = ptrY - this.posY;
      dist = len(dx, dy);
    }

    if (hasPointer && this.pointerSpeed < T.stillnessSpeed) this.pointerStillMs += dt;
    else this.pointerStillMs = 0;

    // --- Fright comes before thought -------------------------------------
    if (
      hasPointer &&
      this.stateV !== 'startled' &&
      dist < T.startleRadius &&
      this.pointerSpeed > this.startleThreshold()
    ) {
      this.startle(dx, dy);
    } else {
      this.transition(dt, hasPointer, dist);
    }

    this.accrueTrust(dt, hasPointer, dist);
    this.steer(dts, hasPointer, dx, dy, dist);
    this.updateEmbedding(dt);
    this.emitWrites(dt);
  }

  /** Substrate edits since the last call. Empties the queue. */
  drainWrites(): SubstrateWrite[] {
    const out: SubstrateWrite[] = [];
    for (let i = 0; i < this.wCount; i++) {
      out.push({ x: this.wX[i]!, y: this.wY[i]!, alive: this.wA[i] === 1 ? 1 : 0 });
    }
    this.wCount = 0;
    return out;
  }

  resize(viewport: { width: number; height: number }): void {
    const nx = this.posX / this.vw;
    const ny = this.posY / this.vh;
    this.vw = Math.max(1, viewport.width);
    this.vh = Math.max(1, viewport.height);
    const m = this.margin();
    this.posX = clamp(nx * this.vw, m, this.vw - m);
    this.posY = clamp(ny * this.vh, m, this.vh - m);
    this.pickWanderTarget();
    // The px-to-cell mapping just changed under it; the old cell means nothing.
    this.lastCellX = -1;
    this.lastCellY = -1;
  }

  serialize(): CreatureSave {
    return {
      v: CREATURE_SAVE_VERSION,
      trust: this.trustV,
      state: this.stateV,
      nx: this.posX / this.vw,
      ny: this.posY / this.vh,
      heading: this.headingR,
      embedded: this.embeddedV,
      rngCounter: this.rng.counter,
    };
  }

  /**
   * Rebuild from a save. Never throws on a malformed one — a corrupt entry in
   * `localStorage` should cost the visitor their history, not the page.
   *
   * `options.trust` is ignored when the save carries one; the save is the more
   * specific statement about this particular relationship.
   */
  static restore(save: CreatureSave, options: CreatureOptions): Creature {
    const c = new Creature(options);
    if (!save || typeof save !== 'object') return c;

    c.trustV = clamp(finite(save.trust, T.defaultTrust), 0, 1);
    c.stateV = STATES.has(save.state) ? save.state : 'dormant';
    const m = c.margin();
    c.posX = clamp(finite(save.nx, 0.5) * c.vw, m, c.vw - m);
    c.posY = clamp(finite(save.ny, 0.5) * c.vh, m, c.vh - m);
    c.headingR = finite(save.heading, 0);
    c.embeddedV = save.embedded === true && c.trustV >= T.spectatorTrust;
    c.embedMs = c.embeddedV ? T.embedDelayMs : 0;
    c.pickWanderTarget();

    // Resume the stream where it left off. The constructor consumed a handful
    // of draws laying out a creature we have just overwritten; rewinding past
    // them is free and is the whole reason the counter is public.
    const counter = finite(save.rngCounter, options.rng.counter);
    options.rng.counter = counter | 0;
    return c;
  }

  // -- internals ----------------------------------------------------------

  private margin(): number {
    return Math.min(T.edgeMargin, this.vw * 0.25, this.vh * 0.25);
  }

  /**
   * Startle threshold for the current trust, piecewise linear through
   * (0, 0.6), (`trailTrust`, 1.0), (1, 1.6) times `startleSpeed`.
   *
   * The knot is at `trailTrust` so the specified 1,400 px/s is the literal
   * threshold there and an *under*-estimate everywhere below it: anything that
   * startles a trusting creature startles a wary one.
   */
  private startleThreshold(): number {
    const t = this.trustV;
    const scale =
      t <= T.trailTrust
        ? T.startleScaleAtZeroTrust +
          ((1 - T.startleScaleAtZeroTrust) * t) / T.trailTrust
        : 1 +
          ((T.startleScaleAtFullTrust - 1) * (t - T.trailTrust)) / (1 - T.trailTrust);
    return T.startleSpeed * scale;
  }

  /** How close it is prepared to get, given how it feels about the visitor. */
  private standoff(): number {
    const t = this.trustV;
    if (t < T.spectatorTrust) return T.spectatorStandoff;
    if (t <= T.trailTrust) return T.personalSpace;
    if (t <= T.boldTrust) return T.contactDistance;
    return T.followDistance;
  }

  private startle(dx: number, dy: number): void {
    // The hole comes first: it is torn where the creature was standing, and it
    // can only be torn if the creature was in the world to begin with. Below
    // `spectatorTrust` it never embeds, so a spectator's panic leaves nothing.
    if (this.embeddedV) this.clearBurst();

    this.embeddedV = false;
    this.embedMs = 0;
    this.trustV = clamp(this.trustV - T.startleTrustLoss, 0, 1);
    this.stateV = 'startled';
    this.fleeMs = T.fleeBurstMs;
    this.waryMs = T.waryMsMin + this.rng.int(T.waryMsSpan);
    this.attendedStillMs = 0;

    // Directly away from the pointer, then folded off any wall it would run
    // straight into. Escaping into open space matters more than the exact
    // bearing — being cornered is what turns a flee into a twitch.
    const spread = (this.rng.float() - 0.5) * T.fleeSpreadRad;
    const raw = Math.atan2(-dy, -dx) + spread;
    let ax = Math.cos(raw);
    let ay = Math.sin(raw);
    // Folded last, after the random deflection, so the deflection can never put
    // it back into the wall it was just steered away from.
    const m = this.margin() + T.fleeWallAvoid;
    if ((this.posX < m && ax < 0) || (this.posX > this.vw - m && ax > 0)) ax = -ax;
    if ((this.posY < m && ay < 0) || (this.posY > this.vh - m && ay > 0)) ay = -ay;

    const away = Math.atan2(ay, ax);
    this.headingR = away;
    this.velX = Math.cos(away) * T.fleeSpeed;
    this.velY = Math.sin(away) * T.fleeSpeed;
  }

  private transition(dt: number, hasPointer: boolean, dist: number): void {
    if (this.waryMs > 0) this.waryMs -= dt;
    if (this.reconsiderMs > 0) this.reconsiderMs -= dt;
    const inRange = hasPointer && dist <= T.awarenessRadius * T.loseInterestFactor;

    switch (this.stateV) {
      case 'startled': {
        this.fleeMs -= dt;
        if (this.fleeMs <= 0 && len(this.velX, this.velY) < T.recoverSpeed) {
          this.toDormant();
        }
        break;
      }

      case 'dormant': {
        // "When they return it notices." Presence alone is not enough — a
        // cursor parked on the page while nobody is at the desk is scenery.
        if (
          hasPointer &&
          dist < T.awarenessRadius &&
          this.waryMs <= 0 &&
          this.pointerSpeed > T.noticeSpeed
        ) {
          this.stateV = this.trustV > T.boldTrust ? 'bold' : 'aware';
          this.pointerStillMs = 0;
        }
        break;
      }

      case 'aware': {
        if (!inRange) this.toDormant();
        else if (this.trustV > T.boldTrust) this.stateV = 'bold';
        else if (this.pointerStillMs >= T.boredomMs) this.toDormant();
        else if (this.pointerStillMs >= T.stillnessTriggerMs && this.reconsiderMs <= 0) {
          this.stateV = 'curious';
          this.commitMs = T.commitMsMin + this.rng.int(T.commitMsSpan);
        }
        break;
      }

      case 'curious': {
        if (!inRange) this.toDormant();
        else if (this.trustV > T.boldTrust) this.stateV = 'bold';
        else if (this.pointerStillMs >= T.boredomMs) this.toDormant();
        else if (this.pointerSpeed > T.stillnessSpeed * T.spookFactor) this.stateV = 'aware';
        else {
          this.commitMs -= dt;
          if (this.commitMs <= 0) {
            // It makes up its own mind, and a wary creature usually thinks
            // better of it. Failing to commit drops back to `aware` and arms a
            // cooldown, so it hesitates repeatedly rather than deciding once
            // and being done — but the boredom clock keeps running underneath.
            const chance = T.commitChanceBase + this.trustV * T.commitChanceTrust;
            if (this.rng.float() < chance) {
              this.stateV = 'approaching';
            } else {
              this.stateV = 'aware';
              this.reconsiderMs = T.stillnessTriggerMs + this.rng.int(T.commitMsSpan);
            }
          }
        }
        break;
      }

      case 'approaching': {
        if (!inRange) this.toDormant();
        else if (this.trustV > T.boldTrust) this.stateV = 'bold';
        else if (this.pointerStillMs >= T.boredomMs) this.toDormant();
        else if (this.pointerSpeed > T.flinchSpeed * (0.4 + this.trustV)) this.stateV = 'aware';
        break;
      }

      case 'bold': {
        if (!hasPointer || dist > T.awarenessRadius * T.boldRangeFactor) this.toDormant();
        else if (this.trustV <= T.boldTrust) this.stateV = 'approaching';
        else if (this.pointerStillMs >= T.boredomMs * T.boldBoredomFactor) this.toDormant();
        break;
      }
    }
  }

  private toDormant(): void {
    this.stateV = 'dormant';
    this.pointerStillMs = 0;
    this.attendedStillMs = 0;
    this.reconsiderMs = 0;
    this.pickWanderTarget();
  }

  /**
   * Trust only moves while the creature is *attending* to the visitor.
   *
   * This is what stops a cursor left on the page overnight from maxing it out,
   * and it is why `boredomMs` doubles as the per-sitting cap: twenty seconds of
   * stillness is worth ten windows and then it wanders off and stops counting.
   * Coming back on another day is the only route to `bold`.
   */
  private accrueTrust(dt: number, hasPointer: boolean, dist: number): void {
    const attending =
      hasPointer &&
      dist < T.awarenessRadius &&
      this.stateV !== 'dormant' &&
      this.stateV !== 'startled';

    if (attending && this.pointerSpeed < T.stillnessSpeed) {
      this.attendedStillMs += dt;
      while (this.attendedStillMs >= T.trustWindowMs) {
        this.attendedStillMs -= T.trustWindowMs;
        this.trustV = clamp(this.trustV + T.trustGain, 0, 1);
      }
    } else {
      this.attendedStillMs = 0;
    }

    if (!attending) {
      this.trustV = clamp(this.trustV - (T.idleTrustDecay * dt) / T.idleTrustWindowMs, 0, 1);
    }
  }

  private steer(dts: number, hasPointer: boolean, dx: number, dy: number, dist: number): void {
    if (this.stateV === 'startled') {
      // Ballistic: a full-speed burst, then drag. Nothing steers it, which is
      // exactly how panic should read next to the deliberate states.
      if (this.fleeMs <= 0) {
        const drag = Math.max(0, 1 - dts / T.fleeDecayTau);
        this.velX *= drag;
        this.velY *= drag;
      }
      this.posX += this.velX * dts;
      this.posY += this.velY * dts;
      if (len(this.velX, this.velY) > 1) this.headingR = Math.atan2(this.velY, this.velX);
      this.containBouncing();
      return;
    }

    let targetVX = 0;
    let targetVY = 0;
    let face = this.headingR;

    if (this.stateV === 'dormant' || !hasPointer) {
      if (this.wanderVelocity(dts)) {
        targetVX = this.wanderVX;
        targetVY = this.wanderVY;
        face = Math.atan2(targetVY, targetVX);
      }
    } else {
      // It looks at the visitor in every attending state, including while
      // backing away from one. Turning its back would read as a pet ignoring
      // you; keeping the stare is the Migi note.
      face = Math.atan2(dy, dx);

      const want = this.standoff();
      const err = dist - want;
      if (Math.abs(err) > T.arriveEpsilon && dist > 0) {
        const approach =
          this.stateV === 'bold'
            ? T.followSpeed
            : this.stateV === 'approaching'
              ? T.approachSpeed
              : this.stateV === 'curious'
                ? T.approachSpeed * T.curiousSpeedFactor
                : 0; // `aware` holds station and does not close in
        const speed = err > 0 ? approach : T.retreatSpeed;
        const sign = err > 0 ? 1 : -1;
        targetVX = (dx / dist) * speed * sign;
        targetVY = (dy / dist) * speed * sign;
      }
    }

    const k = Math.min(1, dts / T.velocityTau);
    this.velX += (targetVX - this.velX) * k;
    this.velY += (targetVY - this.velY) * k;
    this.posX += this.velX * dts;
    this.posY += this.velY * dts;
    this.headingR = face;
    this.contain();
  }

  /**
   * Wander toward the current target, pausing on arrival often enough that it
   * does not read as patrolling. Writes to `wanderV*` and returns whether it is
   * moving, rather than returning a vector — `update` runs every frame and this
   * is the only value it would ever have allocated.
   */
  private wanderVelocity(dts: number): boolean {
    const dtMs = dts * 1000;
    this.wanderVX = 0;
    this.wanderVY = 0;
    if (this.restMs > 0) {
      this.restMs -= dtMs;
      return false;
    }

    this.retargetMs -= dtMs;
    const dx = this.wanderX - this.posX;
    const dy = this.wanderY - this.posY;
    const d = len(dx, dy);
    if (d < T.arriveEpsilon || this.retargetMs <= 0) {
      this.pickWanderTarget();
      if (this.rng.float() < T.restChance) {
        this.restMs = T.restMsMin + this.rng.int(T.restMsSpan);
      }
      return false;
    }

    this.wanderVX = (dx / d) * T.wanderSpeed;
    this.wanderVY = (dy / d) * T.wanderSpeed;
    return true;
  }

  private pickWanderTarget(): void {
    const angle = this.rng.float() * TAU;
    const radius = T.wanderMinDist + this.rng.float() * T.wanderSpanDist;
    const m = this.margin();
    this.wanderX = clamp(this.posX + Math.cos(angle) * radius, m, this.vw - m);
    this.wanderY = clamp(this.posY + Math.sin(angle) * radius, m, this.vh - m);
    this.retargetMs = T.wanderRetargetMs;
    this.wanderVX = 0;
    this.wanderVY = 0;
  }

  private contain(): void {
    const m = this.margin();
    this.posX = clamp(this.posX, m, this.vw - m);
    this.posY = clamp(this.posY, m, this.vh - m);
  }

  /** Fleeing at 900 px/s would leave the canvas in a fifth of a second. */
  private containBouncing(): void {
    const m = this.margin();
    if (this.posX < m) {
      this.posX = m;
      this.velX = Math.abs(this.velX);
    } else if (this.posX > this.vw - m) {
      this.posX = this.vw - m;
      this.velX = -Math.abs(this.velX);
    }
    if (this.posY < m) {
      this.posY = m;
      this.velY = Math.abs(this.velY);
    } else if (this.posY > this.vh - m) {
      this.posY = this.vh - m;
      this.velY = -Math.abs(this.velY);
    }
  }

  /**
   * Embedding is the physical form of the trust gate.
   *
   * Below `spectatorTrust` it never enters the automaton at all, which is what
   * makes "pure spectator, writes nothing" a property of the model rather than
   * a check bolted onto every write site. Above it, it sinks into the grid when
   * it is going about its own business, and it stays sunk near a visitor only
   * once it is comfortable enough to write. Panic ejects it instantly.
   */
  private wantsEmbedded(): boolean {
    if (this.trustV < T.spectatorTrust) return false;
    if (this.stateV === 'startled') return false;
    if (this.stateV === 'dormant') return true;
    return this.trustV > T.trailTrust;
  }

  private updateEmbedding(dt: number): void {
    if (this.wantsEmbedded()) {
      this.embedMs += dt;
      if (this.embedMs >= T.embedDelayMs) this.embeddedV = true;
    } else {
      this.embedMs = 0;
      this.embeddedV = false;
    }
  }

  private cellX(): number {
    return wrap(Math.floor((this.posX / this.vw) * this.gridW), this.gridW);
  }

  private cellY(): number {
    return wrap(Math.floor((this.posY / this.vh) * this.gridH), this.gridH);
  }

  private emitWrites(dt: number): void {
    if (!this.embeddedV) {
      // Out of the world; the next cell it enters is a fresh start for the trail.
      this.lastCellX = -1;
      this.lastCellY = -1;
      return;
    }

    const cx = this.cellX();
    const cy = this.cellY();
    const entered = cx !== this.lastCellX || cy !== this.lastCellY;
    this.lastCellX = cx;
    this.lastCellY = cy;

    // Deliberate marks only. Below this it is in the world but does not alter it.
    if (this.trustV <= T.trailTrust) return;

    if (entered && this.rng.float() < T.trailDensity) this.push(cx, cy, 1);

    // Unobserved, it has its own plans for the automaton.
    if (this.stateV === 'dormant') {
      this.meddleMs -= dt;
      if (this.meddleMs <= 0) {
        this.meddle(cx, cy);
        this.meddleMs = T.meddleMsMin + this.rng.int(T.meddleMsSpan);
      }
    }
  }

  private meddle(cx: number, cy: number): void {
    const n = T.meddleCellsMin + this.rng.int(T.meddleCellsSpan);
    const span = T.meddleRadius * 2 + 1;
    for (let i = 0; i < n; i++) {
      this.push(cx + this.rng.int(span) - T.meddleRadius, cy + this.rng.int(span) - T.meddleRadius, 1);
    }
  }

  /**
   * The scar. Cells go out in a disc around where it was standing, thinned so
   * the edge is ragged rather than a stamped circle. Nothing heals it here —
   * the automaton grows back over it on its own, at its own speed, which is
   * what leaves the visitor's behaviour readable in the terrain minutes later.
   */
  private clearBurst(): void {
    const cx = this.cellX();
    const cy = this.cellY();
    const r = T.startleClearRadius;
    this.push(cx, cy, 0);
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (ox * ox + oy * oy > r * r) continue;
        if (this.rng.float() > T.startleClearDensity) continue;
        this.push(cx + ox, cy + oy, 0);
      }
    }
  }

  private push(x: number, y: number, alive: 0 | 1): void {
    if (this.wCount >= T.maxQueuedWrites) return;
    const i = this.wCount;
    this.wX[i] = wrap(x, this.gridW);
    this.wY[i] = wrap(y, this.gridH);
    this.wA[i] = alive;
    this.wCount = i + 1;
  }
}
