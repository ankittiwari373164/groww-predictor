'use strict';
// CLI for cron / manual use:  node cli.js predict|score|build|backtest
const { GrowwClient } = require('./src/growwClient');

(async () => {
  const cmd = process.argv[2];
  try {
    if (cmd === 'predict') {
      const client = await new GrowwClient().init();
      await require('./src/predictLive').predictLive(client);
    } else if (cmd === 'score') {
      const client = await new GrowwClient().init();
      console.log(JSON.stringify(await require('./src/tracker').scorePending(client), null, 2));
    } else if (cmd === 'build') {
      const client = await new GrowwClient().init();
      await require('./src/buildDataset').buildDataset(client);
    } else if (cmd === 'backtest') {
      require('./src/backtest').backtest();
    } else {
      console.log('usage: node cli.js predict|score|build|backtest');
      process.exit(1);
    }
  } catch (e) { console.error('ERROR:', e.message); process.exit(1); }
})();
