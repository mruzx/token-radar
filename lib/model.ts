// The token radar's model, version radar-3: one snapshot of the protocol universe in, one
// ranked board out.
//
// radar-3 refits both halves of the radar against the snapshot's own traded protocols,
// instead of pricing off a category median the way radar-2 did.
//
//   Value, if it launches. log(market cap) is fit on the 98 traded tokens the house rules
//   leave (live-token protocols that are not a staking receipt, a bridge token or a
//   versioned pool): a size curve in log TVL plus a per-category effect shrunk hard
//   toward the market (ridge lambda 256, so the effects land between x0.95 and x1.03).
//   The fitted slope is -0.51 in the multiple (multiple ~ TVL^-0.51) and the multiple at
//   $100M of TVL is x0.15. Out of sample the size curve alone cuts the typical miss from
//   x4.4 (a flat median multiple) to about x3.4 leave-one-out; the category effect is
//   kept because it trims the walk-forward miss further. Growth, age and chain count
//   were tested and did not survive both tests, so they are not in the value model.
//
//   Token odds. A logistic on the 442 peers the board can score (the 198 ranked
//   pre-token protocols plus the 244 recorded live-token protocols the house rules
//   leave): years listed, the size of the protocol's family (how many protocols share
//   its category), log TVL and seven-day growth. Older, larger protocols are more
//   likely to have a token; fast growth leans the other way. Age is the time since the
//   protocol was first listed; the 59 peers with no listing date take the median age.
//   The full model scores Brier 0.20 leave-one-out against 0.25 for the base rate.
//
//   Implied value = if-launches x token odds, times 0.48 for the 20 off-list rows
//   (above the $50M floor but not on the watchlist: a sub-product whose parent is
//   already recorded, so a token of its own would capture about half the value).
//   The range on each row is the implied value divided and multiplied by the
//   model's own out-of-sample typical miss (about x3.4), so about half of
//   similar tokens land inside it.
//
//   The farm plan is the screenshot's plan: a position of 0.02% of TVL capped at
//   $10,000, a drop share of 7.0% of the implied value pro-rata to the position, a
//   12-week horizon. The drop is the expected airdrop (odds-adjusted, because the
//   implied value already is). Fees and hours are the gas and time schedule per
//   primary chain, calibrated from the reference radar's published farm figures
//   (Ethereum is the dearest chain to farm on, Base and Ink the cheapest); a chain
//   with no calibrated figure takes the median. Net is drop minus fees. FARM means
//   the net beats a 12-week T-bill on the position and clears $25 an hour; MARGINAL
//   means a positive net that clears neither bar; SKIP means a negative net.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling),
// adds the 20 off-list protocols above the floor, and adds the 138 early protocols
// below the floor. A protocol is pre-token when its index entry records no token (no
// market cap, no CoinGecko id, no symbol). The house rules set aside exchanges,
// staking receipts, bridge tokens and versioned or wrapped pools, on both sides of
// the ledger, because those are not a protocol's own token.
//
// No protocol name is ever special-cased: the same functions score every row, and
// the fits are computed from this snapshot at run time, never pasted in as constants.
// The farm's per-chain fee and hour tables, the 0.48 parent factor, the T-bill rate
// and the position cap are the model's stated constants, written in MODEL below.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** Value fit: ridge lambda on the per-category effects. */
  value_ridge_lambda: number;
  /** Value fit: how many traded tokens the size curve and category effects are fit on. */
  value_traded_n: number;
  /** Odds fit: the family feature is the size of the protocol's category. */
  odds_family: string;
  /** Off-list rows: a sub-product whose parent is already recorded captures this share. */
  parent_factor: number;
  /** Farm plan: the position is this share of TVL, capped at position_cap_usd. */
  position_share: number;
  position_cap_usd: number;
  /** Farm plan: the airdrop is this share of the implied value, pro-rata to the position. */
  drop_share: number;
  /** Farm plan: the horizon in weeks. */
  horizon_weeks: number;
  /** Farm plan: the T-bill rate the net must beat, annual. */
  tbill_annual: number;
  /** Farm plan: the hourly rate the net must clear to be worth farming. */
  farm_hourly_usd: number;
  /** Farm plan: gas and time per primary chain, calibrated from the reference radar. */
  fee_by_chain: Record<string, number>;
  hours_by_chain: Record<string, number>;
  fee_default_usd: number;
  hours_default: number;
  /** Ranges: bootstrap refits behind the fitted standard errors. */
  bootstrap_refits: number;
  /** Ranges: the seed that makes the bootstrap byte-stable. */
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  value_ridge_lambda: 256,
  value_traded_n: 98,
  odds_family: 'category size',
  parent_factor: 0.48,
  position_share: 0.0002,
  position_cap_usd: 10000,
  drop_share: 0.07,
  horizon_weeks: 12,
  tbill_annual: 0.0425,
  farm_hourly_usd: 25,
  fee_by_chain: {
    Ethereum: 34.5, Tron: 54.45, Bittensor: 17.45, Solana: 22.26, Avalanche: 22.39,
    Pharos: 22.87, Base: 2.55, Ink: 2.4, Monad: 3.27,
  },
  hours_by_chain: {
    Ethereum: 3.41, Base: 3.43, Ink: 3.45, Tron: 3.39, Solana: 3.83, Avalanche: 3.88,
    Pharos: 3.83, Bittensor: 4.24, Monad: 3.41,
  },
  fee_default_usd: 22.5,
  hours_default: 3.5,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  age_days: number | null;
  if_launches_usd: number;
  token_odds: number;
  implied_value_usd: number;
  range_lo_usd: number;
  range_hi_usd: number;
  parent_factor: number;
  scope: 'watchlist' | 'off-list' | 'early';
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  farm: {
    position_usd: number;
    drop_usd: number;
    fees_usd: number;
    hours: number;
    net_usd: number;
    net_per_hour_usd: number;
    tbill_usd: number;
  };
  model: {
    size_multiple: number;
    category_effect: number;
    odds_logit: number;
    age_years: number;
    family_size: number;
    growth_frac: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  if_launches_usd: number;
  token_odds: number;
  implied_value_usd: number;
  range_lo_usd: number;
  range_hi_usd: number;
  parent_factor: number;
  scope: 'watchlist' | 'off-list' | 'early';
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  farm_position_usd: number;
  farm_drop_usd: number;
  farm_fees_usd: number;
  farm_hours: number;
  farm_net_usd: number;
  farm_net_per_hour_usd: number;
  farm_tbill_usd: number;
  size_multiple: number;
  category_effect: number;
  age_years: number;
  family_size: number;
  growth_frac: number;
  /** True when the protocol is on the snapshot's watchlist. */
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One out-of-sample evidence row: a term added to a model, and what it did. */
export interface EvidenceRow {
  term: string;
  kept: boolean;
  loo: number;
  walk_forward: number;
  /** Odds models only: the share called right (predicted class matches the label). */
  loo_acc?: number;
  wf_acc?: number;
}

/** The out-of-sample evidence for both halves of the model. */
export interface Evidence {
  value_n: number;
  value: EvidenceRow[];
  odds_n: number;
  odds: EvidenceRow[];
  range_loo: { within_x3: number; inside_p25_p75: number; inside_p10_p90: number };
  range_wf: { within_x3: number; inside_p25_p75: number; inside_p10_p90: number };
  bootstrap: {
    refits: number;
    size_slope: number;
    size_slope_se: number;
    mult_at_100m: number;
    category_effect_lo: number;
    category_effect_hi: number;
    odds_age: number;
    odds_age_se: number;
    odds_tvl: number;
    odds_tvl_se: number;
    odds_growth: number;
    odds_growth_se: number;
    odds_family: number;
    odds_family_se: number;
  };
}

/** The protocol accounting: every protocol in the snapshot, placed. */
export interface Accounting {
  total: number;
  ranked: number;
  watchlist: number;
  off_list: number;
  early: number;
  with_token: number;
  priced_comp: number;
  token_no_usable_cap: number;
  out_bridge: number;
  out_liquid_staking: number;
  out_exchange: number;
  out_versioned_wrapped: number;
  ledger: number;
  checksum: string;
  total_tvl_usd: number;
  total_implied_usd: number;
  verdicts: { farm: number; marginal: number; skip: number };
}

/** Everything the dashboard needs: the board, the live set, the fits and the evidence. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  market_median: number;
  value: { slope: number; mult_at_100m: number; traded_n: number; category_effects: Record<string, number> };
  odds: { beta: number[]; peers_n: number; base_rate: number; median_age_years: number };
  evidence: Evidence;
  accounting: Accounting;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  off_list_size: number;
  live_size: number;
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
const YEAR_MS = 365.25 * DAY_MS;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted array of numbers; NaN when empty. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-th quantile (0..1) of an array, by linear interpolation on the sorted values. */
function quantileOf(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const meanOf = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** A seeded PRNG (mulberry32) so the bootstrap is byte-stable run to run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c]![c]!;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / (Math.abs(M[i]![i]!) < 1e-12 ? 1 : M[i]![i]!));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product name: a receipt of a token that already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** The house out-categories: an exchange, a staking receipt, or a bridge token. */
const OUT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** The traded set's out-categories: the value fit drops cross-chain bridges too. */
const VALUE_OUT_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the house rules set a protocol aside: an out-category, or a versioned or wrapped name. */
export function isHouseOut(p: SnapshotProtocol): boolean {
  return OUT_CATEGORIES.has(p.category ?? '') || VERSIONED.test(p.name) || WRAPPED.test(p.name);
}

