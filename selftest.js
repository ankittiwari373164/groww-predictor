'use strict';
// Offline self-test — NO network/token. Generates synthetic candles, runs the
// full pipeline (features -> labels -> rank -> signals -> indicators -> backtest).
//   node selftest.js
const { buildPanel, addLabels } = require('./src/features');
const { rankDay } = require('./src/model');
const { backtest } = require('./src/backtest');
const { directionalLean, tradeLevels, expectedHighLow } = require('./src/signals');
const { computeAll } = require('./src/indicators');

const MKT_OPEN = 9 * 60 + 15, NMIN = 375;
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function synthDay(dateMs, price, dayVol, share) {
  const openWin = 10;
  const openVol = dayVol * share * (0.85 + rnd() * 0.3);
  const rest = Math.max(dayVol - openVol, dayVol * 0.1);
  const candles = [];
  let c = price;
  const base = Math.floor((dateMs - (5 * 60 + 30) * 60000) / 1000) + MKT_OPEN * 60;
  for (let i = 0; i < NMIN; i++) {
    const ret = (rnd() - 0.5) * 0.0012; const o = c; c = c * (1 + ret);
    const h = Math.max(o, c) * (1 + rnd() * 0.0008), l = Math.min(o, c) * (1 - rnd() * 0.0008);
    const v = i < openWin ? openVol / openWin : (rest / (NMIN - openWin)) * (0.6 + rnd());
    candles.push([base + i * 60, +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), Math.round(v)]);
  }
  return candles;
}
function makeSynthetic(nSym = 20, nDays = 40) {
  const data = {};
  for (let s = 0; s < nSym; s++) {
    const sym = `STK${String(s).padStart(2, '0')}`;
    const price = 80 + rnd() * 3000, baseVol = Math.exp(12 + rnd() * 2), share = Math.min(0.14, Math.max(0.02, 0.06 + (rnd() - 0.5) * 0.04));
    let v = baseVol; const candles = [];
    const start = Date.UTC(2025, 0, 6);
    for (let d = 0; d < nDays; d++) {
      v = 0.7 * v + 0.3 * baseVol * Math.exp((rnd() - 0.5) * 0.7);
      const dateMs = start + d * 86400000;
      candles.push(...synthDay(dateMs, price, v, share * (0.9 + rnd() * 0.2)));
    }
    data[sym] = candles;
  }
  return data;
}

console.log('Generating synthetic market (no network)...');
const panel = addLabels(buildPanel(makeSynthetic(), '09:15', '09:25'), 'turnover');
const days = new Set(panel.map((r) => r.date)).size;
console.log(`panel: ${panel.length} rows, ${days} days, ${new Set(panel.map((r) => r.symbol)).size} symbols`);

// leak check: first day per symbol should fall back (share == global-ish), not its own same-day share
const bt = backtest(panel);
if (!(bt.results.analytic.actual1_in_pred3 >= bt.results.naive.actual1_in_pred3 - 1e-9))
  throw new Error('analytic should be >= naive');
console.log('ranking check: analytic >= naive  OK');

// signals + indicators smoke
const lean = directionalLean(0.01, 0.004, 0.8, 1.2);
const lv = tradeLevels(1000, 12, 0.4, 0.02);
const hl = expectedHighLow(1000, 0.02, 1005, 995, 0.4);
const ind = computeAll([101, 102, 103, 104, 103, 105, 106, 107, 106, 108, 109, 110, 109, 111, 112, 113, 114, 115],
  [99, 100, 101, 102, 101, 103, 104, 105, 104, 106, 107, 108, 107, 109, 110, 111, 112, 113],
  [100, 101, 102, 103, 102, 104, 105, 106, 105, 107, 108, 109, 108, 110, 111, 112, 113, 114], 114, 113);
console.log('lean:', lean, '| levels:', lv, '| hl:', hl);
console.log('indicators:', ind);
if (lv.side !== 'BUY' || !(lv.rr > 0)) throw new Error('trade levels broken');

// live-style rank on latest day
const lastDate = panel.map((r) => r.date).sort().slice(-1)[0];
const ranked = rankDay(panel.filter((r) => r.date === lastDate));
console.log(`LIVE-style pick for ${lastDate}: ${ranked[0].symbol} (actual rank ${ranked[0].rank})`);

console.log('\nALL SELF-TESTS PASSED');
