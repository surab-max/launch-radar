// Token Launch Radar — conviction model (radar-2).
//
// One sealed DefiLlama snapshot in, one ranked board out. The board covers every slug on the
// snapshot's watchlist and then keeps going: every other protocol that records no token, is not a
// centralised exchange and is not a versioned pool of another protocol is ranked too, because the
// early rows below the $50M floor are the whole point of a radar. Protocols whose token already
// trades are never mixed into the ranking; they are kept apart as the comparable set ("comps")
// that prices the pre-token rows.
//
// The implied value is not a flat TVL multiple. It is built from the snapshot's own figures only:
//
//   baseMultiple(category) = the median market-cap / TVL ratio of the live-token protocols in the
//                            same DefiLlama category inside this snapshot, shrunk toward the
//                            global live median when a category has few comps, clamped to
//                            [0.05, 1.50]. A lending market is priced like lending markets
//                            actually trade, not like a DEX or a bridge.
//   growthMult  = exp(0.006 x clamp(change_7d, -60, 120)) — one week of TVL momentum, compounded
//                 smoothly so a single spike cannot dominate and a drawdown cannot zero a row.
//   maturityMult = 0.55 + 0.65 x min(age_days, 1460) / 1460 — a protocol that has held TVL for
//                 years with no token is a different claim from one listed last month.
//   breadthMult = 1 + 0.02 x min(chains - 1, 7) — multi-chain distribution is real surface area
//                 for a launch, worth a small, capped premium.
//   implied     = round(tvl_usd x baseMultiple x growthMult x maturityMult x breadthMult)
//
// A 0..100 conviction score travels with every row so a reader can sort by confidence, not just
// size: log-scaled TVL (35), seven-day momentum (25), age with no token (20), chain breadth (10)
// and the depth of the category's comp set (10). No protocol name is ever special-cased anywhere
// in this file: the same functions score every row, and the dashboard recomputes each row from
// the same inputs so page and board cannot drift apart.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's comparable set: how the snapshot's live tokens in it are priced against TVL. */
export interface CategoryComp {
  category: string;
  live_count: number;
  median_ratio: number;
  multiple: number;
}

/** The model's fixed constants, stated in the dashboard so a reader can audit the arithmetic. */
export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  shrink_comps: number;
  growth_rate: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  shrink_comps: 4,
  growth_rate: 0.006,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.55,
  maturity_range: 0.65,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_extra_chains: 7,
};

/** The model's version label: the dashboard names it and every row carries it. */
export const MODEL_VERSION = 'radar-2 conviction';

/** How many live-token protocols the comparables view carries, by market cap. */
export const LIVE_ROWS = 36;

/** One row of board.json: the ranked board's row, with the full model breakdown attached. */
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
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  conviction: number;
  signal: string;
  model: {
    base_multiple: number;
    category: string;
    comp_count: number;
    comp_median_ratio: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: everything the page renders, farm plan included. */
export interface RadarRow extends BoardRow {}

/** A live-token protocol: it already trades, so its market cap is a fact, not a model output. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** One thesis line for a top pick, generated from that protocol's own snapshot figures. */
export interface ThesisPick {
  rank: number;
  slug: string;
  name: string;
  headline: string;
  body: string;
}

/** Everything the dashboard renders: the board, the live comps, the model and the thesis. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_median_ratio: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_tvl_usd: number;
  median_implied_usd: number;
  categories: CategoryComp[];
  thesis: ThesisPick[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list, or null for an empty one. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The wrapped / staked / bridged product rule, mirroring the watchlist's own definition: a
 * product of a token that already trades is not a launch still to come, whatever its size.
 * WBTC, exchange bridges and staked-ETH wrappers record no token of their own in the snapshot,
 * yet ranking them as pre-token discoveries would be a category error, so the same exclusions
 * the house applied to the watchlist are applied here to every non-watchlist row.
 */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return false;
}

/** Whether a protocol may be ranked: pre-token, not an exchange, not a versioned pool, not a derivative product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name) && !isDerivativeProduct(p);
}

/**
 * The comparable sets: for every category, the live-token protocols in this snapshot and the
 * multiple their median market-cap / TVL ratio implies after shrinkage toward the global median.
 * Categories with no live comps fall back to the global median itself.
 */
