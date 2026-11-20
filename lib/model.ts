// Token launch radar — the value model (radar-2).
//
// This file turns the sealed DefiLlama snapshot into a ranked board of
// protocols that record no token yet. It does three things, in order:
//
//   1. Pick the candidates: protocols with no token on record that are not
//      a wrapped, staked or bridged product of a token that already trades.
//      The snapshot's own watchlist is the floor, never the ceiling: every
//      protocol on it is a candidate, and so are the pre-token protocols
//      below the floor that pass the same wrapped/staked/bridged rule.
//   2. Price each candidate with a comps-calibrated multiple: the median
//      market-cap / TVL of the live-token protocols in its own category,
//      blended with the market-wide median, then adjusted for the
//      protocol's seven-day TVL growth and for how long it has run with
//      no token. The implied value is the model's own claim, never a
//      promise, and it follows from the snapshot's figures alone.
//   3. Write a farm plan for each candidate: concrete steps with what
//      they cost and how long they take, sized to the protocol's TVL.
//
// Nothing here is hardcoded to a name. Every number on the board is
// derived from the snapshot passed in, so the same code scores any
// snapshot of the same shape.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelBreakdown {
  base_multiple: number;
  peer_median: number;
  peer_count: number;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
  farm_budget_usd: number;
  farm_minutes: number;
  farm_days: number;
}

export interface LiveComp {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}

export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: Record<string, number>;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median_multiple: number;
  watchlist: string[];
  rows: BoardRow[];
  live: LiveComp[];
}

// The model's constants. They are the model's judgement, written once,
// and the same constants score every protocol on the board.
export const MODEL_VERSION = "radar-2";
export const MODEL_PARAMS: Record<string, number> = {
  peer_weight: 0.65,
  global_weight: 0.35,
  peer_min_count: 3,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

// Categories whose products wrap, stake or bridge a token that already
// trades. A protocol in one of these is a product of that token, not a
// protocol still waiting on a launch of its own.
const WRAPPED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

// Centralised exchanges. A protocol whose name begins with one of these
// is that exchange's product, not an independent launch candidate.
const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

// A name that ends in a version marker (a space followed by V2, v2, 2.0
// or the like) is a version of something, not a protocol of its own.
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

// A whole word wrapped, staked or staking in the name marks the product
// as a wrapped or staked form of a token that already trades.
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

// A tiny deterministic hash of a string, used only to spread the farm
// cadence across protocols. Same slug, same cadence, every run.
function hashOf(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Whole days between two UTC dates written YYYY-MM-DD.
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.floor((end - start) / 86400000);
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

// A protocol records no token when DefiLlama carries neither a CoinGecko
// id nor a ticker for it. Say it records no token, never that it has none.
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

// True when the protocol is a wrapped, staked or bridged product of a
// token that already trades, by the same rule the snapshot's watchlist
// was drawn with: its category, its name's words, its name's start, or
// a version marker at its name's end.
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_NAMES.some((name) => p.name.startsWith(name))) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  return false;
}

// A candidate for the board: no token on record, and not a wrapped,
// staked or bridged product. The watchlist's members all pass this rule;
// so do the early protocols below the floor that the radar exists to find.
export function isCandidate(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && !isWrappedProduct(p);
}

// ---------------------------------------------------------------------------
// Comps: what a token would be worth
// ---------------------------------------------------------------------------

// The market-wide median multiple: the median market-cap / TVL across
// the protocols whose token already trades, leaving centralised
// exchanges out, because one exchange's ratio would drag the median
// away from the protocols a launch would actually be compared with.
export function globalMedianMultiple(protocols: SnapshotProtocol[]): number {
  const ratios = protocols
    .filter((p) => p.mcap_usd !== null && p.category !== "CEX")
    .map((p) => (p.mcap_usd as number) / p.tvl_usd);
  return round4(medianOf(ratios));
}

