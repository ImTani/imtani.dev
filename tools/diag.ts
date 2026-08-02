/** Diagnostic: watch density, activity and arm choice over a long run. */
import { World } from '../src/engine/world.ts';
import { RULE_ARMS } from '../src/engine/rules.ts';
import { DECISION_INTERVAL } from '../src/engine/bandit.ts';
import { SUBSTRATE_SPEC } from '../src/engine/substrate.ts';

const cells = SUBSTRATE_SPEC.width * SUBSTRATE_SPEC.height;
const w = new World();

console.log(`cells=${cells}  arms=${RULE_ARMS.map((r) => r.name).join(' ')}`);
console.log('step    rule         pop     density%  activity%  reward  arm');
for (let d = 0; d < 40; d++) {
  w.advanceTo((d + 1) * DECISION_INTERVAL);
  const pop = w.population;
  console.log(
    `${String(w.step).padStart(6)}  ${w.rule.name.padEnd(12)} ${String(pop).padStart(6)}  ` +
      `${((pop / cells) * 100).toFixed(2).padStart(7)}  ` +
      `${((w.metrics?.activity ?? 0) / 100).toFixed(2).padStart(8)}  ` +
      `${String(w.metrics?.reward ?? 0).padStart(6)}  ${w.bandit.arm}`,
  );
  if (pop === 0) {
    console.log('  >>> DEAD. No life-like rule without B0 can recover from an empty grid.');
    break;
  }
}
console.log('\narm means:', w.bandit.counts.map((c, i) =>
  `${RULE_ARMS[i]!.name}:${c === 0 ? '-' : Math.round(w.bandit.sums[i]! / c)}`).join('  '));