export function categoryComps(snapshot: Snapshot, model: ModelConstants = MODEL): { comps: Map<string, CategoryComp>; globalMedian: number } {
  const liveRatios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    liveRatios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const globalMedian = median(liveRatios) ?? 0.2;
  const comps = new Map<string, CategoryComp>();
  for (const [category, ratios] of byCategory) {
    const med = median(ratios) ?? globalMedian;
    // Shrinkage: n comps pull the category median, shrink_comps phantom comps pull the global one.
    const shrunk = (med * ratios.length + globalMedian * model.shrink_comps) / (ratios.length + model.shrink_comps);
    comps.set(category, {
      category,
      live_count: ratios.length,
      median_ratio: round4(med),
      multiple: round4(clamp(shrunk, model.multiple_floor, model.multiple_cap)),
    });
  }
  return { comps, globalMedian };
}

/** The comp set one protocol is priced against, synthesising the fallback when its category has none. */
function compFor(p: SnapshotProtocol, comps: Map<string, CategoryComp>, globalMedian: number, model: ModelConstants): CategoryComp {
  const key = p.category ?? 'Uncategorised';
  const found = comps.get(key);
  if (found !== undefined) return found;
  return {
    category: key,
    live_count: 0,
    median_ratio: round4(globalMedian),
    multiple: round4(clamp(globalMedian, model.multiple_floor, model.multiple_cap)),
  };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comp: CategoryComp,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = clamp(finite(protocol.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = Math.exp(model.growth_rate * growthPct);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = clamp(protocol.chains.length - 1, 0, model.breadth_max_extra_chains);
  const breadthMult = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp.multiple * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A 0..100 conviction score from the same snapshot figures: size, momentum, age, breadth, comp depth. */
export function convictionOf(p: SnapshotProtocol, age: number | null, comp: CategoryComp): number {
  const size = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - 6.7) / (9.15 - 6.7), 0, 1) * 35;
  const growth = clamp(((finite(p.change_7d, 0) + 15) / 45), 0, 1) * 25;
  const ageForScore = age ?? 365;
  const maturity = clamp(ageForScore / 1460, 0, 1) * 20;
  const breadth = clamp((p.chains.length - 1) / 7, 0, 1) * 10;
  const depth = clamp(comp.live_count / 10, 0, 1) * 10;
  return Math.round(clamp(size + growth + maturity + breadth + depth, 0, 100));
}

/** A short signal label for the board, derived from the row's own figures, never from its name. */
export function signalOf(p: SnapshotProtocol, age: number | null, watchlist: boolean): string {
  const g = finite(p.change_7d, 0);
  if (watchlist && g >= 5) return 'Watchlist momentum';
  if (watchlist) return 'Watchlist';
  if (g >= 15) return 'Breakout growth';
  if (g >= 5) return 'Momentum';
  if (age !== null && age >= 1095) return 'Long pre-token run';
  if (p.tvl_usd >= 100_000_000) return 'Deep TVL, no token';
  if (g <= -10) return 'Cooling — size down';
  return 'Early radar';
}

// ------------------------------------------------------------------ farm plans
//
// Every plan is assembled from the protocol's own record: its category decides the core action,
// its primary chain decides the gas budget, its TVL decides the capital tier, its seven-day
// change decides the risk step, its age decides the hold, and its chain count decides whether a
// second-chain step appears. A deterministic per-slug pick rotates phrasing so two protocols in
// the same category do not read as photocopies, while the numbers stay exact for each row.

/** A small deterministic hash of a slug, so phrasing choices are stable between the two runs. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

const L1_CHAINS = new Set(['Ethereum', 'Bitcoin', 'Solana', 'BNB Chain', 'Tron', 'Avalanche']);

/** A realistic one-way gas estimate for the protocol's primary chain, in dollars. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 9;
  if (chain === 'Bitcoin') return 4;
  if (L1_CHAINS.has(chain)) return 2;
  return 1;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 300;
  if (p.tvl_usd >= 250_000_000) return 200;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 15_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 75;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's core farming action, in words a reader can execute. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${n} vault on ${chain}; curators route it to lending markets, and vault shares are the position to hold`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral on ${n} (${chain}), then borrow 30-40% against it once so both sides of the market register activity`;
  if (c.includes('dex') || c.includes('swap')) return `Add $${capital} of two-sided liquidity to ${n}'s highest-volume pool on ${chain} and make two small swaps a week through the same router`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC margin on ${n} and run one small hedged position (long spot, short perp) so volume and open interest both count`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC via ${n} to ${chain}, then use the bridged funds in one destination app instead of bridging straight back`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking')) return `Stake $${capital} of the native asset through ${n} on ${chain} and hold the liquid receipt token in the same wallet, unstaked and unlooped`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it; RWA positions usually qualify by balance and holding time, not by churn`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s main vault on ${chain} and leave auto-compounding on; yield vaults reward duration over transaction count`;
  if (c.includes('stable')) return `Mint or deposit $${capital} through ${n} on ${chain} and hold the stable asset; add one redemption-and-remint cycle mid-hold to register as an active user`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take small positions in three liquid markets, letting at least one settle before withdrawing anything`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} for a 60-90 day term and hold the policy NFT in the farming wallet until it expires`;
  if (c.includes('payments')) return `Route $${capital} of real payments through ${n} over the hold period in at least six separate transactions, not one lump transfer`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${n} on ${chain}, keep the shielded balance for the full hold, and withdraw to the same wallet that deposited`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main app and keep the position open; use the protocol's core function, not a one-off page`;
}

/** A whole-dollar figure with thousands separators, for plan text. */
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * A protocol's farm plan: seven steps, each an action with its cost and its time, every number
 * taken from the row itself (TVL, 7d change, age, chains, implied value, conviction inputs).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number, watchlist: boolean): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdDaysFor(age);
  const g = finite(p.change_7d, 0);
  const pick = slugHash(p.slug) % 3;
  const ageText = age === null ? 'an unreported listing date' : age >= 365 ? `${(age / 365).toFixed(1)} years tracked with no token` : `${age} days tracked with no token`;
  const steps: string[] = [];

  const walletLines = [
    `Set up one fresh wallet for ${p.name} only, funded with ${usd(capital)} plus gas; a dedicated wallet keeps this farm separable from your main funds. Cost: about ${usd(gas)} gas to fund. Time: 10 minutes.`,
    `Create a dedicated wallet for this farm and label it for ${p.name}; keep the seed offline and never reuse it for unrelated airdrops. Cost: about ${usd(gas)} gas to fund. Time: 10 minutes.`,
    `Use a clean wallet that holds only this position: ${usd(capital)} of working capital plus a small gas buffer for ${chain}. Cost: about ${usd(gas)} gas to fund. Time: 10 minutes.`,
  ];
  steps.push(walletLines[pick]!);

  steps.push(`${actionFor(p, capital, chain)}. Cost: ${usd(capital)} of capital plus about ${usd(gas * 2)} of gas. Time: 20 minutes to set up.`);

  if (g >= 5) {
    steps.push(`Momentum check: ${p.name}'s TVL grew ${g.toFixed(1)}% in the last 7 days to ${usd(p.tvl_usd)}. Ride it, but add the position in two tranches a week apart instead of all at once. Cost: no extra capital beyond step 2. Time: 5 minutes twice.`);
  } else if (g <= -5) {
    steps.push(`Risk check before sizing up: ${p.name}'s TVL fell ${Math.abs(g).toFixed(1)}% in 7 days to ${usd(p.tvl_usd)}. Start with half the step-2 amount and add the rest only if TVL stabilises for two weekly checks. Cost: half capital until confirmed. Time: 5 minutes a week.`);
  } else {
    steps.push(`Baseline check: ${p.name} holds ${usd(p.tvl_usd)} of TVL with a ${g >= 0 ? '+' : ''}${g.toFixed(1)}% seven-day move — steady, not chasing. Enter the full step-2 amount in one transaction. Cost: included in step 2. Time: 5 minutes.`);
  }

  steps.push(`Repeat one qualifying action every week for the whole hold — a top-up, a borrow adjustment, a swap or a governance vote on ${chain} — so the wallet shows a pattern, not a single touch. Cost: about ${usd(gas)} of gas a week. Time: 10 minutes a week.`);

  if (p.chains.length > 1) {
    steps.push(`Use a second chain: ${p.name} runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')}${p.chains.length > 3 ? '…' : ''}). Repeat a small ${usd(Math.max(25, Math.round(capital / 4)))} action on ${p.chains[1]} so the wallet is visible in two deployments. Cost: about ${usd(gasFor(p.chains[1]!))} of gas. Time: 15 minutes once.`);
  } else {
    steps.push(`Deepen the single-chain position instead of spreading thin: after 3 weeks, add ${usd(Math.round(capital / 2))} more on ${chain} so balance growth, not just presence, is on record. Cost: ${usd(Math.round(capital / 2))} extra capital plus ${usd(gas)} gas. Time: 10 minutes once.`);
  }

  steps.push(`Hold for at least ${hold} days. ${p.name} has ${ageText}, and this model's implied value for it is ${usd(implied)}${watchlist ? ' — it sits on the $50M+ watchlist, so treat the hold as the priority farm in this batch' : ''}. Exiting early forfeits the duration most snapshots reward. Cost: the capital stays locked in the position. Time: ${hold} days.`);

  steps.push(`Exit discipline: check ${p.name}'s own announcements and points page weekly, claim only from links the protocol itself publishes, and never pay a third party to claim. Log wallet, dates and tx hashes as you go. Cost: nothing to check, never pay to claim. Time: 5 minutes a week.`);

  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ------------------------------------------------------------------ the board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n and no ties left unordered. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const { comps, globalMedian } = categoryComps(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const comp = compFor(p, comps, globalMedian, model);
    const v = impliedValue(p, snapshot.as_of, comp, model);
    return { p, comp, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    conviction: convictionOf(s.p, s.age, s.comp),
    signal: signalOf(s.p, s.age, watch.has(s.p.slug)),
    model: {
      base_multiple: s.comp.multiple,
      category: s.comp.category,
      comp_count: s.comp.live_count,
      comp_median_ratio: s.comp.median_ratio,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
    },
    farm_steps: farmSteps(s.p, s.age, s.implied, watch.has(s.p.slug)),
  }));
}

