// btc-cent-forecast-01's house baseline (Node 22, standard library only): persistence. It forecasts that Bitcoin's
// price does not move: each case's guess is the market's last price in the case, the close at its checkpoint, kept on
// the price grid's 5 decimals of a dollar and inside the scorer's price bounds:
//
//   guess = clamp(x, 0.00001, 9999999.99999), rounded to 5 decimals
//
// where x is the one market's last price in the case (the close at `at`). Its numbers are fixed in advance, never tuned
// on any data: nothing is fitted, and persistence scores whatever it scores on the practice. A prize needs a loss
// strictly below this house entry's on the final.
//
// The kit's starter/main.ts is this program byte for byte: start your entry from it. What an entry must do:
//   - read every <id>.in in the input directory (the grader runs one case at a time, with only that case's file there),
//     canonical JSON {"schema":"makefun/btc-cent-case/v1","competition","case","at","horizon_minutes","markets":
//     [{"id","name","start","prices"}]}, where `prices` holds one close a minute in US dollars per whole BTC from
//     `start` to `at` inclusive, so the last one is the close at the checkpoint;
//   - write <id>.out to the output directory: {"forecasts":[{"case":"<the case's id>","price":<number>}]}, exactly one
//     row naming the case and no other key, its price a finite number greater than 0 and less than 10,000,000, at most
//     1 MiB. Anything else is an invalid case, scored as if the guess were the checkpoint's own close, and an entry
//     with any invalid case ranks below every valid one and takes no prize.
// It runs offline, with no network, under the case's time cap: everything it knows is in the case's prices.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/** The persistence guess of one market: its last close in the case, the price at the checkpoint. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`market ${m.id}'s last price is not a finite number`);
  return price5(x);
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
