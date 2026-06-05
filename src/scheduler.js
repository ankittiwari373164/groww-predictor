'use strict';
const cron = require('node-cron');
const fs = require('fs');
const { CFG } = require('./config');

const TZ = { timezone: 'Asia/Kolkata' };

async function jobPredict() {
  try {
    const { GrowwClient } = require('./growwClient');
    const { predictLive } = require('./predictLive');
    const client = await new GrowwClient().init();
    await predictLive(client);
  } catch (e) { console.log(`[sched] predict failed: ${e.message}`); }
}
async function jobScore() {
  try {
    const { GrowwClient } = require('./growwClient');
    const { scorePending } = require('./tracker');
    const client = await new GrowwClient().init();
    console.log('[sched] score:', JSON.stringify(await scorePending(client)));
  } catch (e) { console.log(`[sched] score failed: ${e.message}`); }
}
async function jobDataset() {
  try {
    const { GrowwClient } = require('./growwClient');
    const { buildDataset } = require('./buildDataset');
    const { backtest } = require('./backtest');
    const client = await new GrowwClient().init();
    await buildDataset(client);
    backtest();
  } catch (e) { console.log(`[sched] dataset failed: ${e.message}`); }
}

function startScheduler() {
  if (!CFG.enableScheduler) { console.log('[sched] disabled (ENABLE_SCHEDULER=0)'); return; }
  if (CFG.runDatasetOnBoot && !fs.existsSync(CFG.paths.dataset)) {
    console.log('[sched] no dataset — building on boot (background)');
    jobDataset();
  }
  cron.schedule('25 9 * * 1-5', jobPredict, TZ);
  cron.schedule('0 16 * * 1-5', jobScore, TZ);
  cron.schedule('0 18 * * 0', jobDataset, TZ);
  console.log('[sched] started — predict 09:25, score 16:00 (Mon-Fri IST), rebuild Sun 18:00 IST');
}

module.exports = { startScheduler, jobPredict, jobScore, jobDataset };
