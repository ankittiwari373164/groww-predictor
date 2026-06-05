'use strict';
const { mean, median, std, clip } = require('./stats');

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function hmToMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }

// candle: [epochSec, o, h, l, c, v]
function candleToObj(c) {
  const istMs = c[0] * 1000 + IST_OFFSET_MS;
  const d = new Date(istMs);
  const mod = d.getUTCHours() * 60 + d.getUTCMinutes();
  const dateKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { epoch: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5], mod, dateKey };
}

function dayAggregates(dayCandles, openFrom, openTo) {
  if (!dayCandles.length) return null;
  const of = hmToMin(openFrom), ot = hmToMin(openTo);
  const win = dayCandles.filter((x) => x.mod >= of && x.mod < ot);
  if (!win.length) return null;
  const openVol = win.reduce((s, x) => s + x.v, 0);
  const openTurnover = win.reduce((s, x) => s + x.v * x.c, 0);
  const firstOpen = win[0].o;
  const lastClose = win[win.length - 1].c;
  const winHigh = Math.max(...win.map((x) => x.h));
  const winLow = Math.min(...win.map((x) => x.l));
  const openVwap = openVol > 0 ? openTurnover / openVol : lastClose;
  const fullVol = dayCandles.reduce((s, x) => s + x.v, 0);
  const fullTurnover = dayCandles.reduce((s, x) => s + x.v * x.c, 0);
  return {
    open_vol: openVol, open_turnover: openTurnover,
    open_ret: firstOpen ? lastClose / firstOpen - 1 : 0,
    open_range_pct: firstOpen ? (winHigh - winLow) / firstOpen : 0,
    open_vwap: openVwap, open_first: firstOpen, open_last: lastClose,
    open_high: winHigh, open_low: winLow,
    day_open: dayCandles[0].o, day_high: Math.max(...dayCandles.map((x) => x.h)),
    day_low: Math.min(...dayCandles.map((x) => x.l)), day_close: dayCandles[dayCandles.length - 1].c,
    full_vol: fullVol, full_turnover: fullTurnover,
  };
}

function symbolDayRows(symbol, candles, openFrom, openTo) {
  const objs = candles.map(candleToObj).sort((a, b) => a.epoch - b.epoch);
  const byDate = new Map();
  for (const o of objs) { if (!byDate.has(o.dateKey)) byDate.set(o.dateKey, []); byDate.get(o.dateKey).push(o); }
  const rows = [];
  for (const [date, dc] of byDate) {
    const agg = dayAggregates(dc, openFrom, openTo);
    if (agg) rows.push({ symbol, date, ...agg });
  }
  return rows;
}

function finalizePanel(rows) {
  if (!rows.length) return [];
  rows.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : a.date < b.date ? -1 : 1));
  // global fallbacks
  const allShares = rows.map((r) => (r.full_vol ? r.open_vol / r.full_vol : NaN));
  const allRanges = rows.map((r) => (r.day_open ? (r.day_high - r.day_low) / r.day_open : NaN));
  const globalShare = median(allShares);
  const globalRange = median(allRanges);

  const bySym = new Map();
  for (const r of rows) { if (!bySym.has(r.symbol)) bySym.set(r.symbol, []); bySym.get(r.symbol).push(r); }

  for (const list of bySym.values()) {
    const fullVolHist = [], fullTurnHist = [], shareHist = [], rangeHist = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const prev = i > 0 ? list[i - 1] : null;
      r.prev_close = prev ? prev.open_first : NaN;
      r.prev_full_vol = prev ? prev.full_vol : NaN;
      r.prev_full_turnover = prev ? prev.full_turnover : NaN;
      r.avg5_full_vol = fullVolHist.length ? mean(fullVolHist.slice(-5)) : NaN;
      r.avg20_full_vol = fullVolHist.length ? mean(fullVolHist.slice(-20)) : NaN;
      r.avg20_full_turnover = fullTurnHist.length ? mean(fullTurnHist.slice(-20)) : NaN;
      r.std20_full_vol = fullVolHist.length >= 2 ? std(fullVolHist.slice(-20)) : NaN;
      let sh = shareHist.length >= 3 ? median(shareHist) : NaN;
      if (!Number.isFinite(sh)) sh = globalShare;
      r.open_share_hist = clip(sh, 1e-4, 0.9);
      let hr = rangeHist.length >= 3 ? median(rangeHist) : NaN;
      if (!Number.isFinite(hr)) hr = globalRange;
      r.hist_range_pct = clip(Number.isFinite(hr) ? hr : 0.02, 0.002, 0.25);

      r.proj_full_vol = r.open_vol / r.open_share_hist;
      r.proj_full_turnover = r.proj_full_vol * r.open_vwap;
      r.vol_zscore = (r.open_vol - r.avg20_full_vol * r.open_share_hist) /
        (r.std20_full_vol * r.open_share_hist + 1e-9);
      if (!Number.isFinite(r.vol_zscore)) r.vol_zscore = 0;
      r.gap_pct = Number.isFinite(r.prev_close) && r.prev_close ? r.open_first / r.prev_close - 1 : 0;
      r.dow = new Date(r.date).getUTCDay();
      r.rest_of_day_ret = r.open_last ? r.day_close / r.open_last - 1 : 0;

      // push AFTER using (leak-free)
      fullVolHist.push(r.full_vol); fullTurnHist.push(r.full_turnover);
      if (r.full_vol) shareHist.push(r.open_vol / r.full_vol);
      if (r.day_open) rangeHist.push((r.day_high - r.day_low) / r.day_open);
    }
  }
  return rows;
}

function buildPanel(perSymbolCandles, openFrom, openTo) {
  let rows = [];
  for (const [sym, candles] of Object.entries(perSymbolCandles)) {
    rows = rows.concat(symbolDayRows(sym, candles, openFrom, openTo));
  }
  return finalizePanel(rows);
}

function addLabels(rows, metric) {
  const target = metric === 'turnover' ? 'full_turnover' : 'full_vol';
  const byDate = new Map();
  for (const r of rows) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  for (const list of byDate.values()) {
    list.sort((a, b) => b[target] - a[target]);
    list.forEach((r, i) => {
      r.rank = i + 1;
      r.is_top1 = i === 0 ? 1 : 0;
      r.is_top3 = i < 3 ? 1 : 0;
    });
  }
  return rows;
}

const FEATURE_COLS = ['open_vol', 'open_turnover', 'open_ret', 'open_range_pct', 'open_vwap',
  'prev_full_vol', 'prev_full_turnover', 'avg5_full_vol', 'avg20_full_vol', 'avg20_full_turnover',
  'open_share_hist', 'proj_full_vol', 'proj_full_turnover', 'vol_zscore', 'gap_pct', 'dow'];

module.exports = { candleToObj, dayAggregates, symbolDayRows, finalizePanel, buildPanel, addLabels, FEATURE_COLS };
