import './polyfills.js';
import * as dotenv from 'dotenv';
dotenv.config();

import './worker.js';
import { initNear } from './near.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'worker-runner' });

(async () => {
  try {
    await initNear();
    log.info('Worker initialized and ready to process jobs');
  } catch (error) {
    log.error({ err: error }, 'Failed to initialize worker');
    process.exit(1);
  }
})();