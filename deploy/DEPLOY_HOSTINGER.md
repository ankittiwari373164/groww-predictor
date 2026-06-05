# Deploying on Hostinger (Node.js)

Now that the app is Node, it **can** run on Hostinger — but read which product
you have, because the setup differs.

## The key idea
Two parts:
1. **The dashboard** = a small Express app (`src/server.js`) — light, always fine.
2. **The scheduled jobs** (09:25 predict, 16:00 score, weekly rebuild) — these
   need to fire on time. On shared hosting the app process can be spun down when
   idle, so node-cron inside the app is unreliable there. **Use Hostinger's own
   Cron Jobs** to run the CLI instead, and set `ENABLE_SCHEDULER=0`.

Hostinger has a **persistent filesystem**, so `data/*.json` (and your accuracy
track record) survive — unlike Render free or Vercel.

---

## A) Hostinger Node.js (shared) — via hPanel "Setup Node.js App"
1. Upload the project (Git or File Manager). Run `npm install` (hPanel lets you
   run it, or use the terminal).
2. In **Setup Node.js App**: set **Application startup file = `src/server.js`**,
   Node 18+, and add the environment variables from `.env.example`
   (`GROWW_API_KEY`, `GROWW_TOTP_SECRET`, `DATA_DIR=./data`, `ENABLE_SCHEDULER=0`).
   Start the app → the dashboard is live on your domain.
3. **Cron Jobs** (hPanel → Advanced → Cron Jobs). Server clock is usually UTC,
   so 09:25 IST = 03:55 UTC, 16:00 IST = 10:30 UTC, Sun 18:00 IST = 12:30 UTC:
   ```
   55 3  * * 1-5   cd ~/groww-predictor && node cli.js predict  >> data/cron.log 2>&1
   30 10 * * 1-5   cd ~/groww-predictor && node cli.js score    >> data/cron.log 2>&1
   30 12 * * 0     cd ~/groww-predictor && node cli.js build && node cli.js backtest >> data/cron.log 2>&1
   ```
4. **First dataset**: the weekly build fetches ~210 symbols and can be heavy for
   a shared plan. Easiest path: run `npm run build-dataset` **once on your own
   PC**, then upload the produced `data/dataset.json` + `data/opening_shares.json`.
   After that the host only does the light daily `predict`/`score`, which fits
   shared limits comfortably.

> If the shared plan kills long scripts or limits outbound calls, the daily
> predict (one ~45s scan) usually still works; only the full rebuild is heavy —
> hence building it off-host and uploading.

---

## B) Hostinger VPS (recommended for hands-off)
Full control, no idle spin-down — run it always-on and let the app's own
scheduler handle everything:
```bash
sudo apt update && sudo apt install -y nodejs npm git
git clone <repo> groww-predictor && cd groww-predictor
npm install && cp .env.example .env   # fill creds, set ENABLE_SCHEDULER=1
# keep it running with pm2:
sudo npm i -g pm2
pm2 start src/server.js --name groww-predictor
pm2 save && pm2 startup        # auto-start on reboot
```
Open `http://<vps-ip>:8000` (or put Nginx + your domain in front for HTTPS).
With `ENABLE_SCHEDULER=1` the 09:25 / 16:00 / weekly jobs run inside the app —
no cron needed.

---

## Reality check
- Dashboard on shared Node hosting: ✅ works.
- Daily predict/score via Hostinger cron: ✅ works (persistent disk keeps the
  track record).
- Full weekly rebuild on a small shared plan: ⚠️ may hit CPU/time limits — build
  off-host and upload, or use a VPS.
- Accuracy still only means something after ~15–20 scored days. Paper-trade
  until then. Not investment advice.
