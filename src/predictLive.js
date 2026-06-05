'use strict';
const fs = require('fs');
const { CFG } = require('./config');
const { GrowwClient } = require('./growwClient');
const { buildUniverse } = require('./universe');
const { rankDay } = require('./model');
const { directionalLean, blendWithIndicators, tradeLevels, expectedHighLow } = require('./signals');
const { computeAll } = require('./indicators');
const { recordPrediction } = require('./tracker');
const { median, clip, round } = require('./stats');

function parseOhlc(payload) {
  const out = { open: 0, high: 0, low: 0, close: 0 };
  const raw = payload.ohlc;
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(out)) out[k] = Number(raw[k]) || 0;
  } else if (typeof raw === 'string') {
    const re = /(open|high|low|close)\s*[:=]\s*(-?[0-9]*\.?[0-9]+)/g;
    let m; while ((m = re.exec(raw))) out[m[1]] = parseFloat(m[2]);
  }
  for (const k of Object.keys(out)) if (!out[k] && payload[k] != null) out[k] = Number(payload[k]) || 0;
  return out;
}

function loadDataset() { try { return JSON.parse(fs.readFileSync(CFG.paths.dataset, 'utf8')); } catch { return []; } }

function contextTable(ds) {
  const ctx = {};
  for (const r of ds) ctx[r.symbol] = r; // sorted by symbol,date -> last write wins (latest date)
  return ctx;
}
function dailySeries(ds, lookback = 40) {
  const bySym = {};
  for (const r of ds) { (bySym[r.symbol] = bySym[r.symbol] || []).push(r); }
  const out = {};
  for (const [s, list] of Object.entries(bySym)) {
    const tail = list.slice(-lookback);
    out[s] = { highs: tail.map((r) => r.day_high), lows: tail.map((r) => r.day_low), closes: tail.map((r) => r.day_close) };
  }
  return out;
}

