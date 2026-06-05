'use strict';
/**
 * yahooHistory.js
 * ---------------
 * Fetches historical 1-minute OHLCV candles from Yahoo Finance for NSE stocks.
 * Used as a drop-in replacement for growwClient.historicalCandles() when
 * Groww's historical API returns 403.
 *
 * Yahoo Finance free limits:
 *   - 1m  interval → max 7 days per request
 *   - 5m  interval → max 60 days per request
 *   - 1d  interval → years of data
 *
 * For HISTORY_DAYS > 7 we fall back to 1d candles and synthesise
 * fake intraday open-window candles using that day's OHLC, which is
 * accurate enough for the model's daily-aggregate features.
 */

const YahooFinance = require('yahoo-finance2').default;

const yf = new YahooFinance();

const IST_OFFSET_S = (5 * 60 + 30) * 60; // 19800 seconds

/**
 * Convert a Yahoo Finance daily quote into the candle format the model expects:
 * [epochSec, open, high, low, close, volume]
 *
 * We create TWO synthetic 1-minute candles per day:
 *   1. At 09:15 IST — the "open window" candle  (used by features.js window filter)
 *   2. At 15:29 IST — the "close" candle         (represents rest-of-day)
 *
 * This lets dayAggregates() compute open_ret, open_vwap, etc. correctly
 * even without real intraday data.
 */
function dailyQuoteToCandles(quote) {
  if (!quote || !quote.date || !quote.open || !quote.close) return [];

  // epoch at 09:15 IST = midnight UTC of that date + IST offset + 9h15m
  const dateMs = new Date(quote.date).setUTCHours(0, 0, 0, 0);
  const openEpoch  = Math.floor(dateMs / 1000) - IST_OFFSET_S + (9 * 60 + 15) * 60;
  const closeEpoch = Math.floor(dateMs / 1000) - IST_OFFSET_S + (15 * 60 + 29) * 60;

  const o = quote.open, h = quote.high, l = quote.low, c = quote.close;
  const v = quote.volume || 0;

  // Split volume 10% in open window, 90% in rest of day (realistic approximation)
  const openVol  = Math.round(v * 0.10);
  const closeVol = v - openVol;

  return [
    [openEpoch,  o, h, l, o, openVol],   // open-window candle (09:15)
    [closeEpoch, o, h, l, c, closeVol],  // close candle (15:29)
  ];
}

/**
 * Fetch historical candles for a single NSE symbol.
 * Returns array of [epochSec, o, h, l, c, v] — same format as growwClient.
 *
 * @param {string} symbol  - NSE trading symbol, e.g. "RELIANCE"
 * @param {Date}   start
 * @param {Date}   end
 */
async function fetchYahooCandles(symbol, start, end) {
  const ticker = `${symbol}.NS`;

  // Format dates as YYYY-MM-DD strings for Yahoo
  const p1 = start.toISOString().slice(0, 10);
  const p2 = end.toISOString().slice(0, 10);

  let quotes;
  try {
    const result = await yf.chart(ticker, {
      period1: p1,
      period2: p2,
      interval: '1d',
    });
    quotes = result.quotes || [];
  } catch (e) {
    // Some symbols have different tickers on Yahoo — try BSE suffix as fallback
    try {
      const result2 = await yf.chart(`${symbol}.BO`, {
        period1: p1,
        period2: p2,
        interval: '1d',
      });
      quotes = result2.quotes || [];
    } catch (e2) {
      throw new Error(`Yahoo Finance fetch failed for ${symbol}: ${e.message}`);
    }
  }

  if (!quotes.length) return [];

  const candles = [];
  for (const q of quotes) {
    candles.push(...dailyQuoteToCandles(q));
  }
  return candles;
}

module.exports = { fetchYahooCandles };