# Opening Bell — Most-Traded Predictor (Node.js)

Predicts the NSE stock most likely to be **the day's most traded** from the
09:15–09:25 opening window via the Groww API, and shows a buy/sell **lean**,
target/stop, predicted High/Low and a self-measuring accuracy track record.

This is a 1:1 Node.js port of the Python version (no pandas/ML — pure
arithmetic), so it runs on Node hosts including a Hostinger VPS or Hostinger
Node hosting (with cron). See `deploy/DEPLOY_HOSTINGER.md`.

## Read this first (honesty)
- **Most-traded (volume) prediction is the reliable part.** Opening volume
  strongly predicts full-day volume, so this works.
- **Buy/Sell direction is NOT reliably predictable** intraday. It's a
  transparent *lean*, and the app **measures its real hit-rate** in the track
  record. Treat anything near 50% as noise. Paper-trade until the tracker earns
  your trust. **This is not investment advice.**

## Setup
```bash
npm install
cp .env.example .env      # fill in GROWW_API_KEY + GROWW_TOTP_SECRET
npm run build-dataset     # one-time history build (or upload a prebuilt data/)
npm run backtest          # see out-of-sample + signal accuracy
npm start                 # serve dashboard at http://localhost:8000
```

## Commands (also usable from cron)
| command | what it does |
|---|---|
| `npm start` / `node src/server.js` | dashboard + (optional) in-process scheduler |
| `node cli.js predict` | run the live 09:25 prediction now |
| `node cli.js score`   | score past predictions vs real outcomes |
| `node cli.js build`   | rebuild the historical dataset |
| `node cli.js backtest`| print ranking + signal accuracy |
| `npm run selftest`    | offline pipeline test (no network/token) |

## Auth
Use a **TOTP** key (auto-mints a token, no daily approval): set
`GROWW_API_KEY` + `GROWW_TOTP_SECRET`. All Groww keys reset daily at 6 AM IST;
TOTP is the only mode suitable for an unattended bot. `GROWW_API_SECRET`
(approval) and `GROWW_ACCESS_TOKEN` (raw, expires) are also supported.

## Endpoints
`GET /` dashboard · `GET /health` · `GET /predict` · `POST /predict/run`
`GET /track` (live accuracy) · `GET /backtest`

## Notes
- Storage is plain JSON in `DATA_DIR` (`dataset.json`, `track.json`, …). A
  **persistent disk is required** for the track record to accumulate.
- Universe = NSE F&O underlyings (~210 symbols) by default; set `UNIVERSE=CUSTOM`
  + `CUSTOM_SYMBOLS` to scan a short list.