/** The thesis: the top five picks, each argued from its own figures, plus the model's one-line claim. */
export function buildThesis(board: BoardRow[], snapshot: Snapshot): ThesisPick[] {
  return board.slice(0, 5).map((r) => {
    const g = finite(r.change_7d, 0);
    const ageText = r.age_days === null ? 'an unreported age' : r.age_days >= 365 ? `${(r.age_days / 365).toFixed(1)} years` : `${r.age_days} days`;
    const headline = `${r.name}: ${usd(r.implied_value_usd)} implied on ${usd(r.tvl_usd)} of TVL`;
    const body =
      `${r.category ?? 'Uncategorised'} protocols with a live token trade at a median ${r.model.comp_median_ratio}x TVL in this snapshot ` +
      `(${r.model.comp_count} comps), which prices ${r.name}'s base at ${r.model.base_multiple}x. ` +
      `Seven-day TVL momentum of ${g >= 0 ? '+' : ''}${g.toFixed(1)}% moves it by x${r.model.growth_multiplier}, ` +
      `${ageText} with no token by x${r.model.maturity_multiplier}, across ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}. ` +
      `Conviction ${r.conviction}/100. The farm is a ${holdDaysFor(r.age_days)}-day hold built on its ${r.chains[0] ?? 'main'} deployment — see its plan on the board.`;
    return { rank: r.rank, slug: r.slug, name: r.name, headline, body };
  });
}

/** The live-token protocols, by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { comps, globalMedian } = categoryComps(snapshot, model);
  const categories = [...comps.values()].sort((a, b) => b.live_count - a.live_count || (a.category < b.category ? -1 : 1));
  const impliedSorted = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_median_ratio: round4(globalMedian),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    total_tvl_usd: board.reduce((n, r) => n + r.tvl_usd, 0),
    median_implied_usd: impliedSorted.length > 0 ? impliedSorted[Math.floor(impliedSorted.length / 2)]! : 0,
    categories,
    thesis: buildThesis(board, snapshot),
    rows: board,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
