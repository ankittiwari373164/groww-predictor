'use strict';
const fs = require('fs');
const { CFG } = require('./config');

function analyticScore(r) {
  const v = CFG.rankMetric === 'turnover' ? r.proj_full_turnover : r.proj_full_vol;
  return Number.isFinite(v) ? v : 0;
}
function naiveScore(r) {
  const v = CFG.rankMetric === 'turnover' ? r.open_turnover : r.open_vol;
  return Number.isFinite(v) ? v : 0;
}

function saveBestModel(name, info = {}) {
  fs.writeFileSync(CFG.paths.bestModel, JSON.stringify({ model: name, ...info }, null, 2));
}
function loadBestModel() {
  try { return JSON.parse(fs.readFileSync(CFG.paths.bestModel, 'utf8')).model; } catch { return null; }
}

function scorer() {
  const mode = CFG.modelMode;
  if (mode === 'naive') return naiveScore;
  if (mode === 'analytic') return analyticScore;
  // auto -> backtest winner (analytic default; lgbm not part of the Node port)
  const best = loadBestModel();
  return best === 'naive' ? naiveScore : analyticScore;
}

function rankDay(rows) {
  const sc = scorer();
  const out = rows.map((r) => ({ ...r, score: sc(r) }));
  out.sort((a, b) => b.score - a.score);
  out.forEach((r, i) => { r.pred_rank = i + 1; });
  return out;
}

module.exports = { analyticScore, naiveScore, saveBestModel, loadBestModel, scorer, rankDay };
