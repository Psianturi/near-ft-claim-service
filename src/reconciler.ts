import persistence from './persistence-jsonl.js';
import { requeueJob } from './transfer-coordinator.js';
import { getNear } from './near.js';
import { createLogger } from './logger.js';
import { config } from './config.js';

// Use global fetch (node >=18) or node-fetch if needed

const log = createLogger({ module: 'reconciler' });

const CHECK_INTERVAL_MS = parseInt(process.env.RECONCILE_INTERVAL_MS || '10000', 10);
const MAX_WAIT_MS = parseInt(process.env.JOB_MAX_WAIT_MS || String(10 * 60 * 1000), 10); // 10 minutes

export async function startReconciler() {
  log.info('Starting reconciler: rehydrating jobs and scheduling checks');

  const near = getNear();
  const client = near.client;

  // Re-enqueue queued or processing jobs
  try {
    const all = persistence.listAllJobs();
    for (const j of all) {
      if (!j || !j.id) continue;
      if (j.status === 'queued' || j.status === 'processing') {
        try {
          requeueJob(j.id);
        } catch (e: any) {
          log.warn({ err: e?.message || e, jobId: j.id }, 'Failed to re-enqueue job');
        }
      }
    }
  } catch (e: any) {
    log.error({ err: e?.message || e }, 'Failed during reconciler rehydrate');
  }

  // Periodic check loop
  setInterval(async () => {
    try {
      const now = Date.now();
      const jobs = persistence.listAllJobs();
      const rpcUrl = process.env.RPC_URLS ? process.env.RPC_URLS.split(',')[0].trim() : config.nodeUrl;
      for (const job of jobs) {
        if (!job || !job.id) continue;
        if (job.status === 'submitted' && job.txHash) {
          // Accurate check via NEAR RPC 'tx' method (params: [txHash, signerAccountId])
          let finalized = false;
          try {
            if (rpcUrl) {
              const body = {
                jsonrpc: '2.0',
                id: 'reconcile',
                method: 'tx',
                params: [job.txHash, config.masterAccount],
              };
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 5000);
              const resp = await fetch(rpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
              }).catch(() => null);
              clearTimeout(timer);
              if (resp && resp.ok) {
                const payload = await resp.json().catch(() => null);
                if (payload && payload.result && payload.result.status) {
                  const st = payload.result.status;
                  // status can be { SuccessValue: '...' } or { Failure: {...} }
                  if (st.SuccessValue) {
                    persistence.updateJob(job.id, { status: 'finalized' });
                    log.info({ jobId: job.id, txHash: job.txHash }, 'Job finalized via RPC tx');
                    finalized = true;
                  } else if (st.Failure) {
                    persistence.updateJob(job.id, { status: 'failed', lastError: JSON.stringify(st.Failure) });
                    log.warn({ jobId: job.id, txHash: job.txHash, failure: st.Failure }, 'Job failed per RPC tx');
                    finalized = true;
                  }
                }
              }
            }
          } catch (e: any) {
            // ignore RPC errors; we'll fallback to timeout
            log.debug({ err: e?.message || e }, 'RPC tx status check failed');
          }

          // Fallback: if job older than MAX_WAIT_MS, mark failed
          const createdAt = new Date(job.createdAt).getTime();
          if (!finalized && now - createdAt > MAX_WAIT_MS) {
            persistence.updateJob(job.id, { status: 'failed', lastError: 'Timeout waiting for finalization' });
            log.warn({ jobId: job.id, txHash: job.txHash }, 'Job marked failed by timeout');
          }
        }
      }
    } catch (e: any) {
      log.error({ err: e?.message || e }, 'Error in reconciler loop');
    }
  }, CHECK_INTERVAL_MS);
}

export default { startReconciler };
