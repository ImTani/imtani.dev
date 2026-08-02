# imtani.dev

Source for my portfolio site.

**Status: engine only.** There is no site here yet — no design, no content, no
pages. What exists is the simulation that will run behind it, and a deliberately
unstyled harness for looking at it.

## The shared world

The background is a cellular automaton that has been running since a fixed epoch
and is **the same world for everybody**. Two people opening the site a minute
apart see the same cells in the same places.

There is no server doing that. The world is a pure function of `(seed, epoch,
now)` — deterministic down to the bit, from a public seed, so anyone can
recompute the whole history from scratch and check that what the site shows is
what it claims. Nothing is stored and nothing about a visitor is recorded,
because there is nothing to record: the maths is the only state.

A bandit sits inside it, choosing between rule variants and scoring them on the
world's own liveliness — alive but not saturated, changing but not noise. It
watches the automaton, never the person looking at it.

```
npm install
npm run dev     # harness at :5173
npm test        # 20 tests, no framework
npm run bench   # substrate throughput
```

Engineering notes, invariants and measurements: **[docs/engine.md](docs/engine.md)**.

## Licence

Split on purpose. **Code is GPL-3.0** — build on it, keep it open.
**Everything else is reserved**: the writing, the visual design, the artwork,
the audio.

The site makes a claim about its own authorship — the code here is written with
AI, and the art is not. Licensing both halves the same way would quietly
contradict it. See [COPYRIGHT.md](COPYRIGHT.md).
