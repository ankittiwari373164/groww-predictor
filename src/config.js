'use strict';
require('dotenv').config();
const path = require('path');
const fs = require('fs');

function get(name, def = '') {
  return (process.env[name] || def).trim();
}

const DATA_DIR = path.resolve(get('DATA_DIR', './data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const CFG = {
  // auth
  accessToken: get('GROWW_ACCESS_TOKEN'),
  apiKey: get('GROWW_API_KEY'),
  apiSecret: get('GROWW_API_SECRET'),
  totpSecret: get('GROWW_TOTP_SECRET'),

  // prediction
  rankMetric: get('RANK_METRIC', 'turnover').toLowerCase(),
  openFrom: get('OPEN_FROM', '09:15'),
  openTo: get('OPEN_TO', '09:25'),
  universe: get('UNIVERSE', 'FNO').toUpperCase(),
  customSymbols: get('CUSTOM_SYMBOLS').split(',').map(s => s.trim()).filter(Boolean),
  modelMode: get('MODEL_MODE', 'auto').toLowerCase(),
  historyDays: parseInt(get('HISTORY_DAYS', '90'), 10) || 90,

  // server
  port: parseInt(get('PORT', '8000'), 10) || 8000,
  enableScheduler: ['1', 'true', 'yes', 'on'].includes(get('ENABLE_SCHEDULER', '0').toLowerCase()),
  runDatasetOnBoot: ['1', 'true', 'yes', 'on'].includes(get('RUN_DATASET_ON_BOOT', '0').toLowerCase()),

  // constants
  baseUrl: 'https://api.groww.in',
  instrumentsUrl: 'https://growwapi-assets.groww.in/instruments/instrument.csv',
  apiVersion: '1.0',

  dataDir: DATA_DIR,
  paths: {
    dataset: path.join(DATA_DIR, 'dataset.json'),
    shares: path.join(DATA_DIR, 'opening_shares.json'),
    predictions: path.join(DATA_DIR, 'predictions.json'),
    bestModel: path.join(DATA_DIR, 'best_model.json'),
    track: path.join(DATA_DIR, 'track.json'),
    universe: path.join(DATA_DIR, 'universe.json'),
  },
};

if (!['turnover', 'volume'].includes(CFG.rankMetric)) CFG.rankMetric = 'turnover';

module.exports = { CFG };
