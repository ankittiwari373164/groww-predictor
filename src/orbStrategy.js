'use strict';
/**
 * orbStrategy.js — Opening Range Breakout (ORB) for intraday trading
 * ------------------------------------------------------------------
 * The ORB strategy:
 *   1. During 09:15–09:25 IST, record the High and Low (the "opening range")
 *   2. If price breaks ABOVE the high → BUY signal
 *   3. If price breaks BELOW the low  → SELL/SHORT signal
 *   4. Stop-loss = opposite side of the range
 *   5. Target = entry + (range size × multiplier)
 *
 * Additional filters applied:
 *   - Volume confirmation (vol_zscore > 0.5 = strong participation)
 *   - ADX > 20 = trending market (avoid choppy/sideways)
 *   - RSI filter (not overbought on BUY, not oversold on SELL)
 */

const { clip } = require('./stats');

/**
 * Calculate ORB levels from opening range data.
 * @param {number} orbHigh   - Opening range high (09:15–09:25)
 * @param {number} orbLow    - Opening range low  (09:15–09:25)
 * @param {number} lastPrice - Current live price
 * @param {number} atr       - ATR(14) from daily data
 * @param {object} indicators - { rsi, adx, macd_hist, vol_zscore }
 */
function calcORB(orbHigh, orbLow, lastPrice, atr, indicators = {}) {
  if (!orbHigh || !orbLow || !lastPrice) return null;

  const range = orbHigh - orbLow;
  const rangePct = orbLow > 0 ? (range / orbLow) * 100 : 0;
  const { rsi = 50, adx = 25, macd_hist = 0, vol_zscore = 0 } = indicators;

  // ATR-based fallback if range is too tight
  const effectiveATR = atr && atr > 0 ? atr : range * 1.5;

  // Breakout targets (1.5x range = standard ORB target)
  const buyTarget  = Math.round((orbHigh + range * 1.5) * 100) / 100;
  const sellTarget = Math.round((orbLow  - range * 1.5) * 100) / 100;

  // Stop = opposite side of range + small buffer (0.1 ATR)
  const buf = effectiveATR * 0.1;
  const buyStop  = Math.round((orbLow  - buf) * 100) / 100;
  const sellStop = Math.round((orbHigh + buf) * 100) / 100;

  // Risk:Reward
  const buyRR  = buyStop  < lastPrice ? Math.round((buyTarget  - lastPrice) / (lastPrice - buyStop)  * 100) / 100 : null;
  const sellRR = sellStop > lastPrice ? Math.round((lastPrice - sellTarget)  / (sellStop - lastPrice) * 100) / 100 : null;

  // Signal strength score (0–100)
  let buyScore = 0, sellScore = 0;

  // Volume confirmation
  const volBonus = clip(vol_zscore * 15, 0, 30);

  // Trend confirmation (ADX)
  const trendBonus = adx > 30 ? 20 : adx > 20 ? 10 : 0;

  // MACD confirmation
  const macdBuyBonus  = macd_hist > 0 ? 10 : 0;
  const macdSellBonus = macd_hist < 0 ? 10 : 0;

  // RSI filter — avoid chasing overbought/oversold
  const rsiBuyOk  = rsi < 70;  // not overbought
  const rsiSellOk = rsi > 30;  // not oversold

  // Determine current position relative to ORB
  const aboveHigh = lastPrice > orbHigh;
  const belowLow  = lastPrice < orbLow;
  const insideRange = !aboveHigh && !belowLow;

  let signal = 'WAIT'; // WAIT = inside range, no breakout yet
  let entry = null, target = null, stop = null, rr = null;

  if (aboveHigh && rsiBuyOk) {
    signal = 'BUY';
    entry  = orbHigh; // ideal entry = breakout level
    target = buyTarget;
    stop   = buyStop;
    rr     = buyRR;
    buyScore = 40 + volBonus + trendBonus + macdBuyBonus;
  } else if (belowLow && rsiSellOk) {
    signal = 'SELL';
    entry  = orbLow; // ideal entry = breakdown level
    target = sellTarget;
    stop   = sellStop;
    rr     = sellRR;
    sellScore = 40 + volBonus + trendBonus + macdSellBonus;
  } else if (insideRange) {
    signal = 'WAIT';
    // Pre-compute levels for when breakout happens
    entry = null; target = null; stop = null; rr = null;
  }

  const signalScore = signal === 'BUY' ? buyScore : signal === 'SELL' ? sellScore : 0;

  // Distance from breakout (useful for "almost there" display)
  const distToBuy  = aboveHigh ? 0 : Math.round((orbHigh - lastPrice) * 100) / 100;
  const distToSell = belowLow  ? 0 : Math.round((lastPrice - orbLow)  * 100) / 100;

  return {
    // ORB levels
    orb_high: Math.round(orbHigh * 100) / 100,
    orb_low:  Math.round(orbLow  * 100) / 100,
    orb_range: Math.round(range * 100) / 100,
    orb_range_pct: Math.round(rangePct * 100) / 100,

    // Signal
    signal,           // BUY | SELL | WAIT
    signal_score: Math.round(clip(signalScore, 0, 99)),
    entry,
    target,
    stop,
    rr,

    // Pre-computed levels for both sides (shown while WAIT)
    buy_target:  buyTarget,
    buy_stop:    buyStop,
    sell_target: sellTarget,
    sell_stop:   sellStop,

    // Position
    above_orb: aboveHigh,
    below_orb: belowLow,
    inside_orb: insideRange,
    dist_to_buy:  distToBuy,
    dist_to_sell: distToSell,

    // Filters
    volume_confirmed: vol_zscore > 0.5,
    trend_confirmed:  adx > 20,
    rsi_ok_buy:  rsiBuyOk,
    rsi_ok_sell: rsiSellOk,
  };
}

/**
 * Intraday P&L tracker — given a logged trade, calculate current P&L.
 */
function calcPnL(signal, entry, currentPrice, qty = 1) {
  if (!signal || !entry || !currentPrice) return null;
  const raw = signal === 'BUY'
    ? (currentPrice - entry) * qty
    : signal === 'SELL'
    ? (entry - currentPrice) * qty
    : 0;
  return {
    pnl: Math.round(raw * 100) / 100,
    pnl_pct: Math.round((raw / (entry * qty)) * 10000) / 100,
    in_profit: raw > 0,
  };
}

module.exports = { calcORB, calcPnL };