// The category comps for one protocol: the live-token protocols in its
// own category, their count and the median of their market-cap / TVL.
// A category with fewer than three live peers cannot set a price on its
// own, so its median falls back to the market-wide one and its count is
// reported as zero: the reader can see the fallback happened.
export function peerStats(
  category: string | null,
  protocols: SnapshotProtocol[],
  marketMedian: number
): { peer_count: number; peer_median: number } {
  if (category === null) {
    return { peer_count: 0, peer_median: marketMedian };
  }
  const peers = protocols.filter(
    (p) => p.category === category && p.mcap_usd !== null
  );
  if (peers.length < MODEL_PARAMS.peer_min_count) {
    return { peer_count: 0, peer_median: marketMedian };
  }
  const ratios = peers.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  return { peer_count: peers.length, peer_median: round4(medianOf(ratios)) };
}

// The blended multiple: mostly the category's own peers, with the
// market-wide median holding a third of the weight, so a thin category
// cannot set the price alone. Rounded to four decimals before it is
// used, so the board, the dashboard's data and the page's own recompute
// all agree on the same number.
export function blendedMultiple(peerMedian: number, marketMedian: number): number {
  const mixed =
    MODEL_PARAMS.peer_weight * peerMedian +
    MODEL_PARAMS.global_weight * marketMedian;
  return round4(mixed);
}

// ---------------------------------------------------------------------------
// Growth and maturity: the two adjustments
// ---------------------------------------------------------------------------

// The growth adjustment. The seven-day TVL change is clamped to the
// range the model trusts, then half of it is applied: a protocol that
// grew 20% in a week is worth 10% more than its multiple alone says,
// one that shrank 20% is worth 10% less. No report means no adjustment.
export function growthFactor(change7d: number | null): number {
  const pct = change7d === null ? 0 : change7d;
  const held = clamp(pct, MODEL_PARAMS.growth_floor, MODEL_PARAMS.growth_cap);
  return 1 + MODEL_PARAMS.growth_weight * (held / 100);
}

// The maturity adjustment. A protocol that has run longer with no token
// is a more seasoned candidate: the factor rises from the floor toward
// one as the tokenless age approaches three years. A protocol whose
// listing date is unknown is scored as a year old, neither new nor old.
export function maturityFactor(ageDays: number | null): number {
  const age = ageDays === null ? MODEL_PARAMS.unknown_age_days : ageDays;
  const share = Math.min(age / MODEL_PARAMS.maturity_days, 1);
  return MODEL_PARAMS.maturity_floor + MODEL_PARAMS.maturity_range * share;
}

// ---------------------------------------------------------------------------
// Scoring one protocol
// ---------------------------------------------------------------------------

export function scoreProtocol(
  p: SnapshotProtocol,
  snapshot: Snapshot,
  marketMedian: number
): Omit<BoardRow, "rank" | "farm_steps" | "farm_budget_usd" | "farm_minutes" | "farm_days"> {
  const age = p.listed_at === null ? null : daysBetween(p.listed_at, snapshot.as_of);
  const peers = peerStats(p.category, snapshot.protocols, marketMedian);
  const base = blendedMultiple(peers.peer_median, marketMedian);
  const growth = growthFactor(p.change_7d);
  const maturity = maturityFactor(age);
  const implied = Math.round(p.tvl_usd * base * growth * maturity);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: "pre-token",
    age_days: age,
    implied_value_usd: implied,
    model: {
      base_multiple: base,
      peer_median: peers.peer_median,
      peer_count: peers.peer_count,
      growth_pct: p.change_7d,
      growth_multiplier: round4(growth),
      maturity_multiplier: round4(maturity),
      age_days: age,
    },
  };
}

// ---------------------------------------------------------------------------
// Farm plans: what to do, what it costs, how long it takes
// ---------------------------------------------------------------------------

// The capital a farm puts in, sized to the protocol's TVL: the biggest
// protocols get the biggest position, the smallest the smallest.
function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

// How long a farm runs. Most protocols get five weeks over thirty days;
// the hash spreads a minority to seven weeks over forty-five days or
// nine weeks over sixty, so the board's plans are not all identical.
function cadenceFor(slug: string): { weeks: number; days: number } {
  const roll = hashOf(slug) % 20;
  if (roll < 12) return { weeks: 5, days: 30 };
  if (roll < 17) return { weeks: 9, days: 60 };
  return { weeks: 7, days: 45 };
}

