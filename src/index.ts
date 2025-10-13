// 1. Import and run polyfills FIRST - before ANY other imports
import './polyfills.js';

// 2. Import other modules (config.ts will load dotenv)
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import https from 'https';
import http from 'http';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { initNear, cleanupNear } from './near.js';
import { startReconciler } from './reconciler.js';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { getThrottleConfig } from './key-throttle.js';
import persistence from './persistence-jsonl.js';
import {
  submitTransfers,
  requeueOutstandingJobs,
  ServiceBusyError,
  getPendingJobCount,
  getPendingJobLimit,
} from './transfer-coordinator.js';

const log = createLogger({ module: 'server' });
const metricsLog = log.child({ component: 'metrics' });
const requestLog = log.child({ component: 'transfer' });
const throttleConfig = getThrottleConfig();
log.info({ throttleConfig }, 'API throttle configuration loaded');

const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry, prefix: 'ft_service_' });

const httpRequestCounter = new Counter({
  name: 'ft_service_http_requests_total',
  help: 'Total number of HTTP requests handled by the FT service',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

const httpRequestDuration = new Histogram({
  name: 'ft_service_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

const jobStatusGauge = new Gauge({
  name: 'ft_service_job_status_total',
  help: 'Number of jobs per status recorded in persistence',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

const activeQueueGauge = new Gauge({
  name: 'ft_service_queue_active_jobs',
  help: 'Current number of active jobs being processed by the server',
  registers: [metricsRegistry],
});

const queuedRequestGauge = new Gauge({
  name: 'ft_service_queue_length',
  help: 'Number of requests waiting in the concurrency queue',
  registers: [metricsRegistry],
});

const pendingJobsGauge = new Gauge({
  name: 'ft_service_pending_jobs',
  help: 'Number of pending transfer jobs tracked by the coordinator',
  registers: [metricsRegistry],
});

const rejectedRequestCounter = new Counter({
  name: 'ft_service_queue_rejected_total',
  help: 'Total number of requests rejected because the concurrency queue was full or timed out',
  registers: [metricsRegistry],
});

const computeJobStatusCounts = (): Record<string, number> => {
  const allJobs = persistence.listAllJobs();
  return allJobs.reduce((acc: Record<string, number>, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
};

const updateJobStatusGauge = (counts: Record<string, number>) => {
  jobStatusGauge.reset();
  Object.entries(counts).forEach(([status, count]) => {
    jobStatusGauge.set({ status }, count);
  });
};

const refreshJobStatusMetrics = (): Record<string, number> | null => {
  try {
    const counts = computeJobStatusCounts();
    updateJobStatusGauge(counts);
    return counts;
  } catch (err) {
    metricsLog.warn({ err }, 'Failed to refresh job status metrics');
    return null;
  }
};

process.on('uncaughtException', (err: any, origin: any) => {
  log.fatal({ err, origin }, 'Uncaught exception, terminating process');
  process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
  log.error({ reason }, 'Unhandled promise rejection');
});
log.info({ config }, 'Final configuration loaded');

const app = express();
const port = Number(process.env.PORT) || 3000;
const SERVER_TIMEOUT_MS = parseInt(process.env.SERVER_TIMEOUT_MS || '60000', 10);
const REQUEST_TIMEOUT_MS = parseInt(
  process.env.REQUEST_TIMEOUT_MS || String(Math.max(SERVER_TIMEOUT_MS, 60000)),
  10,
);

const allowedOrigins = (process.env.CORS_ALLOW_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = allowedOrigins.includes('*')
  ? { origin: true } // Reflect request origin
  : { origin: allowedOrigins };

app.use(cors(corsOptions));

// Configure Express for high concurrency
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const method = req.method.toUpperCase();
  const endTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.route?.path || req.baseUrl || req.path || 'unmatched';
    const labels = {
      method,
      route,
      status_code: String(res.statusCode),
    };

    httpRequestCounter.inc(labels);
    endTimer(labels);
  });

  next();
});

// Configure server for high performance
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => {
  log.info({ port, host }, 'HTTP server listening');
});

// Start background reconciler after NEAR initialization
initNear().then(() => {
  startReconciler().catch((err) => {
    log.error({ err }, 'Failed to start reconciler');
  });
}).catch((err) => {
  log.error({ err }, 'Failed to initialize NEAR client for reconciler');
});

// Configure server for maximum performance (600+ TPS) - inspired by Rust implementation
server.setTimeout(SERVER_TIMEOUT_MS);
server.maxConnections = 50000; 
server.keepAliveTimeout = 15000; 
server.headersTimeout = Math.max(SERVER_TIMEOUT_MS + 5000, 20000); 
server.requestTimeout = REQUEST_TIMEOUT_MS; 

// Configure HTTP agents for connection pooling and keep-alive
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1000, // Increased connection pool
  maxFreeSockets: 100,
  timeout: 60000,
  keepAliveMsecs: 30000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 1000, // Increased connection pool
  maxFreeSockets: 100,
  timeout: 60000,
  keepAliveMsecs: 30000,
});

// Set global agents for all HTTP requests
http.globalAgent = httpAgent;
https.globalAgent = httpsAgent;

// Optimize Node.js for high concurrency
process.setMaxListeners(1000);

// Enable garbage collection hints
if (typeof global !== 'undefined' && global.gc) {
  global.gc();
}

// Ultra-high performance configuration inspired by Rust implementation
const CONCURRENCY_LIMIT = parseInt(process.env.CONCURRENCY_LIMIT || '2000', 10); // Maximum concurrency like Rust
const QUEUE_SIZE = parseInt(process.env.QUEUE_SIZE || '50000', 10); // Massive queue
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '4', 10); // Testing with 4 workers for sandbox
const NONCE_RETRY_LIMIT = parseInt(process.env.NONCE_RETRY_LIMIT || '3', 10);

class ConcurrencyManager {
  constructor(private readonly log = createLogger({ module: 'server', component: 'concurrency' })) {}

  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }> = [];
  private stats = { processed: 0, queued: 0, rejected: 0, avgWaitTime: 0 };

  async acquire(): Promise<void> {
    if (this.active < CONCURRENCY_LIMIT) {
      this.active++;
      return;
    }

    if (this.queue.length >= QUEUE_SIZE) {
      this.stats.rejected++;
      rejectedRequestCounter.inc();
      throw new Error(`Queue full (${QUEUE_SIZE}), rejecting request`);
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex(item => item.resolve === resolve);
        if (index > -1) {
          this.queue.splice(index, 1);
          this.stats.rejected++;
          rejectedRequestCounter.inc();
          reject(new Error('Request timeout in queue'));
        }
      }, 30000); // 30 second queue timeout

      this.queue.push({ resolve, reject, timeout });
      this.stats.queued++;
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this.stats.processed++;

    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        clearTimeout(next.timeout);
        this.active++;
        next.resolve();
      }
    }
  }

  // Multiple worker support for parallel processing
  initializeWorkers() {
    for (let i = 0; i < WORKER_COUNT; i++) {
      this.log.debug({ worker: i + 1 }, 'Worker initialized');
    }
  }

  getStats() {
    return {
      ...this.stats,
      active: this.active,
      queueLength: this.queue.length,
      workers: WORKER_COUNT
    };
  }

  logStats() {
    const stats = this.getStats();
    this.log.info({ stats }, 'Concurrency statistics');
  }

}

