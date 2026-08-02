/**
 * Surface energy field: a fast, session-only layer that sits on top of the
 * substrate and makes its once-a-minute tick feel continuous.
 *
 * The substrate (`src/engine`) only has a meaningful new frame once every
 * simulated minute. Nothing renders in between unless something fills the
 * gap. This field is that something: substrate transitions inject energy
 * here, and it diffuses, drifts and decays at animation rate so the screen is
 * never frozen, even though the world underneath genuinely isn't moving.
 *
 * Ephemeral by design. It is never checkpointed, never fast-forwarded, and
 * carries no part of the shared deterministic world — restart the tab and it
 * simply starts cold again, which is exactly right for something whose whole
 * job is to smooth over a gap in real time. That is also why this lives
 * outside `src/engine` and is free to use floating point and transcendental
 * maths: nothing here has to reproduce bit-for-bit across browsers, because
 * nothing here is shared between visitors or ever fed back into the world.
 */

import { unpack } from '../engine/substrate.ts';
import type { GridSpec } from '../engine/substrate.ts';

export interface SurfaceOptions {
  readonly spec: GridSpec;
  /** Energy half-life in ms. Default 26_000. */
  readonly halfLifeMs?: number;
  /** Diffusion rate, 0..1 per fixed step. Default 0.16. */
  readonly diffusion?: number;
  /** Constant drift in cells per second. Default { x: 0.35, y: -0.12 }. */
  readonly drift?: { readonly x: number; readonly y: number };
}

/**
 * Injected energy for a birth vs. a death. Births read as more eventful than
 * deaths — a cell switching on is the thing the eye follows — so they get
 * roughly double the energy. Tune by ear; nothing downstream depends on the
 * ratio being exactly this.
 */
const BIRTH_ENERGY = 1.0;
const DEATH_ENERGY = 0.55;

/**
 * `advance` is fed real `requestAnimationFrame` deltas, which are noisy and
 * occasionally huge (a backgrounded tab can hand back several seconds in one
 * callback). Simulating on a fixed internal step keeps diffusion and decay
 * independent of frame rate — the field looks the same whether the browser
 * is running at 60Hz or 30Hz, only the number of internal steps per call
 * changes.
 */
const FIXED_STEP_MS = 16.667;

/**
 * Upper bound on internal steps run inside one `advance` call. Without this,
 * the multi-second delta from a backgrounded tab would turn into hundreds of
 * catch-up steps on the frame that's supposed to resume smoothly — trading
 * one stall (the background time, which nobody saw) for a worse one (the main
 * thread hanging on resume, which everybody sees).
 *
 * Measured at 192x120: one fixed step costs 0.45 ms, so a clamp of 30 costs
 * 14 ms — a dropped frame at precisely the moment someone is looking at a tab
 * that just woke up. And it buys nothing. Thirty steps is half a second of
 * simulated time against a 26-second half-life, which is a change of roughly
 * one percent; the resumed field is indistinguishable either way. Eight steps
 * costs 3.6 ms, comfortably inside a frame, and looks the same.
 */
const MAX_CATCHUP_STEPS = 8;

