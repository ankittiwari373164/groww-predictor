'use strict';
const axios = require('axios');
const crypto = require('crypto');
const { authenticator } = require('otplib');
const { CFG } = require('./config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simple rate limiter: <= perSec per second and <= perMin per minute.
class RateLimiter {
  constructor(perSec, perMin) {
    this.perSec = perSec; this.perMin = perMin;
    this.sec = []; this.min = [];
  }
  async acquire() {
    /* eslint-disable no-constant-condition */
    while (true) {
      const now = Date.now();
      this.sec = this.sec.filter((t) => now - t < 1000);
      this.min = this.min.filter((t) => now - t < 60000);
      if (this.sec.length < this.perSec && this.min.length < this.perMin) {
        this.sec.push(now); this.min.push(now); return;
      }
      let wait = 60;
      if (this.sec.length >= this.perSec) wait = Math.max(wait, 1000 - (now - this.sec[0]));
      if (this.min.length >= this.perMin) wait = Math.max(wait, 60000 - (now - this.min[0]));
      await sleep(wait);
    }
  }
}

class GrowwClient {
  constructor() {
    this.token = null;
    this.live = new RateLimiter(9, 290);
  }

  async init() {
    this.token = await this._authenticate();
    this.http = axios.create({
      baseURL: CFG.baseUrl,
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'X-API-VERSION': CFG.apiVersion,
      },
    });
    return this;
  }

  async _postToken(body) {
    const r = await axios.post(`${CFG.baseUrl}/v1/token/api/access`, body, {
      headers: { Authorization: `Bearer ${CFG.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    const tok = r.data && (r.data.token || (r.data.payload && r.data.payload.token));
    if (!tok) throw new Error(`Token generation failed: ${JSON.stringify(r.data)}`);
    return tok;
  }

  async _authenticate() {
    if (CFG.accessToken) return CFG.accessToken;
    if (CFG.apiKey && CFG.totpSecret) {
      const totp = authenticator.generate(CFG.totpSecret);
      return this._postToken({ key_type: 'totp', totp });
    }
    if (CFG.apiKey && CFG.apiSecret) {
      const ts = String(Math.floor(Date.now() / 1000));
      const checksum = crypto.createHash('sha256').update(CFG.apiSecret + ts).digest('hex');
      return this._postToken({ key_type: 'approval', checksum, timestamp: ts });
    }
    throw new Error(
      'No Groww credentials. Set GROWW_API_KEY + GROWW_TOTP_SECRET (recommended), ' +
      'or GROWW_API_KEY + GROWW_API_SECRET, or GROWW_ACCESS_TOKEN in .env'
    );
  }

  async _get(pathUrl, params, tries = 4) {
    let last;
    for (let i = 0; i < tries; i++) {
      await this.live.acquire();
      try {
        const r = await this.http.get(pathUrl, { params });
        const j = r.data || {};
        if (j.status === 'FAILURE') throw new Error(JSON.stringify(j.error || j));
        return j.payload || {};
      } catch (e) {
        last = e;
        const code = e.response && e.response.status;
        await sleep((code === 429 ? 1500 : 600) * (i + 1));
      }
    }
    throw new Error(`GET ${pathUrl} failed: ${last && last.message}`);
  }

  // candles: [[epochSec, o, h, l, c, v], ...]
  async historicalCandles(symbol, start, end, intervalMinutes = 1, exchange = 'NSE', segment = 'CASH') {
    const maxSpan = { 1: 7, 5: 15, 10: 30, 60: 150, 240: 365, 1440: 1080 }[intervalMinutes] || 7;
    const out = [];
    let cur = new Date(start);
    const fmt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
    while (cur < end) {
      const chunkEnd = new Date(Math.min(cur.getTime() + maxSpan * 86400000, end.getTime()));
      const payload = await this._get('/v1/historical/candle/range', {
        exchange, segment, trading_symbol: symbol,
        start_time: fmt(cur), end_time: fmt(chunkEnd),
        interval_in_minutes: String(intervalMinutes),
      });
      if (payload.candles) out.push(...payload.candles);
      cur = chunkEnd;
    }
    return out;
  }

  async liveQuote(symbol, exchange = 'NSE', segment = 'CASH') {
    return this._get('/v1/live-data/quote', { exchange, segment, trading_symbol: symbol });
  }

  async instrumentsCsv() {
    const r = await axios.get(CFG.instrumentsUrl, { timeout: 30000 });
    return r.data;
  }
}

module.exports = { GrowwClient, RateLimiter };
