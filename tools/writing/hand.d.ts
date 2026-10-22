/* Types for hand.js.
 *
 * hand.js is hand-written as plain JavaScript on purpose: build.ts pastes its
 * source into a <script> tag, so it cannot carry type annotations. This file is
 * what `tsc` reads when build.ts imports it. It is small, and it is the one
 * thing here that can silently disagree with the implementation beside it —
 * change the two together.
 */

export declare function clamp(v: number, a: number, b: number): number;

export declare function smoothstep(edge: number, x: number): number;

export declare function mulberry32(seed: number): () => number;

export declare function wander(rnd: () => number, n: number, cyclic?: boolean): (u: number) => number;

export interface HandLineOptions {
  /** The pseudo-random source. Same seed, same line. */
  rnd: () => number;
  /** The run of this piece, in px. */
  len: number;
  /** The run of the whole line this piece belongs to. Defaults to `len`. */
  span?: number;
  /** Where this piece starts along that span. Defaults to 0. */
  x0?: number;
  step?: number;
  wobble?: number;
  weight?: number;
  driftN?: number;
  driftAmp?: number;
  tremorN?: number;
  tremorAmp?: number;
  pressN?: number;
  taperIn?: number;
  taperOut?: number;
  taperFloor?: number;
  minWeight?: number;
  /** A repeating tile rather than a line with two ends. */
  cyclic?: boolean;
  y?: number;
  xDigits?: number;
}

/** One drawn line as an SVG path `d` string, to be filled rather than stroked. */
export declare function handLine(opts: HandLineOptions): string;
