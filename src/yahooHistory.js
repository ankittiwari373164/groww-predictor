'use strict';
/**
 * yahooHistory.js — Yahoo Finance historical data (Node 18 compatible, v2 API)
 * Uses yahoo-finance2 v2.x which supports Node >= 16.
 */

const yf = require('yahoo-finance2').default;
const IST_OFFSET_S = (5 * 60 + 30) * 60;

function dailyQuoteToCandles(quote) {
  if (!quote || !quote.date || !quote.open || !quote.close) return [];
  const dateMs   = new Date(quote.date).setUTCHours(0, 0, 0, 0);
  const openEpoch  = Math.floor(dateMs / 1000) - IST_OFFSET_S + (9 * 60 + 15) * 60;
  const closeEpoch = Math.floor(dateMs / 1000) - IST_OFFSET_S + (15 * 60 + 29) * 60;
  const o = quote.open, h = quote.high, l = quote.low, c = quote.close;
  const v = quote.volume || 0;
  return [
    [openEpoch,  o, h, l, o, Math.round(v * 0.10)],
    [closeEpoch, o, h, l, c, v - Math.round(v * 0.10)],
  ];
}

async function fetchYahooCandles(symbol, start, end) {
  const p1 = start.toISOString().slice(0, 10);
  const p2 = end.toISOString().slice(0, 10);

  // v2 API: yf.historical() returns array directly
  async function tryTicker(ticker) {
    const quotes = await yf.historical(ticker, {
      period1: p1, period2: p2, interval: '1d',
    }, { validateResult: false });
    return quotes || [];
  }

  let quotes = [];
  try {
    quotes = await tryTicker(`${symbol}.NS`);
  } catch (e) {
    try {
      quotes = await tryTicker(`${symbol}.BO`);
    } catch (e2) {
      throw new Error(`Yahoo Finance fetch failed for ${symbol}: ${e.message}`);
    }
  }

  if (!quotes.length) throw new Error(`Yahoo Finance fetch failed for ${symbol}: No data found, symbol may be delisted`);

  const candles = [];
  for (const q of quotes) candles.push(...dailyQuoteToCandles(q));
  return candles;
}

module.exports = { fetchYahooCandles };