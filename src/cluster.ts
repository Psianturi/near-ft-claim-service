import os from 'node:os';
import cluster from 'node:cluster';
import process from 'node:process';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'cluster' });

const resolveWorkerCount = () => {
  const envValue = process.env.CLUSTER_WORKERS || process.env.SANDBOX_CLUSTER_WORKERS || '';
  const parsed = parseInt(envValue, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  if (typeof (os as any).availableParallelism === 'function') {
    return (os as any).availableParallelism();
  }

  const cpuLength = os.cpus().length;
  return cpuLength > 0 ? cpuLength : 1;
};

const shouldRespawn = () => {
  const flag = (process.env.CLUSTER_RESPAWN || '').toLowerCase();
  return flag !== 'false' && flag !== '0';
};

const startCluster = async () => {
  const workerCount = resolveWorkerCount();

  if (cluster.isPrimary) {
    log.info({ workerCount, pid: process.pid }, 'Starting cluster master');

    for (let i = 0; i < workerCount; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      log.warn({ pid: worker.process.pid, code, signal }, 'Worker exited');
      if (shouldRespawn()) {
        log.info('Respawning worker');
        cluster.fork();
      }
    });
  } else {
    log.info({ pid: process.pid, workerId: cluster.worker?.id }, 'Starting cluster worker');
    await import('./index.js');
  }
};

startCluster().catch((error) => {
  log.fatal({ err: error }, 'Failed to start cluster');
  process.exit(1);
});
