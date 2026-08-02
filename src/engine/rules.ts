/**
 * Life-like rules over a Moore neighbourhood, encoded as two 9-bit masks.
 *
 * Bit n of `birth` means a dead cell with exactly n live neighbours becomes
 * live; bit n of `survive` means a live cell with exactly n live neighbours
 * stays live. Every rule expressible in B/S notation fits, which is the arm
 * space the bandit searches over.
 */

export interface Rule {
  /** Human-readable B/S notation, e.g. "B3/S23". Display and debugging only. */
  readonly name: string;
  /** Bit n set = birth on exactly n neighbours. */
  readonly birth: number;
  /** Bit n set = survival on exactly n neighbours. */
  readonly survive: number;
}

/** Parse "B3/S23" or "b36/s125" into masks. Throws on anything malformed. */
export function parseRule(notation: string): Rule {
  const m = /^B([0-8]*)\/S([0-8]*)$/i.exec(notation.trim());
  if (!m) throw new SyntaxError(`not B/S notation: ${notation}`);
  const bits = (digits: string): number => {
    let mask = 0;
    for (const d of digits) mask |= 1 << Number(d);
    return mask;
  };
  const birth = bits(m[1] ?? '');
  const survive = bits(m[2] ?? '');
  return { name: `B${m[1] ?? ''}/S${m[2] ?? ''}`.toUpperCase(), birth, survive };
}

/** The neighbour counts a rule actually reads. Lets the stepper skip dead branches. */
export function activeCounts(rule: Rule): readonly number[] {
  const used: number[] = [];
  for (let n = 0; n <= 8; n++) {
    if ((rule.birth >>> n) & 1 || (rule.survive >>> n) & 1) used.push(n);
  }
  return used;
}

/**
 * The bandit's arms.
 *
 * Chosen to span behaviour rather than to be a catalogue: two that stabilise
 * into still lifes, two chaotic, two that grow without bound, two that are
 * mostly quiet. The reward function is what decides between them — this list
 * only has to contain enough disagreement to make the search meaningful.
 */
export const RULE_ARMS: readonly Rule[] = [
  parseRule('B3/S23'), // Conway. Balanced, the reference point.
  parseRule('B36/S23'), // HighLife. Conway plus replicators.
  parseRule('B3/S12345'), // Maze. Grows into corridors and settles.
  parseRule('B3/S1234'), // Mazectric. Longer, straighter corridors.
  parseRule('B368/S245'), // Move. Slow, sparse, produces gliders.
  parseRule('B2/S'), // Seeds. Explosive, never stable, mostly noise.
  parseRule('B35678/S5678'), // Diamoeba. Large amorphous blobs.
  parseRule('B34/S34'), // 34 Life. Chaotic and dense.
  parseRule('B345/S5'), // Long Life. Sparse, slow-moving structures.
  parseRule('B36/S125'), // 2x2. Blocky, period-heavy.
] as const;

export const DEFAULT_RULE: Rule = RULE_ARMS[0]!;