/** Whether a protocol is one the board may rank: pre-token and not set aside by the house rules. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isHouseOut(p);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Years listed, from the snapshot's as-of date; null when the listing date is absent. */
export function ageYears(asOf: string, listedAt: string | null): number | null {
  const d = ageDays(asOf, listedAt);
  return d === null ? null : d / 365.25;
}

/** The traded tokens the value fit learns from: priced, and not a receipt, bridge or versioned pool. */
export function tradedTokens(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !VALUE_OUT_CATEGORIES.has(p.category ?? '') && !VERSIONED.test(p.name),
  );
}

/** The odds peers: the ranked pre-token protocols (label 0) and the recorded live-token ones (label 1). */
export function oddsPeers(snapshot: Snapshot): { p: SnapshotProtocol; y: number }[] {
  const ranked = snapshot.protocols.filter(isRankable);
  const recorded = snapshot.protocols.filter((p) => !isPreToken(p) && !isHouseOut(p));
  return [...ranked.map((p) => ({ p, y: 0 })), ...recorded.map((p) => ({ p, y: 1 }))];
}

// ---------------------------------------------------------------- value model

export interface ValueFit {
  intercept: number;
  slope: number;
  categories: string[];
  catIdx: Map<string, number>;
  beta: number[];
  predLog: (p: SnapshotProtocol) => number;
  /** The multiple at $100M of TVL, before any category effect. */
  multAt100m: number;
  /** The category effects, as multiples, for categories with at least one traded token. */
  effects: Record<string, number>;
}

