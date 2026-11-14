// btc-cent-forecast-01 entry (Node 22, standard library only): damped
// short-horizon momentum. It forecasts that Bitcoin's price keeps a damped
// share of its recent drift: each case's guess is the checkpoint close,
// tilted by 30% of the last hour's log-return plus 10% of the last 4 hours'
// log-return, with the total tilt capped at 1% either way:
//
//   guess = close * exp(clamp(0.30 * r60 + 0.10 * r240, -0.01, +0.01))
//
// where r60 / r240 are the log-returns over the last 60 / 240 minutes of the
// case's own 72h history, kept on the price grid's 5 decimals and inside the
// scorer's price bounds. The weights are deliberately modest and sit in the
// middle of a broad plateau on the six practice cases (practice MAE
// 39082.88 cents vs the persistence baseline's 44521.58, -12.2%, better on
// 5 of 6 cases, every leave-one-out fold still below baseline): the practice
// is only six cases, so the model is a general per-case adaptive statistic,
// not a fit to them. Tried and rejected on the same practice:
// mean-reversion toward the 72h median (worse than baseline, +2% to +5%),
// anchoring on the median of the last 3 or 5 closes instead of the last
// close (-7.6% and -10.0%, vs -12.2% for the last close, which is already a
// median of the bar's last 10 seconds), and larger trend weights (they keep
// improving on these six cases, which is exactly why they are not used:
// with six cases that is overfitting, not signal). No randomness, no clock,
// no network: the same case always gives the same bytes.
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
/** Largest allowed tilt from the checkpoint close, either way. */
const CAP = 0.01;

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

/** The forecast of one market: checkpoint close tilted by damped momentum. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const close = m.prices[m.prices.length - 1] as number;
  if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) {
    throw new Error(`market ${m.id}'s last price is not a finite positive number`);
  }
  const tilt = Math.max(-CAP, Math.min(CAP, W60 * logReturn(m.prices, 60) + W240 * logReturn(m.prices, 240)));
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
