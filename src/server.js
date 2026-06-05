'use strict';
const express = require('express');
const fs = require('fs');
const path = require('path');
const { CFG } = require('./config');
const { loadBestModel } = require('./model');

const app = express();
app.use((req, res, next) => { res.header('Access-Control-Allow-Origin', '*'); next(); });

const DASH = path.join(__dirname, '..', 'public', 'dashboard.html');

app.get('/', (req, res) => {
  if (fs.existsSync(DASH)) res.sendFile(DASH);
  else res.send('<h1>dashboard.html missing</h1>');
});

app.get('/health', (req, res) => {
  let active = CFG.modelMode;
  if (active === 'auto') active = `auto→${loadBestModel() || 'analytic'}`;
  res.json({ ok: true, metric: CFG.rankMetric, model: CFG.modelMode, active_model: active, time: new Date().toISOString() });
});

function cleanNonFinite(o) {
  if (typeof o === 'number') return Number.isFinite(o) ? o : null;
  if (Array.isArray(o)) return o.map(cleanNonFinite);
  if (o && typeof o === 'object') { const r = {}; for (const k of Object.keys(o)) r[k] = cleanNonFinite(o[k]); return r; }
  return o;
}

app.get('/predict', (req, res) => {
  try { res.json(cleanNonFinite(JSON.parse(fs.readFileSync(CFG.paths.predictions, 'utf8')))); }
  catch { res.json({ error: 'no prediction yet — POST /predict/run after 09:25 IST' }); }
});

app.post('/predict/run', async (req, res) => {
  try {
    const { GrowwClient } = require('./growwClient');
    const { predictLive } = require('./predictLive');
    const client = await new GrowwClient().init();
    res.json(await predictLive(client));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/track', (req, res) => {
  try { res.json(require('./tracker').summary()); } catch (e) { res.json({ error: e.message }); }
});

app.get('/backtest', (req, res) => {
  if (!fs.existsSync(CFG.paths.dataset)) return res.json({ error: 'no dataset — run npm run build-dataset' });
  try { res.json(require('./backtest').backtest()); } catch (e) { res.json({ error: e.message }); }
});

app.listen(CFG.port, () => {
  console.log(`Groww predictor on http://0.0.0.0:${CFG.port}`);
  try { require('./scheduler').startScheduler(); } catch (e) { console.log(`[sched] ${e.message}`); }
});
