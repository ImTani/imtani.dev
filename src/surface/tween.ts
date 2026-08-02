/**
 * Per-cell interpolation between substrate generations.
 *
 * The substrate is binary and discrete: a cell is alive or it is not, and it
 * changes once a second. Drawn literally, every cell pops between two states on
 * a hard clock, which reads as a slideshow no matter how fast the clock runs.
 * This holds a continuous 0..1 value per cell that chases the substrate at
 * animation rate, so a birth fades up and a death fades out.
 *
 * Purely presentational. It never feeds back into the world — the substrate is
 * the truth and this is a filter over it, so a browser that renders it
 * differently changes nothing about what anyone else sees.
 *
 * Rise and fall are separate on purpose. Symmetric timing makes the field look
 * like it is breathing in unison; a quick rise against a slower fall reads as
 * something appearing and then leaving a trace, which is closer to how the
 * automaton actually behaves — births are events, deaths are aftermath.
 */

import type { GridSpec } from '../engine/substrate.ts';

export interface TweenOptions {
  readonly spec: GridSpec;
  /** Milliseconds for a dead cell to reach fully alive. Default 300. */
  readonly riseMs?: number;
  /** Milliseconds for a live cell to reach fully dead. Default 700. */
  readonly fallMs?: number;
}

export class CellTween {
  readonly spec: GridSpec;
  private readonly riseRate: number;
  private readonly fallRate: number;
  private readonly level: Float32Array;

  constructor(options: TweenOptions) {
    this.spec = options.spec;
    // Stored as units per millisecond so the per-frame step is one multiply.
    this.riseRate = 1 / (options.riseMs ?? 300);
    this.fallRate = 1 / (options.fallMs ?? 700);
    this.level = new Float32Array(this.spec.width * this.spec.height);
  }

  /** Row-major, width*height, 0..1. Linear progress — ease at the point of use. */
  get value(): Float32Array {
    return this.level;
  }

  /**
   * Move every cell toward its substrate state.
   *
   * Reads targets straight from the packed grid each frame rather than being
   * told what changed. Unpacking 23,040 cells is a few hundredths of a
   * millisecond, and the alternative — tracking transitions — is a second
   * source of truth that can disagree with the first.
   */
  advance(dtMs: number, grid: Uint32Array): void {
    const { width, height, words } = this.spec;
    const rise = dtMs * this.riseRate;
    const fall = dtMs * this.fallRate;

    for (let y = 0; y < height; y++) {
      const row = y * words;
      const out = y * width;
      for (let w = 0; w < words; w++) {
        const word = grid[row + w]!;
        const base = out + (w << 5);
        for (let bit = 0; bit < 32; bit++) {
          const i = base + bit;
          const v = this.level[i]!;
          if ((word >>> bit) & 1) {
            this.level[i] = v + rise >= 1 ? 1 : v + rise;
          } else {
            this.level[i] = v - fall <= 0 ? 0 : v - fall;
          }
        }
      }
    }
  }

  /**
   * Jump straight to the substrate, skipping the interpolation.
   *
   * Used while fast-forwarding, where hundreds of generations pass per frame
   * and the target a cell is chasing changes many times before it could arrive.
   * Tweening there produces a uniform grey smear rather than motion.
   */
  snap(grid: Uint32Array): void {
    const { width, height, words } = this.spec;
    for (let y = 0; y < height; y++) {
      const row = y * words;
      const out = y * width;
      for (let w = 0; w < words; w++) {
        const word = grid[row + w]!;
        const base = out + (w << 5);
        for (let bit = 0; bit < 32; bit++) {
          this.level[base + bit] = (word >>> bit) & 1;
        }
      }
    }
  }
}

/** Smoothstep. Takes the linear progress off its constant-velocity look. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}