// The first qualifying action, chosen by what the protocol is. Each kind
// names a concrete move on the protocol's own surface, on its first
// chain, for the plan's capital.
type MoveKind =
  | "vault"
  | "pool"
  | "supply"
  | "margin"
  | "market"
  | "bridge"
  | "stake"
  | "cover"
  | "mint"
  | "deposit";

function moveKindFor(category: string | null): MoveKind {
  switch (category) {
    case "Risk Curators":
    case "Onchain Capital Allocator":
    case "Yield Aggregator":
    case "CeDeFi":
    case "Indexes":
    case "Governance Incentives":
    case "Collateral Management":
    case "CDP Manager":
    case "Collateral Markets":
      return "vault";
    case "Dexs":
    case "Liquidity Manager":
    case "Farm":
    case "Leveraged Farming":
      return "pool";
    case "Lending":
    case "Uncollateralized Lending":
    case "CDP":
      return "supply";
    case "Derivatives":
    case "Options":
    case "Interest Rate Derivatives":
    case "Synthetics":
    case "Dual-Token Stablecoin":
      return "margin";
    case "Prediction Market":
      return "market";
    case "Bridge":
    case "Cross Chain Bridge":
    case "Canonical Bridge":
      return "bridge";
    case "Liquid Staking":
    case "Liquid Restaking":
    case "Restaking":
    case "Restaked BTC":
    case "Staking Pool":
    case "Anchor BTC":
    case "Decentralized BTC":
      return "stake";
    case "Insurance":
      return "cover";
    case "Yield":
    case "Algo-Stables":
    case "Stablecoin Issuer":
    case "Stablecoin Wrapper":
      return "mint";
    default:
      return "deposit";
  }
}

function firstMove(kind: MoveKind, name: string, chain: string, capital: number): string {
  const setupGas = capital === 150 ? 8 : 4;
  switch (kind) {
    case "vault":
      return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "pool":
      return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "supply":
      return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "margin":
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "market":
      return `Fund $${capital} and place one market position on ${name}. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "bridge":
      return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds there. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "stake":
      return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "cover":
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    case "mint":
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open. Cost: $${capital} of capital and about $${setupGas} of gas. Time: 15 minutes to set up.`;
  }
}

// The second qualifying action. It is deliberately a different kind of
// move from the first: a wallet that only repeats one action looks like
// one action, and the plan wants two kinds of activity on record.
function secondMove(kind: MoveKind, name: string): string {
  switch (kind) {
    case "supply":
      return `Borrow $25 against the supplied position and repay it within the week, so the wallet shows a second kind of activity. Cost: about $3 of gas. Time: 10 minutes.`;
    case "margin":
      return `Close the hedge and open a fresh one in the opposite direction, so the wallet shows two separate trades. Cost: about $3 of gas. Time: 10 minutes.`;
    case "market":
      return `Provide $25 of liquidity to ${name}'s market pool and keep it open for a week. Cost: about $3 of gas. Time: 10 minutes.`;
    case "bridge":
      return `Swap $25 of the bridged USDC for the destination chain's gas token, so the wallet holds a second asset there. Cost: about $3 of gas. Time: 10 minutes.`;
    case "stake":
      return `Vote with the staked position in ${name}'s next governance poll. Cost: about $3 of gas. Time: 10 minutes.`;
    case "cover":
      return `Swap $25 of USDC for ${name}'s cover token on its own market. Cost: about $3 of gas. Time: 10 minutes.`;
    case "mint":
      return `Swap $25 of the minted asset back to USDC through ${name}'s own market. Cost: about $3 of gas. Time: 10 minutes.`;
    default:
      return `Swap $25 of USDC for the protocol's other asset through ${name}'s own router. Cost: about $3 of gas. Time: 10 minutes.`;
  }
}

