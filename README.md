# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tyler-2-makefun/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tyler-2-makefun/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, finds the
ones that record no token yet, ranks them by what a token would be worth if the
protocol's record stayed as it is, and shows a reader how to farm each one. The
board covers the snapshot's whole 40-protocol watchlist and adds 158 early
protocols below and above the watchlist floor.

## How the value is made

Each protocol's implied value is its TVL times a comps multiple — the median
market-cap / TVL of the live-token protocols in its own category, blended 0.65 /
0.35 with the market-wide median — times a growth factor from its seven-day TVL
change and a maturity factor from how long it has run with no token. A category
with fewer than three live peers falls back to the market-wide median. Wrapped,
staked and bridged products of tokens that already trade are left out of the
ranking, by the same rule the watchlist was drawn with. Nothing is hardcoded
to a name: every number follows from the snapshot's own figures.

The dashboard is a static page: a sortable, filterable board, a watchlist-only
toggle, a live-token tab with the priced comps, and a detail view for each
protocol with the comps behind its multiple and a seven-step farm plan with
its budget and time. The page recomputes each row's implied value from the
same figures, so what you see is what `board.json` carries.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

That writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Run it twice: both runs write
the same bytes. It needs Node 22 or later, standard library only, and no
network.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z7j8rs2v&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