/** Wrap an already-integer index onto [0, n). `%` alone leaves negatives negative. */
function wrapIndex(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

export class SurfaceField {
  readonly spec: GridSpec;

  private readonly diffusion: number;
  private readonly decayPerStep: number;
  private readonly driftStepX: number;
  private readonly driftStepY: number;

  /**
   * `cur` is the field as the public API sees it: `energy` always returns
   * this exact array, and both injection methods write straight into it, so
   * a caller holding the reference sees every update in place. `scratch` is
   * pure workspace for the diffusion half of a fixed step and is never
   * observed from outside. Both are allocated once here and reused for the
   * life of the instance — `advance` and `injectTransition` run every frame
   * and must not allocate.
   */
  private readonly cur: Float32Array;
  private readonly scratch: Float32Array;

  /** Reusable unpack targets for `injectTransition`, for the same reason. */
  private readonly prevUnpacked: Uint8Array;
  private readonly curUnpacked: Uint8Array;

  private accumulatorMs: number;
  private peakValue: number;

  constructor(options: SurfaceOptions) {
    this.spec = options.spec;
    const halfLifeMs = options.halfLifeMs ?? 26_000;
    this.diffusion = options.diffusion ?? 0.16;
    const drift = options.drift ?? { x: 0.35, y: -0.12 };

    // Both are per-fixed-step constants, so it's cheaper to fold in the step
    // size once here than to redo it every step.
    this.decayPerStep = Math.pow(0.5, FIXED_STEP_MS / halfLifeMs);
    this.driftStepX = (drift.x * FIXED_STEP_MS) / 1000;
    this.driftStepY = (drift.y * FIXED_STEP_MS) / 1000;

    const cells = this.spec.width * this.spec.height;
    this.cur = new Float32Array(cells);
    this.scratch = new Float32Array(cells);
    this.prevUnpacked = new Uint8Array(cells);
    this.curUnpacked = new Uint8Array(cells);

    this.accumulatorMs = 0;
    this.peakValue = 0;
  }

  /** Row-major, width*height. Treat as read-only. */
  get energy(): Float32Array {
    return this.cur;
  }

  /** Largest current value, for normalising a render. */
  get peak(): number {
    return this.peakValue;
  }

  /**
   * Call once per substrate step, with the two generations.
   *
   * Unpacks both grids into reusable byte buffers rather than calling the
   * bit-packed accessors cell by cell — `unpack` already exists for this and
   * is a tight loop, so there is no reason to re-derive it here.
   */
  injectTransition(prev: Uint32Array, cur: Uint32Array): void {
    unpack(prev, this.spec, this.prevUnpacked);
    unpack(cur, this.spec, this.curUnpacked);

    const cells = this.spec.width * this.spec.height;
    for (let i = 0; i < cells; i++) {
      const was = this.prevUnpacked[i]!;
      const is = this.curUnpacked[i]!;
      if (was === is) continue;
      const amount = is === 1 ? BIRTH_ENERGY : DEATH_ENERGY;
      this.cur[i] = this.cur[i]! + amount;
      // Compare the value actually stored, not the float64 we computed it
      // from — `cur` is a Float32Array, so the two can differ in the last
      // bit, and `peak` promising to track "the actual maximum" means the
      // maximum of what's really in the array.
      const stored = this.cur[i]!;
      if (stored > this.peakValue) this.peakValue = stored;
    }
  }

  /** Point impulse in GRID coordinates. Used by the creature later. */
  injectPoint(x: number, y: number, amount: number): void {
    const xi = wrapIndex(Math.floor(x), this.spec.width);
    const yi = wrapIndex(Math.floor(y), this.spec.height);
    const i = yi * this.spec.width + xi;
    this.cur[i] = this.cur[i]! + amount;
    const stored = this.cur[i]!;
    if (stored > this.peakValue) this.peakValue = stored;
  }

  /** Advance by wall-clock milliseconds. */
  advance(dtMs: number): void {
    this.accumulatorMs += dtMs;
    let steps = Math.floor(this.accumulatorMs / FIXED_STEP_MS);
    if (steps <= 0) return;

    if (steps > MAX_CATCHUP_STEPS) {
      // Drop the remainder rather than leaving it in the accumulator. If we
      // kept it, a tab backgrounded for a long time would still owe thousands
      // of steps and would keep paying off 30 at a time, frame after frame,
      // until it caught up — a slow-motion version of the exact stall this
      // clamp exists to prevent. Treating the missed time as skipped, not
      // queued, means one clamped call is the whole cost.
      steps = MAX_CATCHUP_STEPS;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= steps * FIXED_STEP_MS;
    }

    for (let s = 0; s < steps; s++) this.fixedStep();
  }

  /**
   * One fixed step: diffuse-and-decay into `scratch`, then drift `scratch`
   * back into `cur`. Two full passes rather than one fused pass — diffusion
   * needs whole-cell neighbours and drift needs a sub-cell resample, and
   * trying to do both in a single gather per cell would mean four bilinear
   * samples (16 reads) instead of one. At 23,040 cells this is still cheap
   * well within a 16.667ms frame budget.
   */
  private fixedStep(): void {
    this.diffuseAndDecay();
    this.driftAndMeasurePeak();
  }

  /**
   * 5-point (von Neumann) diffusion, toroidal on both axes, plus exponential
   * decay. Wrap must match the substrate exactly here: it's also a torus, and
   * a surface that stopped diffusing at the edges would visibly disagree with
   * the world moving underneath it.
   *
   * Center/neighbour weights are chosen so the diffusion term alone conserves
   * total energy exactly (centerWeight + 4*neighbourWeight === 1) — every unit
   * that leaves a cell for a neighbour is accounted for on a torus, nothing
   * created or lost at an edge. Decay is the only thing allowed to shrink the
   * total, which is what makes "total energy strictly decreases with no
   * injection" true by construction rather than by tuning.
   */
  private diffuseAndDecay(): void {
    const { width, height } = this.spec;
    const src = this.cur;
    const dst = this.scratch;
    const centerWeight = 1 - this.diffusion;
    const neighbourWeight = this.diffusion * 0.25;
    const decay = this.decayPerStep;

    for (let y = 0; y < height; y++) {
      const rowUp = (y === 0 ? height - 1 : y - 1) * width;
      const rowMid = y * width;
      const rowDown = (y === height - 1 ? 0 : y + 1) * width;

      for (let x = 0; x < width; x++) {
        const xLeft = x === 0 ? width - 1 : x - 1;
        const xRight = x === width - 1 ? 0 : x + 1;

        const center = src[rowMid + x]!;
        const north = src[rowUp + x]!;
        const south = src[rowDown + x]!;
        const west = src[rowMid + xLeft]!;
        const east = src[rowMid + xRight]!;

        dst[rowMid + x] =
          decay * (centerWeight * center + neighbourWeight * (north + south + west + east));
      }
    }
  }

  /**
   * Constant advection: resample `scratch` at a fractional offset and write
   * the result back into `cur`. Bilinear rather than a whole-cell shift so a
   * slow drift (a fraction of a cell per frame) still moves smoothly instead
   * of jumping in visible one-cell steps; a rigid sub-pixel shift is a
   * circular convolution with weights that sum to 1, so — like the diffusion
   * pass — this doesn't add or remove energy on its own either.
   *
   * This pass also owns `peak`, since it's the last write to `cur` each fixed
   * step and is already touching every cell — recomputing the true max here
   * is free, whereas the injection methods can only ever raise it
   * optimistically until this next runs.
   */
  private driftAndMeasurePeak(): void {
    const { width, height } = this.spec;
    const src = this.scratch;
    const dst = this.cur;
    let maxValue = 0;

    for (let y = 0; y < height; y++) {
      const srcY = y - this.driftStepY;
      for (let x = 0; x < width; x++) {
        const srcX = x - this.driftStepX;
        dst[y * width + x] = this.bilinearSample(src, srcX, srcY);
        // As above: read back the float32-rounded value, so `peak` matches
        // what a caller reading `energy` right after this would actually see.
        const stored = dst[y * width + x]!;
        if (stored > maxValue) maxValue = stored;
      }
    }

    this.peakValue = maxValue;
  }

  /** Bilinear-interpolated read of `buf` at fractional grid coordinates, toroidally wrapped. */
  private bilinearSample(buf: Float32Array, x: number, y: number): number {
    const { width, height } = this.spec;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;

    const xi0 = wrapIndex(x0, width);
    const xi1 = wrapIndex(x0 + 1, width);
    const yi0 = wrapIndex(y0, height);
    const yi1 = wrapIndex(y0 + 1, height);

    const v00 = buf[yi0 * width + xi0]!;
    const v10 = buf[yi0 * width + xi1]!;
    const v01 = buf[yi1 * width + xi0]!;
    const v11 = buf[yi1 * width + xi1]!;

    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }
}
