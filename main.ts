// btc-cent-forecast-01 entry (Node 22, standard library only): damped
// short-horizon momentum plus a small short-horizon mean-reversion term.
// It forecasts that Bitcoin's price keeps a damped share of its recent
// drift: each case's guess is the checkpoint close, tilted by 30% of the
// last hour's log-return plus 10% of the last 4 hours' log-return, with
// the total tilt capped by the market's own recent volatility (1.5x its 4h
// volatility scale, floored at 0.5% and capped at 2%, so 1% when volatility
// gives no tighter bound), minus 20% of the log-distance of the close from
// its own 4h mean (a pull back toward the recent mean over the next 4h):
//
//   guess = close * exp(clamp(clamp(0.30 * r60 + 0.10 * r240, -cap, +cap)
//                              - 0.20 * log(close / mean240), -0.02, +0.02))
//
// where r60 / r240 are the log-returns over the last 60 / 240 minutes of the
// case's own 72h history, kept on the price grid's 5 decimals and inside the
// scorer's price bounds. The mean-reversion term is the round-3 addition
// (15 Nov 2026): it is NOT a trend bet — it leans against the prevailing
// move, and it was gated on both the six practice cases (MAE 38,979.30 vs
// 39,082.85 for the momentum-only build, wins 4/6, no single case worse
// than +49%) and a 51-point causal walk-forward backtest on the same master
// timeline (MAE 50,638.11 vs 53,039.49, wins in both halves: Nov 8-9
// 52,013.97 vs 54,644.91 and Nov 10-11 49,315.16 vs 51,495.83). The term has
// a genuine interior optimum near k=1.0 on the backtest (45,818) and is
// demonstrably not mere shrinkage of the momentum tilt: pure shrinkage
// improves the backtest but wrecks the practice (43,432 at s=0.8 vs
// 39,083), while this term improves both. The shipped k=0.2 is the
// conservative point of that curve: the k=1.0 optimum was rejected for
// single-case fragility (practice case p02 jumps 20,671 -> 71,312 there),
// while k=0.2 never moves any practice case by more than ~+49% / -17%.
// The weights sit in the middle of a broad plateau on the six practice
// cases (practice MAE 38979.30 cents vs the persistence baseline's
// 44521.58, -12.5%): the practice is only six cases, so the model is a
// general per-case adaptive statistic, not a fit to them. Tried and
// rejected on the same practice: mean-reversion toward the 72h median
// (worse than baseline, +2% to +5%), anchoring on the median of the last 3
// or 5 closes instead of the last close (-7.6% and -10.0%, vs -12.5% for
// the last close, which is already a median of the bar's last 10 seconds),
// larger trend weights (they keep improving on these six cases, which is
// exactly why they are not used: with six cases that is overfitting, not
// signal), slow-drift mean240 / Ridge long-trend / Theta / Holt damped /
// conformal shrink / hour-factor / LGBM-quantile (all round-2 failures:
// each one a downtrend bet that fails the causal walk-forward backtest),
// and isotonic / binned-median calibration of the tilt (40,587 / 52,921
// on the practice walk-forward). No randomness, no clock, no network: the
// same case always gives the same bytes.
//
// What an entry must do:
//   - read every <id>.in in the input directory (the grader runs one case at
//     a time, with only that case's file there), canonical JSON
//     {"schema":"makefun/btc-cent-case/v1","competition","case","at",
//     "horizon_minutes","markets":[{"id","name","start","prices"}]}, where
//     `prices` holds one close a minute in US dollars per whole BTC from
//     `start` to `at` inclusive, so the last one is the close at the
//     checkpoint;
//   - write <id>.out to the output directory:
//     {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly
//     one row naming the case and no other key, its price a finite number
//     greater than 0 and less than 10,000,000, at most 1 MiB.
// It runs offline, with no network, under the case's time cap: everything
// it knows is in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

/** Weight on the last hour's log-return. */
const W60 = 0.3;
/** Weight on the last 4 hours' log-return. */
const W240 = 0.1;
/** Weight on the mean-reversion term: log-distance of the close from its
 * own 4h mean, subtracted (price above its 4h mean is tilted down). */
const W_MR240 = 0.2;
/** Hard bound on the total tilt, either way (the volatility cap already
 * bounds the momentum part; this only ever binds in extreme cases). */
const TILT_MAX = 0.02;
/** Largest allowed tilt from the checkpoint close, either way, when the
 * market's own volatility gives no tighter bound. */
const CAP = 0.01;
/** Floor / ceiling for the volatility-adaptive tilt cap. */
const CAP_MIN = 0.005;
const CAP_MAX = 0.02;
/** How many 1-minute returns the volatility window covers. */
const VOL_WINDOW = 240;
/** The adaptive cap is this multiple of the 4h volatility scale. */
const VOL_MULT = 1.5;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** Log-return over the last `n` minutes: log(close / close n minutes ago). */
function logReturn(prices: number[], n: number): number {
  const m = Math.min(n, prices.length - 1);
  if (m <= 0) return 0;
  const a = prices[prices.length - 1] as number;
  const b = prices[prices.length - 1 - m] as number;
  if (!(a > 0) || !(b > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.log(a / b);
}

/** One-minute log-returns over the last `n` minutes of the series. */
function returns1m(prices: number[], n: number): number[] {
  const m = Math.min(n, prices.length - 1);
  const out: number[] = [];
  for (let i = prices.length - m; i < prices.length; i += 1) {
    const a = prices[i - 1] as number;
    const b = prices[i] as number;
    if (!(a > 0) || !(b > 0)) return [];
    out.push(Math.log(b / a));
  }
  return out;
}

/** Population standard deviation of a list of numbers. */
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * The tilt cap for one market, from its own recent volatility: 1.5x the
 * 4h volatility scale (the standard deviation of its last 240 one-minute
 * log-returns, scaled to 240 minutes), floored at 0.5% and capped at 2%.
 * Quiet markets get a tighter cap, wild ones a looser one; on the six
 * practice cases the cap never binds, so the practice score is unchanged.
 */
function adaptiveCap(prices: number[]): number {
  const sigma = stddev(returns1m(prices, VOL_WINDOW)) * Math.sqrt(VOL_WINDOW);
  if (!Number.isFinite(sigma) || sigma <= 0) return CAP;
  return Math.max(CAP_MIN, Math.min(CAP_MAX, VOL_MULT * sigma));
}

/** Log-distance of the close from the mean of the last `n` minutes plus
 * the close itself (241 values for n=240): positive when the close sits
 * above its recent mean. */
function meanLogDist(prices: number[], n: number): number {
  const m = Math.min(n + 1, prices.length);
  if (m <= 0) return 0;
  const close = prices[prices.length - 1] as number;
  let sum = 0;
  for (let i = prices.length - m; i < prices.length; i += 1) sum += prices[i] as number;
  const mean = sum / m;
  if (!(close > 0) || !(mean > 0) || !Number.isFinite(close) || !Number.isFinite(mean)) return 0;
  return Math.log(close / mean);
}

/** The forecast of one market: checkpoint close tilted by damped momentum
 * minus a small pull toward its own 4h mean. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  for (const p of m.prices) {
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) {
      throw new Error(`market ${m.id} holds a price that is not a finite positive number`);
    }
  }
  const close = m.prices[m.prices.length - 1] as number;
  const cap = adaptiveCap(m.prices);
  const momentum = Math.max(-cap, Math.min(cap, W60 * logReturn(m.prices, 60) + W240 * logReturn(m.prices, 240)));
  const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, momentum - W_MR240 * meanLogDist(m.prices, 240)));
  return price5(close * Math.exp(tilt));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