// The full seven-step plan, with its totals. The gas adds up from the
// steps themselves: under $3 for the first transaction, the setup gas,
// $3 for the second move, and $2 a week for the repeats. The minutes
// add up the same way: 5 to start, 15 to set up, 10 for the second
// move, 10 a week for the repeats, 10 to check the claim, and 5 to
// write the log. The last step states both totals in words, so the
// dashboard's farm box and the plan can never disagree.
export function buildFarmPlan(
  row: Omit<BoardRow, "rank" | "farm_steps" | "farm_budget_usd" | "farm_minutes" | "farm_days">
): { steps: string[]; budget_usd: number; minutes: number; days: number } {
  const capital = capitalFor(row.tvl_usd);
  const cadence = cadenceFor(row.slug);
  const kind = moveKindFor(row.category);
  const chain = row.chains.length > 0 ? row.chains[0] : "Ethereum";
  const setupGas = capital === 150 ? 8 : 4;
  const repeatGas = 2 * cadence.weeks;
  const gas = 3 + setupGas + 3 + repeatGas;
  const budget = capital + gas;
  const minutes = 5 + 15 + 10 + 10 * cadence.weeks + 10 + 5;
  const steps = [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.`,
    firstMove(kind, row.name, chain, capital),
    secondMove(kind, row.name),
    `Repeat one qualifying action each week for ${cadence.weeks} weeks, such as a deposit, a borrow, a swap or a vote, so the activity spans several snapshots. Cost: about $2 of gas a week, $${repeatGas} in all. Time: 10 minutes a week, ${cadence.weeks} weeks.`,
    `Hold the position for at least ${cadence.days} days so the activity is counted in more than one snapshot. Cost: the $${capital} stays in the position. Time: ${cadence.days} days.`,
    `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Total budget about $${budget} ($${capital} of capital plus about $${gas} of gas); total time about ${minutes} minutes spread over ${cadence.days} days. Cost: about $${budget} in all. Time: about ${minutes} minutes over ${cadence.days} days.`,
  ];
  return { steps, budget_usd: budget, minutes, days: cadence.days };
}

// ---------------------------------------------------------------------------
// Assembly: the board, the live set, the dashboard payload
// ---------------------------------------------------------------------------

// The board: every candidate scored, sorted by implied value with the
// slug breaking ties so the order is the same on every run, then ranked
// 1 to N. Rank is the model's claim; the page may sort how it likes.
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const marketMedian = globalMedianMultiple(snapshot.protocols);
  const scored = snapshot.protocols
    .filter(isCandidate)
    .map((p) => scoreProtocol(p, snapshot, marketMedian));
  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) {
      return b.implied_value_usd - a.implied_value_usd;
    }
    return a.slug < b.slug ? -1 : 1;
  });
  return scored.map((row, index) => {
    const plan = buildFarmPlan(row);
    return {
      ...row,
      rank: index + 1,
      farm_steps: plan.steps,
      farm_budget_usd: plan.budget_usd,
      farm_minutes: plan.minutes,
      farm_days: plan.days,
    };
  });
}

// The live-token protocols set aside: the twenty-four with the largest
// market caps, leaving centralised exchanges out for the same reason
// they leave the market median out. They are the priced comps the
// board's multiples are measured against, shown on their own tab so the
// reader can see the line between a token that trades and one that
// does not exist yet.
export function liveSetAside(snapshot: Snapshot): LiveComp[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.category !== "CEX")
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));
}

// Everything the dashboard page needs, in one object: the snapshot's
// facts, the model's constants, the watchlist, the ranked rows and the
// live comps. The page reads this file and nothing else.
export function buildPayload(snapshot: Snapshot): RadarPayload {
  const rows = buildBoard(snapshot);
  const live = liveSetAside(snapshot);
  const marketMedian = globalMedianMultiple(snapshot.protocols);
  const watchlist = [...snapshot.watchlist].sort();
  const early = rows.filter((r) => !watchlist.includes(r.slug)).length;
  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL_PARAMS,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.length,
    board_size: rows.length,
    early_size: early,
    live_size: live.length,
    global_median_multiple: marketMedian,
    watchlist,
    rows,
    live,
  };
}