async function predictLive(client, topN = 250) {
  client = client || (await new GrowwClient().init());
  const uni = await buildUniverse(client);
  const ds = loadDataset();
  const ctx = contextTable(ds);
  const daily = dailySeries(ds);
  const shareVals = Object.values(ctx).map((r) => r.open_share_hist).filter(Number.isFinite);
  const globalShare = shareVals.length ? median(shareVals) : 0.06;

  const rows = [];
  for (const u of uni) {
    const sym = u.trading_symbol;
    try {
      const q = await client.liveQuote(sym);
      const vol = Number(q.volume) || 0;
      if (vol <= 0) continue;
      const avgPrice = Number(q.average_price) || Number(q.last_price) || 0;
      const ohlc = parseOhlc(q);
      const last = Number(q.last_price) || ohlc.close || avgPrice;
      const dayChange = Number(q.day_change) || 0;
      let dcp = q.day_change_perc;
      if (dcp == null) dcp = (last - dayChange) ? (dayChange / (last - dayChange)) * 100 : 0;
      const prevClose = last ? last - dayChange : 0;
      const openPx = ohlc.open || last;
      const c = ctx[sym] || {};
      const shareHist = clip(Number.isFinite(c.open_share_hist) ? c.open_share_hist : globalShare, 1e-4, 0.9);
      const histRange = clip(Number.isFinite(c.hist_range_pct) ? c.hist_range_pct : 0.02, 0.002, 0.25);
      const projVol = vol / shareHist;
      const row = {
        symbol: sym, open_vol: vol, open_vwap: avgPrice || last,
        open_turnover: vol * (avgPrice || last), open_first: openPx,
        open_high: ohlc.high || last, open_low: ohlc.low || last,
        open_ret: openPx ? last / openPx - 1 : 0,
        last_price: last, day_change_perc: Number(dcp) || 0,
        open_share_hist: shareHist, hist_range_pct: histRange,
        proj_full_vol: projVol, proj_full_turnover: projVol * (avgPrice || last),
        avg20_full_vol: c.avg20_full_vol, std20_full_vol: c.std20_full_vol,
      };
      row.vol_zscore = (row.open_vol - row.avg20_full_vol * shareHist) / (row.std20_full_vol * shareHist + 1e-9);
      if (!Number.isFinite(row.vol_zscore)) row.vol_zscore = 0;
      const rng = (row.open_high - row.open_low) || NaN;
      row.pos_in_range = Number.isFinite(rng) ? clip((last - row.open_low) / rng, 0, 1) : 0.5;
      const lean = directionalLean(0, row.open_ret, row.pos_in_range, row.vol_zscore);
      row.signal_score = lean.score;
      const hl = expectedHighLow(openPx || last, histRange, Math.max(row.open_high, last), Math.min(row.open_low, last), lean.score);
      Object.assign(row, hl);
      rows.push(row);
    } catch (e) { console.log(`[live] ${sym}: ${e.message}`); }
  }
  if (!rows.length) throw new Error('No live quotes returned — is the market open and the token valid?');

  let ranked = rankDay(rows).slice(0, topN);

  // indicators + trade levels per displayed stock
  for (const r of ranked) {
    const s = daily[r.symbol];
    const ind = s && s.closes.length
      ? computeAll(s.highs, s.lows, s.closes, r.last_price, r.open_vwap)
      : { rsi: null, macd_hist: null, atr: null, adx: null, ind_score: 0 };
    const blended = blendWithIndicators(r.signal_score, ind.ind_score, ind.adx);
    const lv = tradeLevels(r.last_price, ind.atr, blended, r.hist_range_pct);
    Object.assign(r, ind, lv, { blended });
  }

  // confidence = separation of #1 from the field
  const scores = ranked.map((r) => r.score);
  const sd = (() => { const m = scores.reduce((s, x) => s + x, 0) / scores.length; return Math.sqrt(scores.reduce((s, x) => s + (x - m) ** 2, 0) / scores.length); })();
  const confidence = ranked.length > 1 && sd > 0 ? clip(50 + ((scores[0] - scores[1]) / (sd + 1e-9)) * 20, 5, 99) : 50;

  const p = ranked[0];
  const result = {
    as_of: new Date().toISOString(),
    window: `${CFG.openFrom}-${CFG.openTo} IST`,
    metric: CFG.rankMetric, model: CFG.modelMode, scanned: ranked.length,
    most_traded_pick: {
      symbol: p.symbol, confidence_pct: round(confidence, 1), open_vol: Math.round(p.open_vol),
      open_turnover_cr: round(p.open_turnover / 1e7), proj_full_turnover_cr: round(p.proj_full_turnover / 1e7),
      open_ret_pct: round(p.open_ret * 100), day_change_perc: round(p.day_change_perc),
      last_price: round(p.last_price), signal: p.side || 'NEUTRAL',
      signal_confidence: round(Math.abs(p.blended || 0) * 100, 0),
      target: p.target, stop: p.stop, rr: p.rr,
      expected_high: round(p.expected_high), expected_low: round(p.expected_low),
      expected_range_pct: round(p.expected_range_pct),
      rsi: p.rsi, macd_hist: p.macd_hist, adx: p.adx, atr: p.atr,
      groww_url: `https://groww.in/stocks/${String(p.symbol).toLowerCase()}`,
    },
    top: ranked.map((r) => ({
      rank: r.pred_rank, symbol: r.symbol, last_price: round(r.last_price),
      day_change_perc: round(r.day_change_perc), open_turnover_cr: round(r.open_turnover / 1e7),
      proj_full_turnover_cr: round(r.proj_full_turnover / 1e7), signal: r.side || 'NEUTRAL',
      signal_confidence: round(Math.abs(r.blended || 0) * 100, 0),
      target: r.target, stop: r.stop, rr: r.rr,
      expected_high: round(r.expected_high), expected_low: round(r.expected_low),
      rsi: r.rsi, macd_hist: r.macd_hist, adx: r.adx,
    })),
  };
  fs.writeFileSync(CFG.paths.predictions, JSON.stringify(result, null, 2));
  try { recordPrediction(result); } catch (e) { console.log(`[tracker] ${e.message}`); }
  console.log(`[live] pick=${p.symbol} signal=${result.most_traded_pick.signal} -> ${CFG.paths.predictions}`);
  return result;
}

module.exports = { predictLive, parseOhlc };
