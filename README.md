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

The guess is the checkpoint close tilted by damped short-horizon momentum
minus a small pull toward its own 4h mean:

```
guess = close * exp(clamp(clamp(0.30 * r60 + 0.10 * r240, -cap, +cap)
                          - 0.20 * log(close / mean240), -0.02, +0.02))
```

where `r60` / `r240` are the log-returns over the last 60 / 240 minutes of
the case's own 72h history, `mean240` is the mean close of the last 240
minutes plus the checkpoint close, and `cap` is the market's own
volatility-adaptive tilt cap: 1.5x its 4h volatility scale (the standard
deviation of its last 240 one-minute log-returns, scaled to 240 minutes),
floored at 0.5% and capped at 2%. Quiet markets get a tighter cap, wild
ones a looser one.

The mean-reversion term (round 3, 15 Nov 2026) leans against the
prevailing move. It was gated twice: on the six practice cases (MAE
38,979.30 vs 39,082.85 momentum-only) and on a 51-point causal
walk-forward backtest on the master timeline (MAE 50,638.11 vs 53,039.49,
better in both halves). The shipped k=0.20 is the conservative point of
the curve — the k=1.0 optimum was rejected for single-case fragility
(practice p02 jumps 20,671 -> 71,312 there) — and the term is provably not
mere shrinkage of the momentum tilt (pure shrinkage improves the backtest
but wrecks the practice).

The weights are deliberately modest and sit in the middle of a broad plateau
on the six practice cases, not at its argmax: with six cases, chasing the
best practice number is overfitting, not signal.

## Practice results (local scorer, actuals = next case's checkpoint close)

| case | checkpoint | guess | actual | error (cents) |
|------|-----------:|------:|-------:|--------------:|
| p00 | 74764.92 | 74747.96 | 74447.80 | 30015.90 |
| p01 | 74447.80 | 74389.35 | 73680.84 | 70851.06 |
| p02 | 73680.84 | 73518.21 | 73210.50 | 30771.48 |
| p03 | 73210.50 | 73315.18 | 73777.35 | 46217.13 |
| p04 | 73777.35 | 73805.88 | 73545.88 | 25999.70 |
| p05 | 73545.88 | 73564.23 | 73864.44 | 30020.53 |

Practice MAE **38979.30 cents** vs the persistence baseline's **44521.58**
(**-12.45%**, better on 4 of 6 cases vs the momentum-only build's 5 of 6;
the 51-point causal walk-forward backtest is the second gate: 50,638.11
vs 53,039.49 for the momentum-only build). Two runs are byte-identical;
all 6 cases run in ~0.23s total (limit 8s per case).

Tried and rejected on the same practice: mean-reversion toward the 72h
median (worse than baseline, +2% to +5%), anchoring on the median of the
last 3 or 5 closes (-7.6% and -10.0%), and larger trend weights (they keep
improving on six cases, which is exactly why they are not used). Round 2
also killed slow-drift mean240, Ridge long-trend, Theta, Holt damped,
conformal shrink, hour-factor, and LGBM-quantile — each a downtrend bet
that fails the causal walk-forward backtest. Round 3 killed isotonic /
binned-median calibration of the tilt (40,587 / 52,921 walk-forward) and
vol-regime scaling of the tilt (practice win, backtest loss); the k=1.0
mean-reversion optimum was rejected for single-case fragility.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Practice cases p00-p05 are in `input/` for local testing. Full rules in
`RULES.txt`.