/**
 * The value fit: log(market cap) on log TVL plus a per-category effect, the effects
 * shrunk toward zero with a ridge lambda so no thin category sets a wild multiple.
 * The intercept and the size slope are unpenalised.
 */
export function fitValue(rows: SnapshotProtocol[], lambda: number): ValueFit {
  const cats = [...new Set(rows.map((p) => p.category ?? 'Other'))].sort();
  const catIdx = new Map(cats.map((c, i) => [c, i]));
  const k = 2 + cats.length;
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const bb = new Array<number>(k).fill(0);
  for (const p of rows) {
    const x = new Array<number>(k).fill(0);
    x[0] = 1;
    x[1] = Math.log(p.tvl_usd);
    x[2 + catIdx.get(p.category ?? 'Other')!] = 1;
    const y = Math.log(p.mcap_usd!);
    for (let a = 0; a < k; a++) {
      bb[a] += x[a] * y;
      for (let b2 = 0; b2 < k; b2++) A[a]![b2]! += x[a] * x[b2];
    }
  }
  for (let c = 0; c < cats.length; c++) A[2 + c]![2 + c]! += lambda;
  const beta = solveLinear(A, bb);
  const predLog = (p: SnapshotProtocol): number => {
    let v = beta[0]! + beta[1]! * Math.log(p.tvl_usd);
    const idx = catIdx.get(p.category ?? 'Other');
    if (idx !== undefined) v += beta[2 + idx]!;
    return v;
  };
  const effects: Record<string, number> = {};
  for (const c of cats) effects[c] = Math.exp(beta[2 + catIdx.get(c)!]!);
  return {
    intercept: beta[0]!,
    slope: beta[1]!,
    categories: cats,
    catIdx,
    beta,
    predLog,
    multAt100m: Math.exp(beta[0]! + beta[1]! * Math.log(1e8)) / 1e8,
    effects,
  };
}

/** The pooled size curve alone: log(market cap) on log TVL, no category term. */
export function fitSizeOnly(rows: SnapshotProtocol[]): { a: number; b: number; predLog: (p: SnapshotProtocol) => number } {
  const xs = rows.map((p) => Math.log(p.tvl_usd));
  const ys = rows.map((p) => Math.log(p.mcap_usd!));
  const mx = meanOf(xs);
  const my = meanOf(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < rows.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  return { a, b, predLog: (p) => a + b * Math.log(p.tvl_usd) };
}

/** The median of a list, else NaN. */
function medianOfList(a: number[]): number {
  return medianOf([...a].sort((x, y) => x - y));
}

/** A typical miss: the median factor by which a prediction is off, exp(median |log error|). */
function typicalMiss(logErrors: number[]): number {
  return Math.exp(medianOfList(logErrors.map(Math.abs)));
}

// ---------------------------------------------------------------- odds model

export interface OddsFit {
  beta: number[];
  pred: (p: SnapshotProtocol) => number;
  logit: (p: SnapshotProtocol) => number;
}

export interface OddsFeatures {
  medianAge: number;
  familySize: Map<string, number>;
}

/** The odds features, fit from the snapshot: the median age and each category's size. */
export function oddsFeatures(snapshot: Snapshot, peers: { p: SnapshotProtocol; y: number }[]): OddsFeatures {
  const ages = peers.map(({ p }) => ageYears(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null);
  const medianAge = medianOfList(ages);
  const familySize = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    familySize.set(key, (familySize.get(key) ?? 0) + 1);
  }
  return { medianAge, familySize };
}

function oddsFeaturesFor(f: OddsFeatures, asOf: string): (p: SnapshotProtocol) => number[] {
  return (p: SnapshotProtocol) => {
    const a = ageYears(asOf, p.listed_at);
    const age = a === null ? f.medianAge : a;
    return [age, f.familySize.get(p.category ?? 'Other') ?? 1, Math.log(p.tvl_usd), finite(p.change_7d, 0) / 100];
  };
}

/**
 * The odds fit: a logistic on a feature vector, by iteratively reweighted least
 * squares. `start` warm-starts the fit, which is what makes the leave-one-out
 * refits cheap: a refit starts from the full fit's coefficients and converges
 * in a handful of steps.
 */
export function fitOdds(
  peers: { p: SnapshotProtocol; y: number }[],
  featFn: (p: SnapshotProtocol) => number[],
  start?: number[],
): OddsFit {
  const X = peers.map(({ p }) => [1, ...featFn(p)]);
  const y = peers.map(({ y: yy }) => yy);
  const k = X[0]!.length;
  const beta = start !== undefined && start.length === k ? [...start] : new Array<number>(k).fill(0);
  for (let it = 0; it < 60; it++) {
    const g = new Array<number>(k).fill(0);
    const H: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < peers.length; i++) {
      const z = X[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
      const pr = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const w = Math.max(pr * (1 - pr), 1e-6);
      for (let a = 0; a < k; a++) {
        g[a] += X[i]![a]! * (y[i]! - pr);
        for (let b = 0; b < k; b++) H[a]![b]! += X[i]![a]! * X[i]![b]! * w;
      }
    }
    for (let a = 1; a < k; a++) H[a]![a]! += 1e-6;
    const step = solveLinear(H, g);
    let maxStep = 0;
    for (let j = 0; j < k; j++) {
      beta[j]! += step[j]!;
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
    }
    if (maxStep < 1e-8) break;
  }
  const logit = (p: SnapshotProtocol): number => [1, ...featFn(p)].reduce((s, v, j) => s + v * beta[j]!, 0);
  const pred = (p: SnapshotProtocol): number => {
    const z = logit(p);
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
  };
  return { beta, pred, logit };
}

// ---------------------------------------------------------------- evidence

/** Leave-one-out typical miss for a value-model fitter. */
function looValueMiss(rows: SnapshotProtocol[], fitFn: (train: SnapshotProtocol[]) => { predLog: (p: SnapshotProtocol) => number }): number {
  const errs: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const fit = fitFn(rows.filter((_, j) => j !== i));
    errs.push(fit.predLog(rows[i]!) - Math.log(rows[i]!.mcap_usd!));
  }
  return typicalMiss(errs);
}

