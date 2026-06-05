'use strict';
const fs = require('fs');
const { CFG } = require('./config');
const { addLabels } = require('./features');
const { analyticScore, naiveScore, saveBestModel } = require('./model');
const { directionalLean, expectedHighLow } = require('./signals');
const { clip } = require('./stats');

function evalRanker(testRows, scoreFn) {
  const byDate = new Map();
  for (const r of testRows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  let top1 = 0, a1in3 = 0, jac = 0, n = 0;
  for (const day of byDate.values()) {
    if (day.length < 3) continue;
    const pred = day.map((r) => ({ ...r, s: scoreFn(r) })).sort((a, b) => b.s - a.s);
    const predTop1 = pred[0].symbol;
    const predTop3 = new Set(pred.slice(0, 3).map((r) => r.symbol));
    const actual = day.slice().sort((a, b) => a.rank - b.rank);
    const actualTop1 = actual[0].symbol;
    const actualTop3 = new Set(actual.slice(0, 3).map((r) => r.symbol));
    top1 += predTop1 === actualTop1 ? 1 : 0;
    a1in3 += predTop3.has(actualTop1) ? 1 : 0;
    const inter = [...predTop3].filter((x) => actualTop3.has(x)).length;
    jac += inter / new Set([...predTop3, ...actualTop3]).size;
    n++;
  }
  n = n || 1;
  return { days: n, top1_acc: top1 / n, actual1_in_pred3: a1in3 / n, top3_jaccard: jac / n };
}

function signalBacktest(rows) {
  const d = rows.filter((r) => ['gap_pct', 'open_ret', 'open_high', 'open_low', 'open_last',
    'rest_of_day_ret', 'day_high', 'day_low', 'day_open', 'hist_range_pct'].every((k) => Number.isFinite(r[k])));
  if (!d.length) return null;
  let hits = 0, directional = 0, covered = 0;
  for (const r of d) {
    const rng = (r.open_high - r.open_low) || NaN;
    const pos = Number.isFinite(rng) ? clip((r.open_last - r.open_low) / rng, 0, 1) : 0.5;
    const { label, score } = directionalLean(r.gap_pct, r.open_ret, pos, r.vol_zscore || 0);
    if (label !== 'NEUTRAL') {
      directional++;
      if ((score > 0 && r.rest_of_day_ret > 0) || (score < 0 && r.rest_of_day_ret < 0)) hits++;
    }
    const band = expectedHighLow(r.day_open, r.hist_range_pct, null, null, score);
    if (r.day_high <= band.expected_high && r.day_low >= band.expected_low) covered++;
  }
  return {
    direction_hit_rate: directional ? Math.round((hits / directional) * 1000) / 1000 : null,
    directional_signals_pct: Math.round((directional / d.length) * 1000) / 1000,
    range_coverage: Math.round((covered / d.length) * 1000) / 1000,
    samples: d.length,
  };
}

function backtest(panel) {
  panel = panel || JSON.parse(fs.readFileSync(CFG.paths.dataset, 'utf8'));
  if (!panel[0] || panel[0].rank === undefined) addLabels(panel, CFG.rankMetric);
  const dates = [...new Set(panel.map((r) => r.date))].sort();
  const cut = dates[Math.floor(dates.length * 0.8)] || dates[dates.length - 1];
  const test = panel.filter((r) => r.date >= cut);

  const results = { naive: evalRanker(test, naiveScore), analytic: evalRanker(test, analyticScore) };
  const pref = { analytic: 0, naive: 1 };
  const best = Object.keys(results).sort((a, b) =>
    (results[b].actual1_in_pred3 - results[a].actual1_in_pred3) || (pref[a] - pref[b]))[0];
  saveBestModel(best, {
    metric: CFG.rankMetric,
    actual1_in_pred3: Math.round(results[best].actual1_in_pred3 * 1e4) / 1e4,
    test_days: results[best].days,
  });

  console.log(`\n=== BACKTEST (out-of-sample, metric=${CFG.rankMetric}, test_days=${results.analytic.days}) ===`);
  for (const k of Object.keys(results)) {
    const m = results[k];
    console.log(`  ${k.padEnd(9)} top1=${m.top1_acc.toFixed(3)} actual#1-in-top3=${m.actual1_in_pred3.toFixed(3)} jaccard=${m.top3_jaccard.toFixed(3)}`);
  }
  console.log(`[backtest] auto-mode will serve: ${best.toUpperCase()}`);
  const sig = signalBacktest(panel);
  if (sig) {
    console.log('\n=== SIGNAL BACKTEST (buy/sell is weak by nature — read honestly) ===');
    console.log(`  direction hit-rate : ${sig.direction_hit_rate} (on ${(sig.directional_signals_pct * 100).toFixed(0)}% of days a non-neutral lean fired)`);
    console.log(`  High/Low coverage  : ${sig.range_coverage}`);
    console.log(`  samples            : ${sig.samples}`);
  }
  return { results, best, signal: sig };
}

module.exports = { backtest, evalRanker, signalBacktest };
