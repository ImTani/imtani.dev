/**
 * Bit-packed Life-like cellular automaton, toroidal, 32 cells per word.
 *
 * WIDTH MUST BE A MULTIPLE OF 32. This is not a convenience — it is what makes
 * the horizontal wrap correct for free. With no partial trailing word, shifting
 * a row by one cell is a word-wise rotate, and the modular index arithmetic
 * carries bit 0 of word 0 around to bit 31 of the last word without a special
 * case. A width of, say, 200 leaves 24 padding bits per row that must be masked
 * after every operation, and every place that mask is forgotten is a bug that
 * only shows up at the right-hand edge, days later.
 *
 * Neighbour counting is a SWAR half-adder chain: four bit-planes hold a 4-bit
 * count for all 32 cells of a word simultaneously, so one pass over the row
 * counts eight neighbours for thirty-two cells at once.
 *
 * Measured on this machine at 192x120: ~0.07 ms/step, so a week of catch-up at
 * one step per minute is well under a second. See tools/bench.ts.
 */

import type { Rule } from './rules.ts';
import { activeCounts } from './rules.ts';

export interface GridSpec {
  readonly width: number;
  readonly height: number;
  /** Uint32 words per row. Always width / 32. */
  readonly words: number;
}

export function makeSpec(width: number, height: number): GridSpec {
  if (width % 32 !== 0) {
    throw new RangeError(`width must be a multiple of 32, got ${width}`);
  }
  if (width <= 0 || height <= 0) {
    throw new RangeError(`dimensions must be positive, got ${width}x${height}`);
  }
  return { width, height, words: width / 32 };
}

/** The site's substrate. 23,040 cells in 2,880 bytes. */
export const SUBSTRATE_SPEC: GridSpec = makeSpec(192, 120);

export function allocGrid(spec: GridSpec): Uint32Array {
  return new Uint32Array(spec.words * spec.height);
}

export function getCell(g: Uint32Array, spec: GridSpec, x: number, y: number): 0 | 1 {
  const xi = ((x % spec.width) + spec.width) % spec.width;
  const yi = ((y % spec.height) + spec.height) % spec.height;
  const word = g[yi * spec.words + (xi >>> 5)]!;
  return ((word >>> (xi & 31)) & 1) as 0 | 1;
}

export function setCell(
  g: Uint32Array,
  spec: GridSpec,
  x: number,
  y: number,
  value: 0 | 1,
): void {
  const xi = ((x % spec.width) + spec.width) % spec.width;
  const yi = ((y % spec.height) + spec.height) % spec.height;
  const i = yi * spec.words + (xi >>> 5);
  const bit = 1 << (xi & 31);
  if (value) g[i] = (g[i]! | bit) >>> 0;
  else g[i] = (g[i]! & ~bit) >>> 0;
}

/** Live cell count. Uses the standard SWAR popcount, no lookup table. */
export function population(g: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < g.length; i++) {
    let v = g[i]!;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    total += Math.imul(v, 0x01010101) >>> 24;
  }
  return total;
}

/** Cells that differ between two grids of the same spec. */
export function hammingDistance(a: Uint32Array, b: Uint32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    let v = (a[i]! ^ b[i]!) >>> 0;
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    v = (v + (v >>> 4)) & 0x0f0f0f0f;
    total += Math.imul(v, 0x01010101) >>> 24;
  }
  return total;
}

/**
 * Scratch buffers for one step. Allocated once and reused — the stepper runs
 * hundreds of thousands of times during catch-up and must not allocate.
 */
export interface StepScratch {
  readonly west: Uint32Array;
  readonly east: Uint32Array;
  readonly c0: Uint32Array;
  readonly c1: Uint32Array;
  readonly c2: Uint32Array;
  readonly c3: Uint32Array;
}

export function makeScratch(spec: GridSpec): StepScratch {
  const w = spec.words;
  return {
    west: new Uint32Array(w),
    east: new Uint32Array(w),
    c0: new Uint32Array(w),
    c1: new Uint32Array(w),
    c2: new Uint32Array(w),
    c3: new Uint32Array(w),
  };
}

/**
 * One generation, `cur` into `next`.
 *
 * `next` is fully overwritten, so the caller can swap buffers rather than clear.
 */
