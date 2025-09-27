import './polyfills.js';
import * as dotenv from 'dotenv';
dotenv.config();

import './worker.js';
import { initNear } from './near.js';

(async () => {
  try {
    await initNear();
    console.log('Worker initialized and ready to process jobs');
  } catch (error) {
    console.error('Failed to initialize worker:', error);
    process.exit(1);
  }
})();