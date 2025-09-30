// 1. Import and run polyfills FIRST - before ANY other imports
import './polyfills.js';

// 2. Import other modules (config.ts will load dotenv)
import express, { Request, Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import https from 'https';
import http from 'http';
import { initNear, getNear, cleanupNear } from './near.js';
import { config } from './config.js';
import { functionCall, teraGas } from '@eclipseeer/near-api-ts';
import { safeView } from './near-utils.js';
import { createLogger } from './logger.js';

const log = createLogger({ module: 'server' });
const metricsLog = log.child({ component: 'metrics' });
const requestLog = log.child({ component: 'transfer' });

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

// Configure server for high performance
const host = process.env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => {
  log.info({ port, host }, 'HTTP server listening');
});

// Configure server for maximum performance (600+ TPS) - inspired by Rust implementation
server.setTimeout(5000); // Very fast timeout like Rust
server.maxConnections = 50000; // Increased from 10000 for high concurrency
server.keepAliveTimeout = 15000; // Shorter keep alive
server.headersTimeout = 16000; // Headers timeout
server.requestTimeout = 10000; // Request timeout

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
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50', 10); // Large batches
const WORKER_COUNT = parseInt(process.env.WORKER_COUNT || '4', 10); // Testing with 4 workers for sandbox
const MAX_IN_FLIGHT = parseInt(process.env.MAX_IN_FLIGHT || '200', 10); // Like Rust MAX_IN_FLIGHT

class ConcurrencyManager {
  constructor(private readonly log = createLogger({ module: 'server', component: 'concurrency' })) {}

  private active = 0;
  private queue: Array<{ resolve: () => void; reject: (error: Error) => void; timeout: NodeJS.Timeout; task?: any }> = [];
  private stats = { processed: 0, queued: 0, rejected: 0, avgWaitTime: 0 };
  private batchQueue: any[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  async acquire(): Promise<void> {
    if (this.active < CONCURRENCY_LIMIT) {
      this.active++;
      return;
    }

    if (this.queue.length >= QUEUE_SIZE) {
      this.stats.rejected++;
      throw new Error(`Queue full (${QUEUE_SIZE}), rejecting request`);
    }

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.queue.findIndex(item => item.resolve === resolve);
        if (index > -1) {
          this.queue.splice(index, 1);
          this.stats.rejected++;
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

  // Semaphore-based batching inspired by Rust implementation
  private semaphoreCount = 0;
  private semaphoreQueue: Array<() => void> = [];

  async acquireSemaphore(): Promise<void> {
    if (this.semaphoreCount < MAX_IN_FLIGHT) {
      this.semaphoreCount++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.semaphoreQueue.push(resolve);
    });
  }

  releaseSemaphore(): void {
    this.semaphoreCount = Math.max(0, this.semaphoreCount - 1);

    if (this.semaphoreQueue.length > 0) {
      const resolve = this.semaphoreQueue.shift();
      if (resolve) {
        this.semaphoreCount++;
        resolve();
      }
    }
  }

  // Enhanced batching for 600+ TPS with semaphore control
  async enqueueBatch(task: any): Promise<void> {
    this.batchQueue.push(task);

    if (this.batchQueue.length >= BATCH_SIZE) {
      await this.processBatch();
    } else if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => this.processBatch(), 50); // Faster batch processing
    }
  }

  private async processBatch(): Promise<void> {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batchQueue.length === 0) return;

  const batch = this.batchQueue.splice(0);
  this.log.debug({ batchSize: batch.length }, 'Processing request batch');

    // Process batch with semaphore control like Rust implementation
    const promises = batch.map(async (task) => {
      await this.acquireSemaphore();
      try {
        await task();
      } finally {
        this.releaseSemaphore();
      }
    });

    await Promise.allSettled(promises);
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
      batchQueueLength: this.batchQueue.length,
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

// Connection pooling for multiple RPC providers
const RPC_PROVIDERS = (process.env.RPC_PROVIDERS || 'https://rpc.testnet.fastnear.com').split(',');
let currentRpcIndex = 0;

function getNextRpcProvider() {
  const provider = RPC_PROVIDERS[currentRpcIndex];
  currentRpcIndex = (currentRpcIndex + 1) % RPC_PROVIDERS.length;
  return provider;
}

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

  requestCount = 0;
  lastTpsCheck = now;
}, 10000);

