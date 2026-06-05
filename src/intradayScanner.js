'use strict';
/**
 * intradayScanner.js
 * ------------------
 * Live intraday scanner — runs during market hours (09:15–15:30 IST),
 * refreshes quotes every 2 minutes, and applies ORB strategy to top stocks.
 *
 * Exposes:
 *   GET /intraday        — current ORB status of all scanned stocks
 *   POST /intraday/scan  — force a fresh scan now
 */

const fs   = require('fs');
const { CFG }        = require('./config');
const { GrowwClient } = require('./growwClient');
const { buildUniverse } = require('./universe');
const { calcORB }    = require('./orbStrategy');
const { computeAll } = require('./indicators');
const { median, clip, round } = require('./stats');

const INTRADAY_PATH = require('path').join(CFG.dataDir, 'intraday.json');

function loadDataset() {
  try { return JSON.parse(fs.readFileSync(CFG.paths.dataset, 'utf8')); } catch { return []; }
}
function contextTable(ds) {
  const ctx = {};
  for (const r of ds) ctx[r.symbol] = r;
  return ctx;
}
function dailySeries(ds, lookback = 40) {
  const bySym = {};
  for (const r of ds) { (bySym[r.symbol] = bySym[r.symbol] || []).push(r); }
  const out = {};
  for (const [s, list] of Object.entries(bySym)) {
    const tail = list.slice(-lookback);
    out[s] = { highs: tail.map(r => r.day_high), lows: tail.map(r => r.day_low), closes: tail.map(r => r.day_close) };
  }
  return out;
}

function parseOhlc(q) {
  const raw = q.ohlc || {};
  return {
    open:  Number(raw.open  || q.open  || 0),
    high:  Number(raw.high  || q.high  || 0),
    low:   Number(raw.low   || q.low   || 0),
    close: Number(raw.close || q.close || 0),
  };
}

// IST market hours check
function isMarketHours() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 3600000) + (now.getTimezoneOffset() * 60000));
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const mins = h * 60 + m;
  const day = ist.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function isORBFormed() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 3600000) + (now.getTimezoneOffset() * 60000));
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  return h * 60 + m >= 9 * 60 + 25; // ORB forms after 09:25
}

async function runScan(client, topN = 50) {
  client = client || (await new GrowwClient().init());

  const ds  = loadDataset();
  const ctx = contextTable(ds);
  const daily = dailySeries(ds);
  const shareVals = Object.values(ctx).map(r => r.open_share_hist).filter(Number.isFinite);
  const globalShare = shareVals.length ? median(shareVals) : 0.06;

  const uni = await buildUniverse(client);
  const orbFormed = isORBFormed();

  const rows = [];
  for (const u of uni.slice(0, 214)) {
    const sym = u.trading_symbol;
    try {
      const q = await client.liveQuote(sym);
      const vol = Number(q.volume) || 0;
      if (vol <= 0) continue;

      const ohlc     = parseOhlc(q);
      const last     = Number(q.last_price) || ohlc.close || 0;
      const dayChange = Number(q.day_change) || 0;
      const dcp      = last ? (dayChange / (last - dayChange)) * 100 : 0;
      const avgPrice = Number(q.average_price) || last;
      const c        = ctx[sym] || {};
      const shareHist = clip(Number.isFinite(c.open_share_hist) ? c.open_share_hist : globalShare, 1e-4, 0.9);
      const projVol  = vol / shareHist;

      // Indicators from daily data
      const s   = daily[sym];
      const ind = s && s.closes.length
        ? computeAll(s.highs, s.lows, s.closes, last, avgPrice)
        : { rsi: 50, macd_hist: 0, atr: null, adx: 25, ind_score: 0 };

      // Volume z-score
      const volZ = c.avg20_full_vol && c.std20_full_vol
        ? (vol - c.avg20_full_vol * shareHist) / (c.std20_full_vol * shareHist + 1e-9)
        : 0;

      // ORB calculation — use today's OHLC high/low as the opening range
      const orb = orbFormed ? calcORB(
        ohlc.high,  // today's high so far = ORB high (works well for first 10 min)
        ohlc.low,   // today's low so far  = ORB low
        last,
        ind.atr,
        { rsi: ind.rsi || 50, adx: ind.adx || 25, macd_hist: ind.macd_hist || 0, vol_zscore: volZ }
      ) : null;

      rows.push({
        symbol: sym,
        last_price: round(last),
        day_change_perc: round(dcp),
        open_vol: vol,
        proj_full_turnover_cr: round(projVol * last / 1e7),
        vol_zscore: round(volZ, 2),
        rsi: ind.rsi, macd_hist: ind.macd_hist, adx: ind.adx, atr: ind.atr,
        orb: orb,
        // Simple rank score for ordering
        _score: projVol * last + (orb && orb.signal !== 'WAIT' ? 1e12 : 0),
        groww_url: `https://groww.in/stocks/${sym.toLowerCase()}`,
      });
    } catch (e) { /* skip */ }
  }

  // Sort: active ORB signals first, then by projected turnover
  rows.sort((a, b) => b._score - a._score);
  const top = rows.slice(0, topN).map(({ _score, ...r }) => r);

  const result = {
    as_of: new Date().toISOString(),
    orb_formed: orbFormed,
    market_open: isMarketHours(),
    scanned: rows.length,
    stocks: top,
    // Summary counts
    signals: {
      buy:  top.filter(r => r.orb?.signal === 'BUY').length,
      sell: top.filter(r => r.orb?.signal === 'SELL').length,
      wait: top.filter(r => r.orb?.signal === 'WAIT' || !r.orb).length,
    },
  };

  fs.writeFileSync(INTRADAY_PATH, JSON.stringify(result, null, 2));
  console.log(`[intraday] scanned ${rows.length} → BUY:${result.signals.buy} SELL:${result.signals.sell} WAIT:${result.signals.wait}`);
  return result;
}

function loadIntraday() {
  try { return JSON.parse(fs.readFileSync(INTRADAY_PATH, 'utf8')); } catch { return null; }
}

module.exports = { runScan, loadIntraday, isMarketHours, INTRADAY_PATH };