/**
 * Counter-based deterministic PRNG.
 *
 * Every draw is a pure function of (seed, counter). There is no accumulating
 * internal state to serialise and no way for two clients to drift apart: to
 * checkpoint the generator you store one integer, and to replay from a
 * checkpoint you resume from that integer.
 *
 * This matters more than raw quality here. A stateful generator (xoshiro, PCG)
 * would be marginally faster, but its state is four words that must round-trip
 * through JSON exactly, and any code path that draws out of order silently
 * desynchronises every subsequent value. Counter-based removes that failure
 * mode entirely — a caller that needs a value for step 900 asks for step 900.
 *
 * Integer operations only. No Math.random, no floating-point accumulation.
 */

/** splitmix32 — one round, integer-only, good avalanche for a 32-bit finaliser. */
export function splitmix32(seed: number, counter: number): number {
  let z = (seed + Math.imul(counter, 0x9e3779b9)) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

/**
 * A cursor over the counter-based stream.
 *
 * `counter` is public and is the entire serialisable state. Two Rng instances
 * with the same seed and counter produce identical sequences forever.
 */
export class Rng {
  readonly seed: number;
  counter: number;

  constructor(seed: number, counter = 0) {
    this.seed = seed | 0;
    this.counter = counter | 0;
  }

  /** Next raw 32-bit unsigned value. */
  next(): number {
    return splitmix32(this.seed, this.counter++);
  }

  /** Uniform float in [0, 1). Derived from the integer stream, never accumulated. */
  float(): number {
    return this.next() / 4294967296;
  }

  /**
   * Uniform integer in [0, bound). Rejection-sampled so the result is unbiased
   * and — critically — the number of draws consumed is itself deterministic.
   */
  int(bound: number): number {
    if (bound <= 0) throw new RangeError(`bound must be positive, got ${bound}`);
    const limit = Math.floor(4294967296 / bound) * bound;
    for (;;) {
      const v = this.next();
      if (v < limit) return v % bound;
    }
  }

  /** A fork whose stream is independent but still fully determined by (seed, label). */
  fork(label: number): Rng {
    return new Rng(splitmix32(this.seed, label ^ 0x5bf03635) | 0, 0);
  }

  clone(): Rng {
    return new Rng(this.seed, this.counter);
  }
}

/** Stable 32-bit hash of a string, for deriving seeds from human-readable labels. */
export function hashString(s: string): number {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
