'use strict';
const fs = require('fs');
const Papa = require('papaparse');
const { CFG } = require('./config');

const FALLBACK = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'INFY', 'TCS', 'AXISBANK', 'KOTAKBANK',
  'ITC', 'LT', 'BHARTIARTL', 'TATAMOTORS', 'TATASTEEL', 'WIPRO', 'BAJFINANCE', 'HINDALCO',
  'ADANIENT', 'ADANIPORTS', 'MARUTI', 'SUNPHARMA', 'ONGC', 'POWERGRID', 'NTPC', 'COALINDIA',
  'JSWSTEEL', 'VEDL', 'IDEA', 'YESBANK', 'PNB', 'BANKBARODA', 'ZOMATO', 'IRFC', 'GAIL',
];

async function buildUniverse(client) {
  if (CFG.universe === 'CUSTOM' && CFG.customSymbols.length) {
    const df = CFG.customSymbols.map((s) => ({ trading_symbol: s, exchange: 'NSE', segment: 'CASH' }));
    fs.writeFileSync(CFG.paths.universe, JSON.stringify(df));
    return df;
  }
  let symbols = [];
  try {
    const text = await client.instrumentsCsv();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data;
    const cashEq = new Set(
      rows.filter((r) => r.segment === 'CASH' && r.exchange === 'NSE' && (r.series || 'EQ') === 'EQ')
        .map((r) => r.trading_symbol)
    );
    if (CFG.universe === 'FNO') {
      const und = new Set(
        rows.filter((r) => r.segment === 'FNO' && r.exchange === 'NSE')
          .map((r) => r.underlying_symbol).filter(Boolean)
      );
      symbols = [...und].filter((s) => cashEq.has(s)).sort();
    } else {
      symbols = [...cashEq].sort();
    }
    if (!symbols.length) throw new Error('empty universe from CSV');
  } catch (e) {
    console.log(`[universe] fallback to static list (${e.message})`);
    symbols = FALLBACK;
  }
  const df = symbols.map((s) => ({ trading_symbol: s, exchange: 'NSE', segment: 'CASH' }));
  fs.writeFileSync(CFG.paths.universe, JSON.stringify(df));
  console.log(`[universe] ${df.length} symbols (${CFG.universe})`);
  return df;
}

module.exports = { buildUniverse, FALLBACK };