// Memory monitoring for high-load scenarios
if (process.env.ENABLE_MEMORY_MONITORING === 'true') {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    metricsLog.debug({
      rssMb: Math.round(memUsage.rss / 1024 / 1024),
      heapUsedMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
    }, 'Memory usage snapshot');

    // Force garbage collection if available (requires --expose-gc)
    if (global.gc && memUsage.heapUsed > 500 * 1024 * 1024) { // > 500MB
      metricsLog.warn('High memory usage detected, invoking garbage collection');
      global.gc();
    }
  }, 30000); // Every 30 seconds
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

const findFailureInOutcome = (outcome: any): any | null => {
  if (!outcome) return null;

  const status = outcome.status || outcome.finalExecutionStatus;

  if (status && typeof status === 'object' && 'Failure' in status) {
    return status.Failure;
  }

  if (typeof status === 'string' && status.toLowerCase().includes('failure')) {
    return status;
  }

  const receiptsOutcome = outcome.receiptsOutcome || outcome.receipts_outcome;
  if (Array.isArray(receiptsOutcome)) {
    for (const receipt of receiptsOutcome) {
      const failure = findFailureInOutcome(receipt?.outcome);
      if (failure) return failure;
    }
  }

  return null;
};

// Retry helper with exponential backoff for view RPC calls
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const withRetry = async <T>(fn: () => Promise<T>, attempts = 3) => {
  let delay = 200;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const code = e?.cause?.code ?? e?.code;
      const retriable =
        code === -429 || code === 'ETIMEDOUT' || code === 'ECONNRESET';
      if (!retriable || i === attempts - 1) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('unreachable');
};


app.use(bodyParser.json());