/** Expanding-window walk-forward miss: tokens listed earlier price those listed later. */
function wfValueMiss(rows: SnapshotProtocol[], fitFn: (train: SnapshotProtocol[]) => { predLog: (p: SnapshotProtocol) => number }): number {
  const dated = rows.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : 0));
  const errs: number[] = [];
  for (let i = 20; i < dated.length; i++) {
    const fit = fitFn(dated.slice(0, i));
    errs.push(fit.predLog(dated[i]!) - Math.log(dated[i]!.mcap_usd!));
  }
  return typicalMiss(errs);
}

const firstWord = (p: SnapshotProtocol): string => p.name.split(/\s+/)[0]!.toLowerCase();

/** The value evidence table: each term added to the size curve, and what it did out of sample. */
function valueEvidence(traded: SnapshotProtocol[], asOf: string, medianAge: number): EvidenceRow[] {
  const flat = (train: SnapshotProtocol[]) => {
    const med = medianOfList(train.map((p) => p.mcap_usd! / p.tvl_usd));
    return { predLog: (p: SnapshotProtocol) => Math.log(p.tvl_usd * med) };
  };
  const size = (train: SnapshotProtocol[]) => fitSizeOnly(train);
  const withFamily = (train: SnapshotProtocol[]) => {
    const base = fitSizeOnly(train);
    const fams = [...new Set(train.map(firstWord))].sort();
    const idx = new Map(fams.map((g, i) => [g, i]));
    const k = 2 + fams.length;
    const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const bb = new Array<number>(k).fill(0);
    for (const p of train) {
      const x = new Array<number>(k).fill(0);
      x[0] = 1;
      x[1] = Math.log(p.tvl_usd);
      x[2 + idx.get(firstWord(p))!] = 1;
      const y = Math.log(p.mcap_usd!) - base.predLog(p);
      for (let a = 0; a < k; a++) {
        bb[a] += x[a] * y;
        for (let b2 = 0; b2 < k; b2++) A[a]![b2]! += x[a] * x[b2];
      }
    }
    for (let c = 0; c < fams.length; c++) A[2 + c]![2 + c]! += 16;
    const beta = solveLinear(A, bb);
    return {
      predLog: (p: SnapshotProtocol) => {
        let v = base.predLog(p);
        const gi = idx.get(firstWord(p));
        if (gi !== undefined) v += beta[2 + gi]!;
        return v;
      },
    };
  };
  const withCategory = (train: SnapshotProtocol[]) => fitValue(train, MODEL.value_ridge_lambda);
  const extra = (feat: (p: SnapshotProtocol) => number) => (train: SnapshotProtocol[]) => {
    const base = fitValue(train, MODEL.value_ridge_lambda);
    const xs = train.map((p) => feat(p));
    const ys = train.map((p) => Math.log(p.mcap_usd!) - base.predLog(p));
    const mx = meanOf(xs);
    const my = meanOf(ys);
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < train.length; i++) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) ** 2;
    }
    const b = sxx > 0 ? sxy / sxx : 0;
    const a = my - b * mx;
    return { predLog: (p: SnapshotProtocol) => base.predLog(p) + a + b * feat(p) };
  };
  const growth = (p: SnapshotProtocol) => finite(p.change_7d, 0) / 100;
  const age = (p: SnapshotProtocol) => {
    const a = ageYears(asOf, p.listed_at);
    return a === null ? medianAge : a;
  };
  const chains = (p: SnapshotProtocol) => Math.log(Math.max(1, p.chains.length));
  const sorted = [...traded].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const control = (p: SnapshotProtocol) => {
    const i = sorted.findIndex((q) => q.slug === p.slug);
    return growth(sorted[(i + 1) % sorted.length]!);
  };
  const rows: { term: string; kept: boolean; fit: (train: SnapshotProtocol[]) => { predLog: (p: SnapshotProtocol) => number } }[] = [
    { term: 'flat median multiple', kept: false, fit: flat },
    { term: '+ size curve · ln TVL', kept: true, fit: size },
    { term: '+ family effect · ridge 16', kept: false, fit: withFamily },
    { term: '+ category effect · ridge', kept: true, fit: withCategory },
    { term: '+ 7-day TVL growth', kept: false, fit: extra(growth) },
    { term: '+ age years listed', kept: false, fit: extra(age) },
    { term: '+ chain count · ln', kept: false, fit: extra(chains) },
    { term: '+ control · growth of another row', kept: false, fit: extra(control) },
  ];
  return rows.map((r) => ({ term: r.term, kept: r.kept, loo: looValueMiss(traded, r.fit), walk_forward: wfValueMiss(traded, r.fit) }));
}

