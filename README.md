# Bitcoin 4-hour-ahead price forecaster

Entry for make.fun competition `btc-cent-forecast-01`: forecast Bitcoin's
US-dollar price 240 minutes after each checkpoint, 12 checkpoints 4 hours
apart over 48 hours. Score is mean absolute error in cents; a prize needs a
score strictly below the house baseline's on the final and every case valid.

## Model

`main.ts` (Node 22, standard library only, no network, deterministic) reads
every `<id>.in` case in `$MAKEFUN_INPUT_DIR` (else `/input`) and writes
`<id>.out` to `$MAKEFUN_OUTPUT_DIR` (else `/output`) with exactly
`{"forecasts":[{"case": <id>, "price": <guess>}]}`.

The guess is the checkpoint close tilted by damped short-horizon momentum:

```
guess = close * exp(clamp(0.30 * r60 + 0.10 * r240, -cap, +cap))
```

where `r60` / `r240` are the log-returns over the last 60 / 240 minutes of
the case's own 72h history, and `cap` is the market's own volatility-adaptive
tilt cap: 1.5x its 4h volatility scale (the standard deviation of its last
240 one-minute log-returns, scaled to 240 minutes), floored at 0.5% and
capped at 2%. Quiet markets get a tighter cap, wild ones a looser one.

The weights are deliberately modest and sit in the middle of a broad plateau
on the six practice cases, not at its argmax: with six cases, chasing the
best practice number is overfitting, not signal.

## Practice results (local scorer, actuals = next case's checkpoint close)

| case | checkpoint | guess | actual | error (cents) |
|------|-----------:|------:|-------:|--------------:|
| p00 | 74764.92 | 74760.61 | 74447.80 | 31280.67 |
| p01 | 74447.80 | 74365.12 | 73680.84 | 68428.06 |
| p02 | 73680.84 | 73417.21 | 73210.50 | 20670.87 |
| p03 | 73210.50 | 73264.03 | 73777.35 | 51332.47 |
| p04 | 73777.35 | 73856.80 | 73545.88 | 31091.81 |
| p05 | 73545.88 | 73547.51 | 73864.44 | 31693.39 |

Practice MAE **39082.88 cents** vs the persistence baseline's **44521.58**
(**-12.22%**, better on 5 of 6 cases; every leave-one-out fold still below
baseline). Two runs are byte-identical; all 6 cases run in ~0.23s total
(limit 8s per case).

Tried and rejected on the same practice: mean-reversion toward the 72h
median (worse than baseline, +2% to +5%), anchoring on the median of the
last 3 or 5 closes (-7.6% and -10.0%), and larger trend weights (they keep
improving on six cases, which is exactly why they are not used).

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Practice cases p00-p05 are in `input/` for local testing. Full rules in
`RULES.txt`.
