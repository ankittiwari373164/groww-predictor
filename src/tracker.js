'use strict';
// Track record — the honest "accuracy" engine. Logs each prediction and scores
// it against what actually happened (from Groww historical candles).
const fs = require('fs');
const { CFG } = require('./config');

function load() { try { return JSON.parse(fs.readFileSync(CFG.paths.track, 'utf8')); } catch { return []; } }
function save(recs) { fs.writeFileSync(CFG.paths.track, JSON.stringify(recs, null, 2)); }
const today = () => new Date().toISOString().slice(0, 10);

function recordPrediction(result) {
  const p = result.most_traded_pick || {};
  const d = today();
  let recs = load().filter((r) => r.date !== d);
  recs.push({
    date: d, pick: p.symbol, signal: p.signal || 'NEUTRAL', entry: p.last_price,
    target: p.target, stop: p.stop, expected_high: p.expected_high, expected_low: p.expected_low,
    scored: false,
  });
  save(recs);
}

async function scorePending(client) {
  const recs = load();
  const d = today();
  const pending = recs.filter((r) => !r.scored && r.date < d);
  if (!pending.length) return { scored_now: 0, ...summary() };
  let n = 0;
  for (const r of pending) {
    try {
      const start = new Date(r.date + 'T00:00:00Z');
      const end = new Date(start.getTime() + 86400000);
      const candles = await client.historicalCandles(r.pick, start, end, 1440);
      if (!candles.length) continue;
      const [, , h, l, c] = candles[candles.length - 1];
      const entry = r.entry || candles[candles.length - 1][1];
      r.actual_close = c; r.actual_high = h; r.actual_low = l;
      r.move_pct = entry ? Math.round((c / entry - 1) * 10000) / 100 : null;
      r.direction_correct = r.signal === 'BUY' ? c > entry : r.signal === 'SELL' ? c < entry : null;
      r.band_held = (r.expected_high != null && r.expected_low != null) ? (h <= r.expected_high && l >= r.expected_low) : null;
      if (r.target != null && r.stop != null) {
        if (r.signal === 'BUY') { r.target_hit = h >= r.target; r.stop_hit = l <= r.stop; }
        else if (r.signal === 'SELL') { r.target_hit = l <= r.target; r.stop_hit = h >= r.stop; }
      }
      r.scored = true; n++;
    } catch (e) { console.log(`[tracker] could not score ${r.date} ${r.pick}: ${e.message}`); }
  }
  save(recs);
  return { scored_now: n, ...summary() };
}

function rate(xs, key) {
  const a = xs.filter((r) => r[key] !== null && r[key] !== undefined);
  return a.length ? Math.round((a.filter((r) => r[key]).length / a.length) * 1000) / 1000 : null;
}

function summary() {
  const recs = load();
  const scored = recs.filter((r) => r.scored);
  const directional = scored.filter((r) => r.direction_correct !== null && r.direction_correct !== undefined);
  const banded = scored.filter((r) => 'band_held' in r && r.band_held !== null);
  return {
    total_logged: recs.length,
    total_scored: scored.length,
    direction_hit_rate: rate(directional, 'direction_correct'),
    directional_n: directional.length,
    band_coverage: rate(banded, 'band_held'),
    recent: recs.slice(-15).reverse(),
  };
}

module.exports = { recordPrediction, scorePending, summary };