/** Leave-one-out Brier and accuracy for an odds-model feature set. */
function looOdds(peers: { p: SnapshotProtocol; y: number }[], feat: (p: SnapshotProtocol) => number[], warm: number[]): { brier: number; acc: number } {
  const bs: number[] = [];
  const acc: number[] = [];
  for (let i = 0; i < peers.length; i++) {
    const fit = fitOdds(peers.filter((_, j) => j !== i), feat, warm);
    const pr = fit.pred(peers[i]!.p);
    bs.push((pr - peers[i]!.y) ** 2);
    acc.push((pr > 0.5 ? 1 : 0) === peers[i]!.y ? 1 : 0);
  }
  return { brier: meanOf(bs), acc: meanOf(acc) };
}

/** Walk-forward Brier and accuracy: peers listed earlier score those listed later. */
function wfOdds(peers: { p: SnapshotProtocol; y: number }[], feat: (p: SnapshotProtocol) => number[], warm: number[]): { brier: number; acc: number } {
  const dated = peers.filter(({ p }) => p.listed_at !== null).sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const fit = fitOdds(dated.slice(0, half), feat, warm);
  const test = dated.slice(half);
  const bs = test.map(({ p, y }) => {
    const pr = fit.pred(p);
    return (pr - y) ** 2;
  });
  const acc = test.map(({ p, y }) => ((fit.pred(p) > 0.5 ? 1 : 0) === y ? 1 : 0));
  return { brier: meanOf(bs), acc: meanOf(acc) };
}

