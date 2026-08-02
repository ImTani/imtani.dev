# imtani.dev — engine

The simulation substrate. **No visual decisions are made here** — the art
direction is unresolved and lives in `../DESIGN_BRIEF.md`. Anything you can see
in `index.html` or `src/render/debug.ts` is a test harness and is meant to be
thrown away.

## Commands

The checkpoint under `src/generated/` is produced by the build and is not
committed — regenerating it is deterministic, so there is nothing to preserve,
and committing it would diff the entire grid on every build. `dev` and
`typecheck` bake it themselves, so a fresh clone needs no extra step.

```
npm test        # 20 tests, no framework — Node 24 strips types natively
npm run bench   # substrate throughput and what it implies for catch-up
npm run bake    # recompute the checkpoint to now
npm run build   # bake, typecheck all three environments, bundle
npm run dev     # harness at :5173
npm run deploy  # wrangler deploy — site and Godot proxy in one Worker
```

## Invariants

These are load-bearing. Breaking any one of them breaks the shared world.

**Width must be a multiple of 32.** With no partial trailing word, a one-cell
row shift is a word-wise rotate and the toroidal wrap costs nothing. A width of
200 leaves 24 padding bits per row that must be masked after every operation,
and every place that mask is forgotten is a right-edge bug that surfaces days
later.

**No `Math.random`, ever.** `src/engine/prng.ts` is counter-based: every draw is
a pure function of `(seed, counter)`, so checkpointing the generator means
storing one integer and there is no way for two clients to drift.

**No `Math.sin`, `cos`, `pow` or `exp` in the engine.** These are
implementation-defined in ECMA-262 and differ between V8 and JavaScriptCore. The
reward feeds arm selection, which selects the rule, which determines every
subsequent cell — a one-ulp difference would eventually produce a visibly
different world on Safari. `src/engine/metrics.ts` is integer-only for this
reason and must stay that way.

**`src/engine` must run unchanged in Node and the browser.** `tsconfig.node.json`
checks it without DOM types specifically to enforce this, because `tools/bake.ts`
runs the engine at build time. Browser-only code lives outside `src/engine`.

**Byte order is explicit.** Checkpoints serialise through a `DataView` as
little-endian. Reading a `Uint32Array`'s buffer directly is host-endian and a
snapshot baked on one machine would decode to noise on another.

## Two things that were discovered rather than designed

**The world can die, and the empty grid is absorbing.** No rule in the arm set
has B0, so a world that reaches zero population stays there and every arm then
scores zero — the bandit can never learn its way out. Because the search is
guaranteed to try every arm, extinction was not a risk but a certainty:
`B34/S34` emptied the grid at step 420 on the first run. Hence the immigration
floor in `config.ts`, which is a rule of the world rather than a patch on one.

**A floor that only prevents death produces an impoverished world.** The first
version topped up to just past the floor, and the world then sat at 2–4% density
scoring ~2,700 where it had opened at 9,026, because no rule can rebuild
structure from a grid that sparse. Immigration now restores to the peak of the
reward band. The world consequently has a cycle: HighLife thins it out over
roughly ten hours of world time, immigration fires at 4%, it rebuilds.

## Measured on this machine

Substrate is 192×120 — 23,040 cells in 2,880 bytes, 0.0496 ms/step.

| | steps | time |
|---|---|---|
| One week away, slow clock | 10,080 | **0.50 s** |
| One year from epoch | 525,600 | 26.1 s |
| One week at 30 steps/sec | 18,144,000 | 15 min |

The last row is why there are two clocks, and the middle row is why checkpoints
are baked at build time rather than computed on load.

## Not built yet

The fast surface layer, the creature, the narrator, the personal layer in
localStorage, the live feeds, and every part of the visual language.

## Licence

Split on purpose. **Code is GPL-3.0** — the engine is yours to build on, as
long as what you build stays open. **Everything else is reserved**: the writing,
the visual design, the artwork, the audio.

The site makes a claim about its own authorship — the code here is written with
AI, and the art is not. Licensing both halves identically would quietly
contradict it. See [COPYRIGHT.md](COPYRIGHT.md).