export function step(
  cur: Uint32Array,
  next: Uint32Array,
  spec: GridSpec,
  rule: Rule,
  scratch: StepScratch,
  counts: readonly number[] = activeCounts(rule),
): void {
  const { words, height } = spec;
  const { west, east, c0, c1, c2, c3 } = scratch;

  for (let y = 0; y < height; y++) {
    const rowUp = (y === 0 ? height - 1 : y - 1) * words;
    const rowMid = y * words;
    const rowDown = (y === height - 1 ? 0 : y + 1) * words;

    c0.fill(0);
    c1.fill(0);
    c2.fill(0);
    c3.fill(0);

    for (let r = 0; r < 3; r++) {
      const base = r === 0 ? rowUp : r === 1 ? rowMid : rowDown;

      // Rotate the row one cell each way. Because words * 32 === width exactly,
      // the modular word index performs the toroidal wrap with no edge case.
      for (let i = 0; i < words; i++) {
        const nextWord = cur[base + (i + 1 === words ? 0 : i + 1)]!;
        west[i] = ((cur[base + i]! >>> 1) | (nextWord << 31)) >>> 0;
      }
      for (let i = 0; i < words; i++) {
        const prevWord = cur[base + (i === 0 ? words - 1 : i - 1)]!;
        east[i] = ((cur[base + i]! << 1) | (prevWord >>> 31)) >>> 0;
      }

      for (let k = 0; k < 3; k++) {
        // The centre cell of the middle row is the cell itself, not a neighbour.
        if (r === 1 && k === 1) continue;

        for (let i = 0; i < words; i++) {
          const v = k === 0 ? west[i]! : k === 1 ? cur[base + i]! : east[i]!;
          // Half-adder chain: c3c2c1c0 accumulates a 4-bit count per cell.
          const t0 = (c0[i]! & v) >>> 0;
          c0[i] = (c0[i]! ^ v) >>> 0;
          const t1 = (c1[i]! & t0) >>> 0;
          c1[i] = (c1[i]! ^ t0) >>> 0;
          const t2 = (c2[i]! & t1) >>> 0;
          c2[i] = (c2[i]! ^ t1) >>> 0;
          c3[i] = (c3[i]! | t2) >>> 0;
        }
      }
    }

    for (let i = 0; i < words; i++) {
      const alive = cur[rowMid + i]!;
      const b0 = c0[i]!;
      const b1 = c1[i]!;
      const b2 = c2[i]!;
      const b3 = c3[i]!;
      let out = 0;

      for (let ci = 0; ci < counts.length; ci++) {
        const n = counts[ci]!;
        // Cells whose neighbour count is exactly n.
        const eq =
          ((n & 1 ? b0 : ~b0) &
            (n & 2 ? b1 : ~b1) &
            (n & 4 ? b2 : ~b2) &
            (n & 8 ? b3 : ~b3)) >>>
          0;
        if (eq === 0) continue;
        if ((rule.survive >>> n) & 1) out |= eq & alive;
        if ((rule.birth >>> n) & 1) out |= eq & ~alive;
      }

      next[rowMid + i] = out >>> 0;
    }
  }
}

/**
 * Reference implementation: one cell at a time, no packing, no cleverness.
 *
 * Exists solely so the fast path can be tested against something obviously
 * correct. Never call it in production — it is roughly 20x slower.
 */
export function stepReference(
  cur: Uint8Array,
  next: Uint8Array,
  width: number,
  height: number,
  rule: Rule,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const yy = (y + dy + height) % height;
          const xx = (x + dx + width) % width;
          n += cur[yy * width + xx]!;
        }
      }
      const alive = cur[y * width + x]! === 1;
      const lives = alive ? ((rule.survive >>> n) & 1) === 1 : ((rule.birth >>> n) & 1) === 1;
      next[y * width + x] = lives ? 1 : 0;
    }
  }
}

/** Unpack to one byte per cell, for the reference implementation and rendering. */
export function unpack(g: Uint32Array, spec: GridSpec, out?: Uint8Array): Uint8Array {
  const dst = out ?? new Uint8Array(spec.width * spec.height);
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      dst[y * spec.width + x] = (g[y * spec.words + (x >>> 5)]! >>> (x & 31)) & 1;
    }
  }
  return dst;
}

/** Pack one byte per cell back into the bit-packed representation. */
export function pack(src: Uint8Array, spec: GridSpec, out?: Uint32Array): Uint32Array {
  const dst = out ?? allocGrid(spec);
  dst.fill(0);
  for (let y = 0; y < spec.height; y++) {
    for (let x = 0; x < spec.width; x++) {
      if (src[y * spec.width + x]) {
        const i = y * spec.words + (x >>> 5);
        dst[i] = (dst[i]! | (1 << (x & 31))) >>> 0;
      }
    }
  }
  return dst;
}
