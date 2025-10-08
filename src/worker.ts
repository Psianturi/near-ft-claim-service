import { createLogger } from './logger.js';
import { requeueOutstandingJobs } from './transfer-coordinator.js';

const log = createLogger({ module: 'worker' });

const REQUEUE_INTERVAL_MS = parseInt(process.env.WORKER_REQUEUE_INTERVAL_MS || '5000', 10);

log.info({ intervalMs: REQUEUE_INTERVAL_MS }, 'Worker process started. Re-queuing persisted jobs periodically.');

const requeue = () => {
  try {
    requeueOutstandingJobs();
  } catch (error: any) {
    log.error({ err: error }, 'Failed to requeue outstanding jobs');
  }
};

requeue();
setInterval(requeue, REQUEUE_INTERVAL_MS);