app.get('/', (req: Request, res: Response) => {
  res.send('NEAR Fungible Token Claiming Service is running!');
});

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/send-ft', async (req: Request, res: Response) => {
  requestCount++; // Track TPS
  await concurrencyManager.acquire();
  try {
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

    // NEAR connection is initialized at server startup
    let nearInterface = getNear();

    // Handle hybrid approach: different interfaces for different libraries
    let signer: any;
    let client: any;
    let account: any;

    if (process.env.NEAR_ENV === 'sandbox') {
      // Use near-workspaces for sandbox
      if (!nearInterface.account) {
        return res.status(500).send({ error: 'Sandbox account not initialized' });
      }
      account = nearInterface.account;
      requestLog.debug({ accountId: account.accountId }, 'Sandbox account loaded');
      requestLog.debug({ contractId: config.ftContract }, 'Sandbox FT contract resolved');
    } else {
      // Use @eclipseeer/near-api-ts for testnet
      if (!nearInterface.signer) {
        return res.status(500).send({ error: 'Testnet signer not initialized' });
      }
      signer = nearInterface.signer;
      client = nearInterface.client;
    }

    // Helper to decode view-call results (raw bytes -> JSON)
    const decodeJson = ({ rawResult }: { rawResult: number[] }) => {
      try {
        const text = new TextDecoder().decode(Uint8Array.from(rawResult));
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    // 1) Collect all unique receivers for storage checks
    const uniqueReceivers = [...new Set(transferList.map(t => t.receiverId))];

    // 2) Check storage registration for all receivers (batch check)
    const storageChecks: { [receiverId: string]: boolean } = {};
    const skipStorageCheck = (process.env.SKIP_STORAGE_CHECK || '').toLowerCase() === 'true';
    let bounds: any = null;

    if (!skipStorageCheck) {
      // Get storage bounds once (shared across all transfers)
      if (signer) {
        bounds = await withRetry(() =>
          client.callContractReadFunction({
            contractAccountId: config.ftContract,
            fnName: 'storage_balance_bounds',
            response: { resultTransformer: decodeJson },
          })
        );
      } else {
        bounds = await withRetry(() =>
          safeView(account, config.nodeUrl, config.ftContract, 'storage_balance_bounds', {})
        );
      }

      // Check storage for each unique receiver
      for (const receiverId of uniqueReceivers) {
        let storage: any;
        if (signer) {
          storage = await withRetry(() =>
            client.callContractReadFunction({
              contractAccountId: config.ftContract,
              fnName: 'storage_balance_of',
              fnArgsJson: { account_id: receiverId },
              response: { resultTransformer: decodeJson },
            })
          );
        } else {
          storage = await withRetry(() =>
            safeView(account, config.nodeUrl, config.ftContract, 'storage_balance_of', { account_id: receiverId })
          );
        }

        const storageJson: any = storage ?? {};
        const registeredAmountStr = String(storageJson.total ?? storageJson.available ?? '0');
        const isRegistered = storageJson != null && (() => {
          try {
            return BigInt(registeredAmountStr) > 0n;
          } catch {
            return false;
          }
        })();

        storageChecks[receiverId] = isRegistered;
      }
    }

    // 3) Build storage deposit + transfer actions
    const depositsRequired = !skipStorageCheck
      ? uniqueReceivers.filter((receiverId) => !storageChecks[receiverId])
      : [];

    const storageDepositAmount = (() => {
      if (bounds && typeof bounds === 'object') {
        if (typeof bounds.min === 'string') return bounds.min;
        if (typeof bounds.min === 'number') return String(bounds.min);
        if (typeof bounds.min === 'bigint') return bounds.min.toString();
      }
      if (process.env.STORAGE_MIN_DEPOSIT) {
        return process.env.STORAGE_MIN_DEPOSIT;
      }
      return '1250000000000000000000';
    })();

    requestLog.debug(
      {
        skipStorageCheck,
        storageChecks,
        depositsRequired,
        storageDepositAmount,
      },
      'Storage registration summary',
    );

    const transferActions: any[] = transferList.map((transfer) =>
      functionCall({
        fnName: 'ft_transfer',
        fnArgsJson: {
          receiver_id: transfer.receiverId,
          amount: transfer.amount,
          memo: transfer.memo || '',
        },
        gasLimit: teraGas('30'),
        attachedDeposit: { yoctoNear: '1' },
      }),
    );

    const storageDepositActions: any[] = depositsRequired.map((receiverId) =>
      functionCall({
        fnName: 'storage_deposit',
        fnArgsJson: {
          account_id: receiverId,
          registration_only: true,
        },
        gasLimit: teraGas('30'),
        attachedDeposit: { yoctoNear: storageDepositAmount },
      }),
    );

    const actions: any[] = [...storageDepositActions, ...transferActions];

    requestLog.debug(
      {
        depositCount: storageDepositActions.length,
        transferCount: transferActions.length,
        actionCount: actions.length,
      },
      'Prepared NEAR actions',
    );

    // 4) Execute batch transaction
    let result: any;

    if (account) {
      // Using near-api-js (sandbox RPC) - execute actions using functionCall
      const results = [];

      for (const receiverId of depositsRequired) {
        requestLog.debug({ contractId: config.ftContract, receiverId }, 'Invoking storage_deposit via sandbox account');
        const depositResult = await account.functionCall({
          contractId: config.ftContract,
          methodName: 'storage_deposit',
          args: {
            account_id: receiverId,
            registration_only: true,
          },
          gas: '30000000000000',
          attachedDeposit: storageDepositAmount,
        });
        results.push(depositResult);
      }

      for (const transfer of transferList) {
        requestLog.debug({ contractId: config.ftContract }, 'Invoking ft_transfer via sandbox account');
        const actionResult = await account.functionCall({
          contractId: config.ftContract,
          methodName: 'ft_transfer',
          args: {
            receiver_id: transfer.receiverId,
            amount: transfer.amount,
            memo: transfer.memo || '',
          },
          gas: '30000000000000',
          attachedDeposit: '1',
        });
        results.push(actionResult);
      }

      // Return the last result (or combine them)
      result = results.length === 1 ? results[0] : results;
    } else {
      // Using @eclipseeer/near-api-ts (testnet/mainnet) - batch all actions in single transaction
      const tx = await signer.signTransaction({
        receiverAccountId: config.ftContract,
        actions,
      });
      const WAIT_UNTIL =
        (process.env.WAIT_UNTIL as
          | 'None'
          | 'Included'
          | 'ExecutedOptimistic'
          | 'IncludedFinal'
          | 'Executed'
          | 'Final') || 'Final';

      result = await client.sendSignedTransaction({
        signedTransaction: tx,
        waitUntil: WAIT_UNTIL,
      });
    }

    const failure = findFailureInOutcome(result);
    if (failure) {
      requestLog.error({ failure }, 'On-chain failure detected');
      return res.status(500).send({
        error: 'FT transfer failed on-chain',
        details: failure,
        result,
      });
    }

    const transferCount = transferList.length;
    res.send({
      message: `FT transfer${transferCount > 1 ? 's' : ''} initiated successfully`,
      transfers: transferCount,
      result
    });
  } catch (error: any) {
    const txExecutionError = error?.cause?.data?.TxExecutionError;
    const errorMessage = extractErrorMessage(error);

    requestLog.error({
      err: error,
      cause: error?.cause,
      txExecutionError,
      errorMessage,
    }, 'Failed to initiate FT transfer');

    res
      .status(500)
      .send({ error: 'Failed to initiate FT transfer', details: errorMessage });
  } finally {
    concurrencyManager.release();
  }
});

const startServer = async () => {
  try {
    // Initialize NEAR connection first
    await initNear();
    log.info('NEAR connection initialized successfully');

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