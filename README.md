# launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/surab-max/launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/surab-max/launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar that ranks every pre-token protocol in a sealed DefiLlama snapshot by implied value — and shows exactly how to farm each one. The watchlist is the floor, not the ceiling: all 40 watchlist protocols are covered, and the board keeps going to 289 ranked rows so early protocols below the $50M floor are visible too.

**The model (radar-2 conviction).** No flat TVL multiple and no hand-picked names. Each protocol's base multiple is the median market-cap / TVL ratio of the live-token protocols *in its own category* inside the same snapshot, shrunk toward the global live median when a category has few comps. That base is then adjusted by compounded seven-day TVL momentum, by maturity (years tracked with no token), and by a capped multi-chain breadth premium. A 0–100 conviction score (size, momentum, age, breadth, comp depth) travels with every row. Protocols whose token already trades are never ranked — they are the comparables that price the board, shown in their own view.

**Farm plans.** Every row carries a seven-step plan generated from that protocol's own record: the category decides the core action, the primary chain the gas budget, TVL the capital tier, the seven-day change the risk step, age the hold length, and chain count whether a second-chain step appears. Costs and times are stated per step.

**The dashboard.** A static, no-network page: thesis strip with the top picks argued from the figures, a sortable and filterable board (search, category, chain, watchlist-only), a per-protocol detail drawer with the full model waterfall (the page recomputes each row and checks it against board.json), a live-comparables view, and a method panel listing the category multiples the model derived.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
# then open out/dashboard/index.html in a browser (data.js is written beside it)
```

In the grader's container the program reads `/input/snapshot.json` and writes `/output` with no arguments. Node 22, standard library only, deterministic: two runs over the same snapshot write the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?ref=ys1ka8r4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
