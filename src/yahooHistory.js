'use strict';
/**
 * yahooHistory.js — Direct Yahoo Finance v8 chart API (no library, Node 18+)
 * Uses axios (already in project) to call Yahoo Finance directly.
 * No npm package needed — works on any Node version.
 */

const axios = require('axios');
const IST_OFFSET_S = (5 * 60 + 30) * 60;

function dailyQuoteToCandles(timestamp, o, h, l, c, v) {
  if (!o || !c) return [];
  const openEpoch  = timestamp - (timestamp % 86400) - IST_OFFSET_S + (9 * 60 + 15) * 60;
  const closeEpoch = timestamp - (timestamp % 86400) - IST_OFFSET_S + (15 * 60 + 29) * 60;
  const openVol = Math.round((v || 0) * 0.10);
  return [
    [openEpoch,  o, h, l, o, openVol],
    [closeEpoch, o, h, l, c, (v || 0) - openVol],
  ];
}

async function fetchYahooChart(ticker, period1, period2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const { data } = await axios.get(url, {
    params: { period1, period2, interval: '1d', events: 'history' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    },
    timeout: 15000,
  });
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error('No data returned');
  const ts     = result.timestamp || [];
  const q      = result.indicators?.quote?.[0] || {};
  return ts.map((t, i) => ({
    timestamp: t,
    open: q.open?.[i], high: q.high?.[i], low: q.low?.[i],
    close: q.close?.[i], volume: q.volume?.[i] || 0,
  })).filter(r => r.open && r.close);
}

async function fetchYahooCandles(symbol, start, end) {
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime()   / 1000);

  let quotes = [];
  let lastErr;

  for (const ticker of [`${symbol}.NS`, `${symbol}.BO`]) {
    try {
      quotes = await fetchYahooChart(ticker, period1, period2);
      if (quotes.length) break;
    } catch (e) {
      lastErr = e;
    }
  }

  if (!quotes.length) {
    throw new Error(`Yahoo Finance fetch failed for ${symbol}: ${lastErr?.message || 'No data found'}`);
  }

  const candles = [];
  for (const q of quotes) {
    candles.push(...dailyQuoteToCandles(q.timestamp, q.open, q.high, q.low, q.close, q.volume));
  }
  return candles;
}

module.exports = { fetchYahooCandles };