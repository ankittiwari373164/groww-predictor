'use strict';
const fs = require('fs');
const { CFG } = require('./config');
const { GrowwClient } = require('./growwClient');
const { buildUniverse } = require('./universe');
const { symbolDayRows, finalizePanel, addLabels } = require('./features');
const { fetchYahooCandles } = require('./yahooHistory');

/**
 * Try Groww first; fall back to Yahoo Finance if Groww returns 403/error.
 * This way the code automatically uses Groww if they ever open historical access.
 */
async function fetchCandles(client, symbol, start, end) {
  try {
    const candles = await client.historicalCandles(symbol, start, end, 1);
    if (candles && candles.length > 0) return { candles, source: 'groww' };
  } catch (e) {
    // Groww historical not available (403) — fall through to Yahoo
  }
  const candles = await fetchYahooCandles(symbol, start, end);
  return { candles, source: 'yahoo' };
}

async function buildDataset(client, maxSymbols = null) {
  client = client || (await new GrowwClient().init());
  const uni = await buildUniverse(client);
  let symbols = uni.map((u) => u.trading_symbol);
  const cap = maxSymbols || parseInt(process.env.DATASET_MAX_SYMBOLS || '0', 10) || 0;
  if (cap > 0) symbols = symbols.slice(0, cap);

  const end = new Date();
  const start = new Date(end.getTime() - CFG.historyDays * 86400000);

  // Track how many came from each source
  const sourceCounts = { groww: 0, yahoo: 0, error: 0 };

  let rows = [];
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const { candles, source } = await fetchCandles(client, sym, start, end);
      sourceCounts[source]++;
      rows = rows.concat(symbolDayRows(sym, candles, CFG.openFrom, CFG.openTo));
      if ((i + 1) % 20 === 0 || i + 1 === symbols.length) {
        console.log(`[dataset] ${i + 1}/${symbols.length} ${sym}: ${candles.length} candles [${source}] | rows so far: ${rows.length}`);
      }
    } catch (e) {
      sourceCounts.error++;
      console.log(`[dataset] ${i + 1}/${symbols.length} ${sym}: ERROR ${e.message}`);
    }
  }

  console.log(`[dataset] sources — groww: ${sourceCounts.groww}, yahoo: ${sourceCounts.yahoo}, errors: ${sourceCounts.error}`);

  const panel = finalizePanel(rows);
  if (!panel.length) { console.log('[dataset] empty — check credentials / data access'); return panel; }
  addLabels(panel, CFG.rankMetric);
  fs.writeFileSync(CFG.paths.dataset, JSON.stringify(panel));

  // Latest opening share per symbol
  const lastBySym = {};
  for (const r of panel) lastBySym[r.symbol] = r.open_share_hist;
  fs.writeFileSync(CFG.paths.shares, JSON.stringify(lastBySym));

  console.log(`[dataset] saved ${panel.length} rows -> ${CFG.paths.dataset}`);
  return panel;
}

module.exports = { buildDataset };