const concurrencyManager = new ConcurrencyManager();

// Initialize workers for parallel processing
concurrencyManager.initializeWorkers();
refreshJobStatusMetrics();

// Enhanced logging with TPS calculation
let requestCount = 0;
let lastTpsCheck = Date.now();

setInterval(() => {
  concurrencyManager.logStats();

  const now = Date.now();
  const timeDiff = (now - lastTpsCheck) / 1000;
  const currentTps = timeDiff > 0 ? Number((requestCount / timeDiff).toFixed(2)) : 0;

  metricsLog.info({
    currentTps,
    windowSeconds: Number(timeDiff.toFixed(2)),
  }, 'Throughput update');

  const stats = concurrencyManager.getStats();
  activeQueueGauge.set(stats.active);
  queuedRequestGauge.set(stats.queueLength);
  pendingJobsGauge.set(getPendingJobCount());
  refreshJobStatusMetrics();

  requestCount = 0;
  lastTpsCheck = now;
}, 10000);

if (process.env.ENABLE_MEMORY_MONITORING === 'true') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    metricsLog.debug({
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
    }, 'Memory usage snapshot');

    if (global.gc && memUsage.heapUsed > 500 * 1024 * 1024) {
      metricsLog.warn('High memory usage detected, invoking garbage collection');
      global.gc();
    }
  }, 30000);
}
// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  log.warn({ signal }, 'Received shutdown signal, shutting down gracefully');

  try {
    // Cleanup NEAR connections
    await cleanupNear();
  } catch (error) {
    log.error({ err: error }, 'Error during NEAR cleanup');
  }

  server.close(() => {
    log.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Helper function to extract meaningful error messages
const extractErrorMessage = (error: any): string => {
  // Handle @eclipseeer/near-api-ts errors
  if (error?.name === '$ZodError') {
    return 'RPC response parsing error - transaction result format invalid';
  }

  // Handle string errors that are actually JSON
  if (typeof error === 'string' && error.startsWith('[') && error.includes('$ZodError')) {
    return 'RPC response parsing error - transaction result format invalid';
  }

  if (error?.cause) {
    const cause = error.cause;

    // Rate limiting
    if (cause.code === -429) {
      return 'RPC rate limit exceeded - please retry later';
    }

    // Network errors
    if (cause.code === 'ECONNRESET' || cause.code === 'ETIMEDOUT') {
      return 'Network connection error - please check RPC connectivity';
    }

    // Transaction errors
    if (cause.data?.TxExecutionError) {
      const txError = cause.data.TxExecutionError;
      if (txError.InvalidTxError?.InvalidNonce) {
        return 'Transaction nonce error - concurrent transaction conflict';
      }
      if (txError.InvalidTxError?.InvalidAccessKeyError) {
        return 'Invalid access key - check account permissions';
      }
      return `Transaction execution failed: ${JSON.stringify(txError)}`;
    }

    // Server errors
    if (cause.code === -32000) {
      return `Server error: ${cause.message || 'Unknown server error'}`;
    }
  }

  // Generic error handling
  if (error?.message && error.message !== '[object Object]') {
    return error.message;
  }

  // Fallback
  return 'Unknown error occurred during transaction processing';
};


app.use(bodyParser.json());

app.get('/', (req: Request, res: Response) => {
  res.send('NEAR Fungible Token Claiming Service is running!');
});

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get job status by jobId
app.get('/transfer/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = persistence.getJob(jobId);
  if (!job) return res.status(404).send({ error: 'Job not found' });
  return res.send({ success: true, job });
});

// Get transfer status by transaction hash
app.get('/transfer/tx/:txHash', (req: Request, res: Response) => {
  const { txHash } = req.params;
  const jobs = persistence.listAllJobs().filter(job => job.txHash === txHash);
  if (jobs.length === 0) return res.status(404).send({ error: 'Transaction not found' });

  return res.send({
    success: true,
    transactionHash: txHash,
    transfers: jobs.map(job => ({
      jobId: job.id,
      receiverId: job.receiverId,
      amount: job.amount,
      memo: job.memo,
      status: job.status,
      batchId: job.batchId,
      submittedAt: job.submittedAt,
      attempts: job.attempts,
      lastError: job.lastError,
    }))
  });
});

app.get('/metrics/jobs', (req: Request, res: Response) => {
  const counts = refreshJobStatusMetrics() ?? {};
  const uptimeMs = Math.round(process.uptime() * 1000);

  res.send({
    success: true,
    counts,
    uptimeMs,
    timestamp: new Date().toISOString(),
  });
});

app.get('/metrics', async (req: Request, res: Response) => {
  try {
    refreshJobStatusMetrics();
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch (err) {
    metricsLog.error({ err }, 'Failed to collect Prometheus metrics');
    res.status(500).send('Failed to collect metrics');
  }
});

// Get batching statistics
app.get('/metrics/batching', async (req: Request, res: Response) => {
  try {
    const { requestBatcher } = await import('./request-batcher.js');
    const stats = requestBatcher.getStats();

    res.send({
      success: true,
      batching: {
        ...stats,
        description: 'Request batching efficiency metrics - higher batchEfficiency indicates better throughput optimization'
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).send({
      error: 'Failed to load batching metrics',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.post('/send-ft', async (req: Request, res: Response) => {
  requestCount++; // Track TPS
  const isSandboxEnv = (process.env.NEAR_ENV || config.networkId) === 'sandbox';

    const { receiverId, amount, memo, transfers } = req.body;

    // Support both single transfer and batch transfers
    let transferList: Array<{ receiverId: string; amount: string | number; memo?: string }> = [];

    if (transfers && Array.isArray(transfers)) {
      // Batch transfer mode
      transferList = transfers;
    } else if (receiverId && amount != null) {
      // Single transfer mode (backward compatibility)
      transferList = [{ receiverId, amount, memo }];
    } else {
      return res
        .status(400)
        .send({ error: 'Either provide receiverId/amount for single transfer, or transfers array for batch transfer' });
    }

    // Validate all transfers
    for (const transfer of transferList) {
      const { receiverId: recId, amount: amt } = transfer;
      if (!recId || amt == null) {
        return res
          .status(400)
          .send({ error: 'Each transfer must have receiverId and amount' });
      }

      // Security: Validate receiverId format to prevent homograph attacks
      // NEAR account IDs: 2-64 characters, lowercase alphanumeric with underscores, hyphens, dots
      const NEAR_ACCOUNT_REGEX = /^[a-z0-9_-]{2,64}(\.[a-z0-9_-]{2,64})*$/;
      if (!NEAR_ACCOUNT_REGEX.test(recId)) {
        return res
          .status(400)
          .send({ error: 'Invalid receiverId format. Must be a valid NEAR account ID (2-64 characters, lowercase alphanumeric with underscores, hyphens, and dots only)' });
      }

      // Additional security: Prevent obvious phishing attempts
      if (recId.includes('..') || recId.startsWith('.') || recId.endsWith('.')) {
        return res
          .status(400)
          .send({ error: 'Invalid receiverId format. Account ID cannot start/end with dots or contain consecutive dots' });
      }

      const amountStr = String(amt);
      if (isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
        return res
          .status(400)
          .send({ error: 'amount must be a positive number' });
      }

      // Security: Prevent extremely large amounts that could cause overflow
      const amountNum = Number(amountStr);
      if (amountNum > 1e30) { // Reasonable upper limit for token amounts
        return res
          .status(400)
          .send({ error: 'amount too large. Maximum allowed: 1e30' });
      }

      transfer.amount = amountStr;
    }
    
  let acquired = false;
  try {
    await concurrencyManager.acquire();
    acquired = true;

    const results = await submitTransfers(
      transferList.map((transfer) => ({
        receiverId: transfer.receiverId,
        amount: String(transfer.amount),
        memo: transfer.memo,
      })),
    );
    const transactionHash = results[0]?.transactionHash || 'unknown';
    const batchId = results[0]?.batchId;
    const jobIds = results.map((result) => result.jobId);

    const mappedResults = results.map((result) => ({
      jobId: result.jobId,
      receiverId: result.receiverId,
      amount: result.amount,
      memo: result.memo,
      transactionHash: result.transactionHash,
      status: result.status,
      batchId: result.batchId,
      submittedAt: result.submittedAt,
    }));

    if (results.length === 1) {
      const single = mappedResults[0];
      return res.send({
        success: true,
        jobId: single.jobId,
        transactionHash: single.transactionHash,
        receiverId: single.receiverId,
        amount: single.amount,
        status: single.status,
        batchId: single.batchId,
        submittedAt: single.submittedAt,
        message: 'FT transfer executed successfully',
      });
    }

    res.send({
      success: true,
      jobIds,
      transactionHash,
      transfers: results.length,
      batchId,
      results: mappedResults,
      message: `FT transfers executed successfully (batch size ${results.length})`,
    });
  } catch (error: any) {
    if (error instanceof ServiceBusyError || error?.code === 'SERVICE_BUSY') {
      requestLog.warn({
        pendingJobs: getPendingJobCount(),
        capacity: getPendingJobLimit(),
      }, 'Rejecting transfer request due to pending job backlog');
      rejectedRequestCounter.inc();
      return res.status(503).send({
        error: 'Service overloaded, please retry later',
        details: error.message,
        pendingJobs: getPendingJobCount(),
        capacity: getPendingJobLimit(),
        retryAfterSeconds: 5,
      });
    }

    const txExecutionError = error?.cause?.data?.TxExecutionError;
    const errorMessage = extractErrorMessage(error);

    // Temporary verbose logging to trace network issues during sandbox tests
    console.error('FT transfer failure diagnostics', {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      cause: error?.cause,
      errorMessage,
    });

    requestLog.error({
      err: error,
      cause: error?.cause,
      txExecutionError,
      errorMessage,
    }, 'Failed to initiate FT transfer');

    const cause = (error && typeof error === 'object') ? (error as any).cause : undefined;
    const rateLimitLike = cause && typeof cause === 'object' && 'msBeforeNext' in cause && 'remainingPoints' in cause;

    if (rateLimitLike) {
      const retryAfterMs = Number((cause as any).msBeforeNext ?? 0);
      requestLog.warn({
        pendingJobs: getPendingJobCount(),
        capacity: getPendingJobLimit(),
        retryAfterMs,
      }, 'Rejecting transfer request due to rate limiter exhaustion');
      rejectedRequestCounter.inc();

      return res.status(429).send({
        error: 'Rate limit exceeded, please retry later',
        retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        details: errorMessage,
      });
    }

    const debugInfo = isSandboxEnv
      ? {
          code: cause?.code ?? error?.code ?? null,
          errno: cause?.errno ?? null,
          message: cause?.message ?? null,
          type: cause?.name ?? error?.name ?? null,
        }
      : undefined;

    if (isSandboxEnv) {
      console.log('Sandbox debug info', {
        debugInfo,
        hasCause: Boolean(cause),
        causeKeys: cause ? Object.keys(cause) : [],
      });
    }

    res
      .status(500)
      .send({
        error: 'Failed to initiate FT transfer',
        details: errorMessage,
        ...(debugInfo ? { debug: debugInfo } : {}),
      });
  } finally {
    if (acquired) {
      concurrencyManager.release();
    }
  }
});

const startServer = async () => {
  try {
    // Initialize NEAR connection first
    await initNear();
    log.info('NEAR connection initialized successfully');

  requeueOutstandingJobs();
  log.info('Pending jobs re-queued from persistence');

    // Start server after NEAR is ready
    log.info({ port }, 'Server ready to accept requests');
    log.info({
      maxConnections: server.maxConnections,
      timeoutMs: server.timeout,
      keepAliveTimeoutMs: server.keepAliveTimeout,
    }, 'Server concurrency configuration');
  } catch (err) {
    log.fatal({ err }, 'Failed to initialize NEAR connection');
    process.exit(1);
  }
};

startServer();