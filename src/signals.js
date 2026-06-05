'use strict';
// Buy/Sell lean + expected High/Low + ATR-based target/stop.
// HONEST: the High/Low range is defensible (volatility persists). The buy/sell
// direction is NOT reliably predictable intraday — it's a lean, measured by the
// tracker, never a guarantee. Not investment advice.
const { clip } = require('./stats');

function directionalLean(gapPct, openRet, posInRange, volZ = 0) {
  const g = Math.tanh((gapPct || 0) * 50);
  const m = Math.tanh((openRet || 0) * 80);
  const p = Number.isFinite(posInRange) ? (clip(posInRange, 0, 1) - 0.5) * 2 : 0;
  const conviction = 1 + 0.3 * Math.tanh(Math.abs(volZ || 0));
  const score = clip((0.45 * m + 0.30 * g + 0.25 * p) * conviction, -1, 1);
  const label = score > 0.15 ? 'BUY' : score < -0.15 ? 'SELL' : 'NEUTRAL';
  return { label, score, confidence: Math.round(clip(Math.abs(score) * 100, 0, 95) * 10) / 10 };
}

function blendWithIndicators(leanScore, indScore, adx = null) {
  let trend = 0.5;
  if (adx != null && Number.isFinite(adx)) trend = clip(adx / 50, 0.2, 1.0);
  return clip((0.6 * leanScore + 0.4 * (indScore || 0)) * trend, -1, 1);
}

function tradeLevels(lastPrice, atr, score, histRangePct = 0.02) {
  if (!lastPrice || lastPrice <= 0) return { side: 'NEUTRAL', target: null, stop: null, rr: null };
  const side = score > 0.15 ? 'BUY' : score < -0.15 ? 'SELL' : 'NEUTRAL';
  const a = atr && Number.isFinite(atr) && atr > 0 ? atr : lastPrice * histRangePct * 0.6;
  const tgtMult = 1.5, stopMult = 1.0;
  let target, stop;
  if (side === 'BUY') { target = lastPrice + tgtMult * a; stop = lastPrice - stopMult * a; }
  else if (side === 'SELL') { target = lastPrice - tgtMult * a; stop = lastPrice + stopMult * a; }
  else return { side: 'NEUTRAL', target: null, stop: null, rr: null };
  const reward = Math.abs(target - lastPrice), risk = Math.abs(lastPrice - stop);
  return {
    side, target: Math.round(target * 100) / 100, stop: Math.round(stop * 100) / 100,
    rr: risk ? Math.round((reward / risk) * 100) / 100 : null,
  };
}

function expectedHighLow(anchor, histRangePct, openHigh = null, openLow = null, leanScore = 0) {
  const hr = Math.max(Number(histRangePct) || 0.02, 0.002);
  const half = anchor * hr * 0.6;
  const skew = clip(leanScore, -1, 1) * 0.35;
  let high = anchor + half * (1 + skew);
  let low = anchor - half * (1 - skew);
  if (openHigh) high = Math.max(high, openHigh);
  if (openLow) low = Math.min(low, openLow);
  return {
    expected_high: Math.round(high * 100) / 100,
    expected_low: Math.round(low * 100) / 100,
    expected_range_pct: Math.round(hr * 1000) / 10,
  };
}

module.exports = { directionalLean, blendWithIndicators, tradeLevels, expectedHighLow };
