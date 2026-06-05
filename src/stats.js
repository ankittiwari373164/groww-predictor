'use strict';

const num = (x) => (x === null || x === undefined || Number.isNaN(Number(x)) ? NaN : Number(x));

function mean(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
}
function median(arr) {
  const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function std(arr) {
  const a = arr.filter((x) => Number.isFinite(x));
  if (a.length < 2) return NaN;
  const mu = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - mu) ** 2, 0) / (a.length - 1));
}
function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
const tanh = Math.tanh;
function round(x, n = 2) {
  if (!Number.isFinite(Number(x))) return null;
  const p = 10 ** n;
  return Math.round(Number(x) * p) / p;
}

module.exports = { num, mean, median, std, clip, tanh, round };
