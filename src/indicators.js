'use strict';
// Technical indicators from a daily OHLC series. Plain-array ports of the
// Wilder/EMA formulas. Indicators organise past price; they are not a crystal ball.

function ewm(arr, alpha) {
  // exponentially-weighted mean series, adjust=false (recursive)
  const out = [];
  let prev;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    prev = i === 0 ? x : alpha * x + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}
function emaSpan(arr, span) { return ewm(arr, 2 / (span + 1)); }
const last = (a) => a[a.length - 1];

function rsi(closes, n = 14) {
  if (closes.length < n + 1) return NaN;
  const d = closes.slice(1).map((c, i) => c - closes[i]);
  const up = d.map((x) => (x > 0 ? x : 0));
  const dn = d.map((x) => (x < 0 ? -x : 0));
  const au = last(ewm(up, 1 / n));
  const ad = last(ewm(dn, 1 / n));
  const rs = au / (ad + 1e-12);
  return 100 - 100 / (1 + rs);
}

function macd(closes, fast = 12, slow = 26, sig = 9) {
  if (closes.length < slow + sig) return { macd: NaN, signal: NaN, hist: NaN };
  const ef = emaSpan(closes, fast), es = emaSpan(closes, slow);
  const line = ef.map((x, i) => x - es[i]);
  const signal = emaSpan(line, sig);
  return { macd: last(line), signal: last(signal), hist: last(line) - last(signal) };
}

function trueRanges(h, l, c) {
  const tr = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  return tr;
}

function atr(h, l, c, n = 14) {
  if (c.length < n + 1) return NaN;
  return last(ewm(trueRanges(h, l, c), 1 / n));
}

function adx(h, l, c, n = 14) {
  if (c.length < 2 * n) return NaN;
  const plusDM = [], minusDM = [];
  for (let i = 0; i < c.length; i++) {
    if (i === 0) { plusDM.push(0); minusDM.push(0); continue; }
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    plusDM.push(up > dn && up > 0 ? up : 0);
    minusDM.push(dn > up && dn > 0 ? dn : 0);
  }
  const atrS = ewm(trueRanges(h, l, c), 1 / n);
  const pdi = ewm(plusDM, 1 / n).map((x, i) => (100 * x) / (atrS[i] + 1e-12));
  const mdi = ewm(minusDM, 1 / n).map((x, i) => (100 * x) / (atrS[i] + 1e-12));
  const dx = pdi.map((p, i) => (100 * Math.abs(p - mdi[i])) / (p + mdi[i] + 1e-12));
  return last(ewm(dx, 1 / n));
}

function computeAll(highs, lows, closes, lastPrice = null, vwap = null) {
  let cl = closes.slice(), hi = highs.slice(), lo = lows.slice();
  if (lastPrice != null && cl.length) {
    cl = cl.concat(lastPrice);
    hi = hi.concat(Math.max(lastPrice, hi.length ? hi[hi.length - 1] : lastPrice));
    lo = lo.concat(Math.min(lastPrice, lo.length ? lo[lo.length - 1] : lastPrice));
  }
  const r = rsi(cl), m = macd(cl), a = atr(hi, lo, cl), ax = adx(hi, lo, cl);
  const votes = [];
  if (Number.isFinite(r)) votes.push((50 - r) / 50);
  if (Number.isFinite(m.hist)) votes.push(Math.tanh(m.hist / (Math.abs(cl[cl.length - 1]) * 0.005 + 1e-9)));
  if (vwap && lastPrice) votes.push(Math.tanh((lastPrice / vwap - 1) * 100));
  const indScore = votes.length ? Math.max(-1, Math.min(1, votes.reduce((s, x) => s + x, 0) / votes.length)) : 0;
  const rnd = (x, n) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null);
  return {
    rsi: rnd(r, 1), macd_hist: rnd(m.hist, 3), atr: rnd(a, 2), adx: rnd(ax, 1),
    ind_score: rnd(indScore, 3) || 0,
  };
}

module.exports = { rsi, macd, atr, adx, computeAll };
