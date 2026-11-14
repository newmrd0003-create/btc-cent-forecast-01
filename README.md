# Bitcoin 4-hour-ahead price forecaster

Entry for make.fun competition `btc-cent-forecast-01`: forecast Bitcoin's US-dollar
price 240 minutes after each checkpoint, 12 checkpoints 4 hours apart over 48 hours.
Score is mean absolute error in cents; the house baseline (persistence: guess the
checkpoint close) scores 44521.576667 cents on the practice.

`main.ts` (Node 22, standard library only, no network) reads every `<id>.in` case in
`$MAKEFUN_INPUT_DIR` (else `/input`) and writes `<id>.out` to `$MAKEFUN_OUTPUT_DIR`
(else `/output`) with exactly {"forecasts":[{"case": <id>, "price": <guess>}]}.
The starter in this repo is the house baseline; the entry improves on it with a
trend/volatility-adaptive median forecast estimated from each case's own 72h history.

Practice cases p00-p05 are in `input/` for local testing. Full rules in `RULES.txt`.
