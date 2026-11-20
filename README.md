# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tyler-2-makefun/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![score](https://make.fun/badge/token-radar-01/tyler-2-makefun/token-radar-01/score.svg)](https://make.fun/bounty/token-radar-01/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

[View the bounty on make.fun](https://make.fun/bounty/token-radar-01)

## What this is

A token launch radar: it reads the sealed DefiLlama snapshot of 758 protocols (as of 2026-11-14),
finds the protocols with no token on record, and ranks them by the implied value a launch would
carry, with a concrete farm plan for each one. The dashboard is a static page: a sortable,
filterable board, a detail view per protocol, and a live-token view set aside from the ranking.

## The model (radar-2)

Implied value is calibrated on the snapshot's own live market, not on a fixed multiple:

- **Peer median** — the median market-cap-over-TVL of the live-token protocols in the same
  category (at least 3 peers, else the market-wide median stands in).
- **Multiple** — 0.65 × peer median + 0.35 × market median, so a thin category cannot set the
  price alone. The market-wide median here is 0.19×.
- **Growth** — the seven-day TVL change, clamped to −60…+120%, at half weight.
- **Maturity** — 0.6 + min(age, 1095) / 1095 × 0.4; age is the time since the protocol was first
  listed, the best record of how long it has run with no token.

`implied = round(tvl × multiple × growth × maturity)`

No protocol name is special-cased: one function scores every row, and every row carries the
peers that priced it, so the dashboard shows them.

## The board

198 rows: the whole 40-protocol watchlist (TVL ≥ $50M, no token on record) plus every other
rankable pre-token protocol in the snapshot, above or below the floor. Wrapped, staked and
bridged products of tokens that already trade (WBTC, Binance staked ETH, USDT0 and the like)
are left out, as the watchlist rule leaves them out. Each row carries a 7-step farm plan with
a cost and a time per step and a total budget and time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the snapshot, writes `board.json` and
`data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the
vendored `vendor/makefun-board.ts` library. Both runs write the same bytes.

## Layout

- `main.ts` — the entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the radar-2 model, the comps, the farm plans, the board checks.
- `vendor/makefun-board.ts` — the make.fun dossier library, copied whole from the kit.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a protocol's detail view, and a filtered view.