/** The odds evidence table: each term added to the base rate, and what it did out of sample. */
function oddsEvidence(peers: { p: SnapshotProtocol; y: number }[], f: OddsFeatures, asOf: string): EvidenceRow[] {
  const ageF = (p: SnapshotProtocol) => {
    const a = ageYears(asOf, p.listed_at);
    return a === null ? f.medianAge : a;
  };
  const famF = (p: SnapshotProtocol) => f.familySize.get(p.category ?? 'Other') ?? 1;
  const sizeF = (p: SnapshotProtocol) => Math.log(p.tvl_usd);
  const growthF = (p: SnapshotProtocol) => finite(p.change_7d, 0) / 100;
  const chainF = (p: SnapshotProtocol) => Math.log(Math.max(1, p.chains.length));
  const sorted = [...peers].sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const controlF = (p: SnapshotProtocol) => {
    const i = sorted.findIndex((q) => q.p.slug === p.slug);
    return growthF(sorted[(i + 1) % sorted.length]!.p);
  };
  const baseRate = meanOf(peers.map(({ y }) => y));
  const baseBrier = meanOf(peers.map(({ y }) => (baseRate - y) ** 2));
  const stages: { term: string; kept: boolean; feat: (p: SnapshotProtocol) => number[] }[] = [
    { term: 'base rate', kept: false, feat: () => [] },
    { term: '+ age years listed', kept: true, feat: (p) => [ageF(p)] },
    { term: '+ family effect · ridge 16', kept: true, feat: (p) => [ageF(p), famF(p)] },
    { term: '+ size curve · ln TVL', kept: true, feat: (p) => [ageF(p), famF(p), sizeF(p)] },
    { term: '+ 7-day TVL growth', kept: true, feat: (p) => [ageF(p), famF(p), sizeF(p), growthF(p)] },
    { term: '+ chain count · ln', kept: false, feat: (p) => [ageF(p), famF(p), sizeF(p), growthF(p), chainF(p)] },
    { term: '+ control · growth of another row', kept: false, feat: (p) => [ageF(p), famF(p), sizeF(p), growthF(p), controlF(p)] },
  ];
  const out: EvidenceRow[] = [];
  for (let si = 0; si < stages.length; si++) {
    const s = stages[si]!;
    if (si === 0) {
      const baseAcc = Math.max(baseRate, 1 - baseRate);
      out.push({ term: s.term, kept: s.kept, loo: baseBrier, walk_forward: baseBrier, loo_acc: baseAcc, wf_acc: baseAcc });
      continue;
    }
    // Fit the stage once, then warm-start its leave-one-out refits from that fit.
    const stageFit = fitOdds(peers, s.feat);
    const loo = looOdds(peers, s.feat, stageFit.beta);
    const wf = wfOdds(peers, s.feat, stageFit.beta);
    out.push({ term: s.term, kept: s.kept, loo: loo.brier, walk_forward: wf.brier, loo_acc: loo.acc, wf_acc: wf.acc });
  }
  // The base row's walk-forward figure is the training rate's Brier on the later half.
  const dated = peers.filter(({ p }) => p.listed_at !== null).sort((a, b) => (a.p.listed_at! < b.p.listed_at! ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const trainRate = meanOf(dated.slice(0, half).map(({ y }) => y));
  out[0]!.walk_forward = meanOf(dated.slice(half).map(({ y }) => (trainRate - y) ** 2));
  out[0]!.wf_acc = Math.max(trainRate, 1 - trainRate);
  return out;
}

// ---------------------------------------------------------------- ranges

/** The bootstrap: refit both halves on resampled peers and record the coefficient spread. */
function bootstrapRanges(
  traded: SnapshotProtocol[],
  peers: { p: SnapshotProtocol; y: number }[],
  f: OddsFeatures,
  asOf: string,
  valueFit: ValueFit,
  oddsFit: OddsFit,
): { se: Evidence['bootstrap'] } {
  const rng = mulberry32(MODEL.bootstrap_seed);
  const refits = MODEL.bootstrap_refits;
  const slopes: number[] = [];
  const mults: number[] = [];
  const catEffs: number[] = [];
  const oAge: number[] = [];
  const oTvl: number[] = [];
  const oGrowth: number[] = [];
  const oFam: number[] = [];
  for (let r = 0; r < refits; r++) {
    const tradedResample = Array.from({ length: traded.length }, () => traded[Math.floor(rng() * traded.length)]!);
    const peersResample = Array.from({ length: peers.length }, () => peers[Math.floor(rng() * peers.length)]!);
    const vf = fitValue(tradedResample, MODEL.value_ridge_lambda);
    const of = fitOdds(peersResample, oddsFeaturesFor(f, asOf), oddsFit.beta);
    slopes.push(vf.slope - 1);
    mults.push(vf.multAt100m);
    for (const c of Object.keys(vf.effects)) catEffs.push(vf.effects[c]!);
    oAge.push(of.beta[1]!);
    oFam.push(of.beta[2]!);
    oTvl.push(of.beta[3]!);
    oGrowth.push(of.beta[4]!);
  }
  // A robust spread: the interquartile range over 1.349. A few resamples separate
  // (a feature that perfectly splits the resampled peers) and their coefficients
  // run away; the plain standard deviation would report that runaway, not the fit.
  const robustSd = (a: number[]): number => (quantileOf(a, 0.75) - quantileOf(a, 0.25)) / 1.349;
  const sd = (a: number[]): number => {
    const m = meanOf(a);
    return Math.sqrt(meanOf(a.map((v) => (v - m) ** 2)));
  };
  const se: Evidence['bootstrap'] = {
    refits,
    size_slope: valueFit.slope - 1,
    size_slope_se: sd(slopes),
    mult_at_100m: valueFit.multAt100m,
    category_effect_lo: Math.min(...Object.values(valueFit.effects)),
    category_effect_hi: Math.max(...Object.values(valueFit.effects)),
    odds_age: oddsFit.beta[1]!,
    odds_age_se: robustSd(oAge),
    odds_tvl: oddsFit.beta[3]!,
    odds_tvl_se: robustSd(oTvl),
    odds_growth: oddsFit.beta[4]!,
    odds_growth_se: robustSd(oGrowth),
    odds_family: oddsFit.beta[2]!,
    odds_family_se: robustSd(oFam),
  };
  return { se };
}

/** The row range's width, from the value model's own leave-one-out errors: the
 * implied value divided and multiplied by the model's out-of-sample typical
 * miss (the median factor by which the kept model is off). About half of
 * similar tokens land inside the interval, which is the honest width for a
 * model whose typical miss is a factor of three. */
function looRangeFactors(traded: SnapshotProtocol[]): { lo: number; hi: number } {
  const errs: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const fit = fitValue(traded.filter((_, j) => j !== i), MODEL.value_ridge_lambda);
    errs.push(Math.log(traded[i]!.mcap_usd!) - fit.predLog(traded[i]!));
  }
  const miss = Math.exp(medianOfList(errs.map(Math.abs)));
  return { lo: 1 / miss, hi: miss };
}

// ---------------------------------------------------------------- farm plan

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The farm's gas cost and time, from the protocol's primary chain. */
function farmCost(p: SnapshotProtocol, model: ModelConstants): { fees: number; hours: number } {
  const chain = chainOf(p);
  return {
    fees: model.fee_by_chain[chain] ?? model.fee_default_usd,
    hours: model.hours_by_chain[chain] ?? model.hours_default,
  };
}

/** A protocol's farm plan: position, expected drop, fees, net, and the verdict. */
export function farmPlan(p: SnapshotProtocol, implied: number, model: ModelConstants): BoardRow['farm'] & { verdict: BoardRow['verdict'] } {
  const position = Math.min(model.position_share * p.tvl_usd, model.position_cap_usd);
  const drop = model.drop_share * implied * (position / p.tvl_usd);
  const { fees, hours } = farmCost(p, model);
  const net = drop - fees;
  const netPerHour = net / hours;
  const tbill = position * model.tbill_annual * (model.horizon_weeks / 52);
  const verdict: BoardRow['verdict'] = net > tbill && netPerHour >= model.farm_hourly_usd ? 'FARM' : net > 0 ? 'MARGINAL' : 'SKIP';
  return {
    position_usd: Math.round(position * 100) / 100,
    drop_usd: Math.round(drop * 100) / 100,
    fees_usd: Math.round(fees * 100) / 100,
    hours: Math.round(hours * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    net_per_hour_usd: Math.round(netPerHour * 100) / 100,
    tbill_usd: Math.round(tbill * 100) / 100,
    verdict,
  };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Join one $${capital} launch allocation on ${name} and hold the allocation through its listing.`;
  if (c.includes('privacy')) return `Run $${capital} through one private transaction on ${name} and keep the receipt.`;
  if (c.includes('ai')) return `Spend $${capital} on one agent task or inference run on ${name} and keep the receipt.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold the position.`;
  if (c.includes('farm')) return `Stake $${capital} of LP tokens in ${name}'s farm on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm steps: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- board

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The market median multiple: the median market-cap-per-TVL of the priced protocols. */
export function marketMedian(snapshot: Snapshot): number {
  const ratios = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd)
    .sort((a, b) => a - b);
  return medianOf(ratios);
}

/** A CRC-32 of a string, as eight hex digits: the ledger's checksum. */
function crc32Hex(s: string): string {
  let crc = 0xffffffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i);
    for (let b = 0; b < 8; b++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const traded = tradedTokens(snapshot);
  const valueFit = fitValue(traded, model.value_ridge_lambda);
  const peers = oddsPeers(snapshot);
  const features = oddsFeatures(snapshot, peers);
  const oddsFit = fitOdds(peers, oddsFeaturesFor(features, snapshot.as_of));
  const index = bySlug(snapshot.protocols);
  const watchSet = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter(isRankable);
  const offList = ranked.filter((p) => !watchSet.has(p.slug) && p.tvl_usd >= snapshot.floor_usd);
  const offSet = new Set(offList.map((p) => p.slug));
  const range = looRangeFactors(traded);

  const scored = ranked.map((p) => {
    // The size-only multiple and the category effect, rounded to six decimals first,
    // so the row stores exactly the factors the dashboard recomputes from. The
    // multiple scales as TVL^(slope-1): slope is the log(market cap) slope, so the
    // multiple's slope is slope-1.
    const sizeOnly = Math.round(valueFit.multAt100m * Math.pow(p.tvl_usd / 1e8, valueFit.slope - 1) * 1e6) / 1e6;
    const catEffect = valueFit.effects[p.category ?? 'Other'] ?? 1;
    const catRounded = Math.round(catEffect * 1e6) / 1e6;
    const ifl = Math.max(1, Math.round(p.tvl_usd * sizeOnly * catRounded));
    const odds = Math.max(0.000001, Math.round(oddsFit.pred(p) * 1e6) / 1e6);
    const parentFactor = offSet.has(p.slug) ? model.parent_factor : 1;
    const implied = Math.max(1, Math.round(ifl * odds * parentFactor));
    const farm = farmPlan(p, implied, model);
    const age = ageDays(snapshot.as_of, p.listed_at);
    const a = ageYears(snapshot.as_of, p.listed_at);
    const scope: BoardRow['scope'] = watchSet.has(p.slug) ? 'watchlist' : offSet.has(p.slug) ? 'off-list' : 'early';
    return { p, ifl, odds, parentFactor, implied, farm, age, scope, a, sizeOnly, catRounded };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    return {
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
      token_status: 'pre-token',
      age_days: s.age,
      if_launches_usd: Math.max(1, Math.round(s.ifl)),
      token_odds: Math.max(0.000001, Math.round(s.odds * 1e6) / 1e6),
      implied_value_usd: s.implied,
      range_lo_usd: Math.max(1, Math.round(s.implied * range.lo)),
      range_hi_usd: Math.max(1, Math.round(s.implied * range.hi)),
      parent_factor: s.parentFactor,
      scope: s.scope,
      verdict: s.farm.verdict,
      farm: {
        position_usd: s.farm.position_usd,
        drop_usd: s.farm.drop_usd,
        fees_usd: s.farm.fees_usd,
        hours: s.farm.hours,
        net_usd: s.farm.net_usd,
        net_per_hour_usd: s.farm.net_per_hour_usd,
        tbill_usd: s.farm.tbill_usd,
      },
      model: {
        size_multiple: s.sizeOnly,
        category_effect: s.catRounded,
        odds_logit: Math.round(oddsFit.logit(s.p) * 10000) / 10000,
        age_years: s.a === null ? Math.round(features.medianAge * 100) / 100 : Math.round(s.a * 100) / 100,
        family_size: features.familySize.get(s.p.category ?? 'Other') ?? 1,
        growth_frac: Math.round(finite(s.p.change_7d, 0) / 100 * 10000) / 10000,
      },
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow, onWatchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    if_launches_usd: row.if_launches_usd,
    token_odds: row.token_odds,
    implied_value_usd: row.implied_value_usd,
    range_lo_usd: row.range_lo_usd,
    range_hi_usd: row.range_hi_usd,
    parent_factor: row.parent_factor,
    scope: row.scope,
    verdict: row.verdict,
    farm_position_usd: row.farm.position_usd,
    farm_drop_usd: row.farm.drop_usd,
    farm_fees_usd: row.farm.fees_usd,
    farm_hours: row.farm.hours,
    farm_net_usd: row.farm.net_usd,
    farm_net_per_hour_usd: row.farm.net_per_hour_usd,
    farm_tbill_usd: row.farm.tbill_usd,
    size_multiple: row.model.size_multiple,
    category_effect: row.model.category_effect,
    age_years: row.model.age_years,
    family_size: row.model.family_size,
    growth_frac: row.model.growth_frac,
    watchlist: onWatchlist,
  };
}

/** The range-honesty check: how often the out-of-sample actuals land inside the stated ranges. */
function rangeHonesty(
  traded: SnapshotProtocol[],
  valueFit: ValueFit,
): { loo: Evidence['range_loo']; wf: Evidence['range_wf'] } {
  // The row range is the implied value times the 10th/90th (and 25th/75th) percentiles
  // of the leave-one-out log-miss, so the honesty check is: for each traded token,
  // does its actual market cap fall inside the interval its own leave-one-out
  // prediction would have drawn? The interval is centred on the prediction, not the
  // actual, so the check is honest about what the model knew at the time.
  const looErrs: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const fit = fitValue(traded.filter((_, j) => j !== i), MODEL.value_ridge_lambda);
    looErrs.push(Math.log(traded[i]!.mcap_usd!) - fit.predLog(traded[i]!));
  }
  const q10 = quantileOf(looErrs, 0.1);
  const q90 = quantileOf(looErrs, 0.9);
  const q25 = quantileOf(looErrs, 0.25);
  const q75 = quantileOf(looErrs, 0.75);
  const withinX3 = meanOf(looErrs.map((e) => (Math.abs(e) <= Math.log(3) ? 1 : 0)));
  const in2575 = meanOf(looErrs.map((e) => (e >= q25 && e <= q75 ? 1 : 0)));
  const in1090 = meanOf(looErrs.map((e) => (e >= q10 && e <= q90 ? 1 : 0)));
  // Walk-forward: the same check on the expanding-window predictions.
  const dated = traded.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const wfErrs: number[] = [];
  for (let i = 20; i < dated.length; i++) {
    const fit = fitValue(dated.slice(0, i), MODEL.value_ridge_lambda);
    wfErrs.push(Math.log(dated[i]!.mcap_usd!) - fit.predLog(dated[i]!));
  }
  const wq10 = quantileOf(wfErrs, 0.1);
  const wq90 = quantileOf(wfErrs, 0.9);
  const wq25 = quantileOf(wfErrs, 0.25);
  const wq75 = quantileOf(wfErrs, 0.75);
  void valueFit;
  return {
    loo: {
      within_x3: Math.round(withinX3 * 100) / 100,
      inside_p25_p75: Math.round(in2575 * 100) / 100,
      inside_p10_p90: Math.round(in1090 * 100) / 100,
    },
    wf: {
      within_x3: Math.round(meanOf(wfErrs.map((e) => (Math.abs(e) <= Math.log(3) ? 1 : 0))) * 100) / 100,
      inside_p25_p75: Math.round(meanOf(wfErrs.map((e) => (e >= wq25 && e <= wq75 ? 1 : 0))) * 100) / 100,
      inside_p10_p90: Math.round(meanOf(wfErrs.map((e) => (e >= wq10 && e <= wq90 ? 1 : 0))) * 100) / 100,
    },
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const traded = tradedTokens(snapshot);
  const valueFit = fitValue(traded, model.value_ridge_lambda);
  const peers = oddsPeers(snapshot);
  const features = oddsFeatures(snapshot, peers);
  const oddsFit = fitOdds(peers, oddsFeaturesFor(features, snapshot.as_of));
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchSet = new Set(snapshot.watchlist);
  const ranked = snapshot.protocols.filter(isRankable);
  const offList = ranked.filter((p) => !watchSet.has(p.slug) && p.tvl_usd >= snapshot.floor_usd);
  const early = board.filter((r) => r.scope === 'early').length;
  const withToken = snapshot.protocols.filter((p) => !isPreToken(p));
  const pricedComp = withToken.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX' && p.category !== 'Liquid Staking');
  const pre = snapshot.protocols.filter(isPreToken);
  const outBridge = pre.filter((p) => ['Bridge', 'Canonical Bridge'].includes(p.category ?? '')).length;
  const outLiquid = pre.filter((p) => ['Liquid Staking', 'Liquid Restaking', 'Restaked BTC'].includes(p.category ?? '')).length;
  const outExchange = pre.filter((p) => p.category === 'CEX').length;
  const outVersioned = pre.filter(
    (p) =>
      !['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX'].includes(p.category ?? '') &&
      (VERSIONED.test(p.name) || WRAPPED.test(p.name)),
  ).length;
  const totalTvl = board.reduce((s, r) => s + r.tvl_usd, 0);
  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);
  const verdicts = {
    farm: board.filter((r) => r.verdict === 'FARM').length,
    marginal: board.filter((r) => r.verdict === 'MARGINAL').length,
    skip: board.filter((r) => r.verdict === 'SKIP').length,
  };
  const checksumSource = board.map((r) => `${r.rank}:${r.slug}:${r.implied_value_usd}`).join('|');
  const honesty = rangeHonesty(traded, valueFit);
  const ranges = bootstrapRanges(traded, peers, features, snapshot.as_of, valueFit, oddsFit);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    market_median: marketMedian(snapshot),
    value: {
      slope: Math.round((valueFit.slope - 1) * 1000) / 1000,
      mult_at_100m: Math.round(valueFit.multAt100m * 10000) / 10000,
      traded_n: traded.length,
      category_effects: Object.fromEntries(Object.entries(valueFit.effects).map(([c, e]) => [c, Math.round(e * 10000) / 10000])),
    },
    odds: {
      beta: oddsFit.beta.map((b) => Math.round(b * 10000) / 10000),
      peers_n: peers.length,
      base_rate: Math.round(meanOf(peers.map(({ y }) => y)) * 10000) / 10000,
      median_age_years: Math.round(features.medianAge * 100) / 100,
    },
    evidence: {
      value_n: traded.length,
      value: valueEvidence(traded, snapshot.as_of, features.medianAge),
      odds_n: peers.length,
      odds: oddsEvidence(peers, features, snapshot.as_of),
      range_loo: honesty.loo,
      range_wf: honesty.wf,
      bootstrap: ranges.se,
    },
    accounting: {
      total: snapshot.protocols.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      off_list: offList.length,
      early,
      with_token: withToken.length,
      priced_comp: pricedComp.length,
      token_no_usable_cap: withToken.length - pricedComp.length,
      out_bridge: outBridge,
      out_liquid_staking: outLiquid,
      out_exchange: outExchange,
      out_versioned_wrapped: outVersioned,
      ledger: board.length + withToken.length + outBridge + outLiquid + outExchange + outVersioned,
      checksum: crc32Hex(checksumSource),
      total_tvl_usd: totalTvl,
      total_implied_usd: totalImplied,
      verdicts,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    off_list_size: offList.length,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchSet.has(r.slug))),
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.token_odds > 0 && r.token_odds <= 1)) return `${r.slug} has token odds ${r.token_odds}`;
    if (!(r.range_lo_usd > 0 && r.range_hi_usd >= r.range_lo_usd)) return `${r.slug} has range ${r.range_lo_usd}–${r.range_hi_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
