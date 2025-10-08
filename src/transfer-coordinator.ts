import { BatchableTransfer, RequestBatcher } from './request-batcher.js';
import persistence, { JobState } from './persistence-jsonl.js';
import { config } from './config.js';
import { getNear } from './near.js';
import { createLogger } from './logger.js';
import { functionCall, teraGas } from '@eclipseeer/near-api-ts';
import { throttleGlobal, throttleKey } from './key-throttle.js';

const log = createLogger({ module: 'transfer-coordinator' });

export type TransferRequestInput = {
  receiverId: string;
  amount: string;
  memo?: string;
};

export type TransferExecutionResult = {
  jobId: string;
  receiverId: string;
  amount: string;
  memo?: string;
  transactionHash: string;
  status: string;
  batchId: string;
  submittedAt: string;
};

const batcher = new RequestBatcher();
const inFlightJobs = new Set<string>();
const pendingResolutions = new Map<
  string,
  {
    resolve?: (value: TransferExecutionResult) => void;
    reject?: (reason: any) => void;
  }
>();

const WAIT_UNTIL = (() => {
  const explicit = process.env.WAIT_UNTIL as
    | 'None'
    | 'Included'
    | 'ExecutedOptimistic'
    | 'IncludedFinal'
    | 'Executed'
    | 'Final'
    | undefined;
  if (explicit) {
    return explicit;
  }
  if (config.networkId === 'sandbox') {
    return 'Included';
  }
  return 'Final';
})();
const NONCE_RETRY_LIMIT = parseInt(process.env.NONCE_RETRY_LIMIT || '3', 10);
const SKIP_STORAGE_CHECK = (process.env.SKIP_STORAGE_CHECK || '').toLowerCase() === 'true';
const STORAGE_MIN_DEPOSIT = process.env.STORAGE_MIN_DEPOSIT || '1250000000000000000000';
const MAX_JOB_ATTEMPTS = parseInt(process.env.JOB_MAX_ATTEMPTS || '5', 10);
const JOB_RETRY_BASE_MS = parseInt(process.env.JOB_RETRY_BASE_MS || '500', 10);

let batchSequence = 0;

batcher.on('batch', async (batch) => {
  if (batch.length === 0) return;
  const batchId = `batch-${Date.now()}-${++batchSequence}`;
  try {
    await processBatch(batch, batchId);
  } catch (error) {
    log.error({ err: error, batchId }, 'Batch processing failed');
  }
});

export async function submitTransfers(
  transfers: TransferRequestInput[],
): Promise<TransferExecutionResult[]> {
  const jobs = transfers.map((transfer) => {
    const job = persistence.createJob({
      receiverId: transfer.receiverId,
      amount: transfer.amount,
      memo: transfer.memo,
    });
    return job;
  });

  const promises = jobs.map(
    (job) =>
      new Promise<TransferExecutionResult>((resolve, reject) => {
        pendingResolutions.set(job.id, { resolve, reject });
        queueJob(job);
      }),
  );

  return Promise.all(promises);
}

export function requeueOutstandingJobs(): void {
  const jobs = persistence.listAllJobs();
  for (const job of jobs) {
    if (!job || !job.id) continue;
    if (job.status === 'queued' || job.status === 'processing') {
      log.info({ jobId: job.id, status: job.status }, 'Re-queuing persisted job');
      queueJob(job);
    }
  }
}

export function requeueJob(jobId: string): void {
  const job = persistence.getJob(jobId);
  if (!job) return;
  queueJob(job);
}

function queueJob(job: JobState): void {
  if (!job || !job.id) return;
  if (inFlightJobs.has(job.id)) {
    return;
  }

  if (job.status !== 'queued') {
    persistence.updateJob(job.id, { status: 'queued' });
  }

  inFlightJobs.add(job.id);
  batcher.queue({
    jobId: job.id,
    receiverId: job.receiverId,
    amount: job.amount,
    memo: job.memo,
  });
}

async function processBatch(batch: BatchableTransfer[], batchId: string): Promise<void> {
  const jobIds = batch.map((item) => item.jobId);
  const jobs: JobState[] = [];
  for (const jobId of jobIds) {
    const job = persistence.getJob(jobId);
    if (!job) {
      log.warn({ jobId }, 'Skipping missing job in persistence during batch processing');
      continue;
    }
    jobs.push(job);
  }

  if (jobs.length === 0) {
    log.warn({ batchId }, 'No persisted jobs found for batch');
    return;
  }

  const nowIso = new Date().toISOString();
  for (const job of jobs) {
    const attempts = (job.attempts ?? 0) + 1;
    persistence.updateJob(job.id, {
      status: 'processing',
      attempts,
      batchId,
      lastError: undefined,
    });
  }

  const nearInterface = getNear();
  let signer: any;
  let client: any;
  let lease: {
    signer: any;
    publicKey: string;
    index: number;
    poolSize: number;
    release: () => void;
  } | null = null;
  let keyIdentifier = config.masterAccount;

  try {
    if (typeof nearInterface.acquireSigner === 'function') {
      const acquired = await nearInterface.acquireSigner();
      lease = acquired;
      signer = acquired.signer;
      client = nearInterface.client;
      keyIdentifier = acquired.publicKey;
    } else {
      signer = nearInterface.signer;
      client = nearInterface.client;
    }

    const decodeJson = ({ rawResult }: { rawResult: number[] }) => {
      try {
        const text = new TextDecoder().decode(Uint8Array.from(rawResult));
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const uniqueReceivers = Array.from(new Set(jobs.map((job) => job.receiverId)));
    const storageChecks: Record<string, boolean> = {};
    let storageDepositAmount = STORAGE_MIN_DEPOSIT;

    if (!SKIP_STORAGE_CHECK) {
      try {
        const bounds = await withRetry(() =>
          client.callContractReadFunction({
            contractAccountId: config.ftContract,
            fnName: 'storage_balance_bounds',
            response: { resultTransformer: decodeJson },
          }),
        );
        const b: any = bounds ?? {};
        if (typeof b.min === 'string') storageDepositAmount = b.min;
        else if (typeof b.min === 'number') storageDepositAmount = String(b.min);
        else if (typeof b.min === 'bigint') storageDepositAmount = b.min.toString();
      } catch (error) {
        log.warn({ err: error }, 'Failed to fetch storage balance bounds; using default minimum');
      }

      for (const receiverId of uniqueReceivers) {
        try {
          const storage = await withRetry(() =>
            client.callContractReadFunction({
              contractAccountId: config.ftContract,
              fnName: 'storage_balance_of',
              fnArgsJson: { account_id: receiverId },
              response: { resultTransformer: decodeJson },
            }),
          );

          const storageJson: any = storage ?? {};
          const amountStr = String(storageJson.total ?? storageJson.available ?? '0');
          const isRegistered = (() => {
            try {
              return BigInt(amountStr) > 0n;
            } catch {
              return false;
            }
          })();
          storageChecks[receiverId] = isRegistered;
        } catch (error) {
          log.warn({ err: error, receiverId }, 'Storage balance check failed; assuming not registered');
          storageChecks[receiverId] = false;
        }
      }
    }

    const storageDepositActions = SKIP_STORAGE_CHECK
      ? uniqueReceivers.map((receiverId) =>
          functionCall({
            fnName: 'storage_deposit',
            fnArgsJson: {
              account_id: receiverId,
              registration_only: true,
            },
            gasLimit: teraGas('30'),
            attachedDeposit: { yoctoNear: storageDepositAmount },
          }),
        )
      : uniqueReceivers
          .filter((receiverId) => !storageChecks[receiverId])
          .map((receiverId) =>
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

    const transferActions = jobs.map((job) =>
      functionCall({
        fnName: 'ft_transfer',
        fnArgsJson: {
          receiver_id: job.receiverId,
          amount: job.amount,
          memo: job.memo || '',
        },
        gasLimit: teraGas('30'),
        attachedDeposit: { yoctoNear: '1' },
      }),
    );

    const actions = [...storageDepositActions, ...transferActions];
    if (actions.length === 0) {
      throw new Error('No actions generated for batch');
    }

    const result = await sendWithNonceRetry(async () => {
      await throttleGlobal();
      await throttleKey(keyIdentifier);

      const tx = await signer.signTransaction({
        receiverAccountId: config.ftContract,
        actions,
      });

      return client.sendSignedTransaction({
        signedTransaction: tx,
        waitUntil: WAIT_UNTIL,
      });
    });

    const transactionHash =
      result?.transaction?.hash || result?.transactionOutcome?.id || 'unknown';

    const failure = findFailureInOutcome(result);
    if (failure) {
      throw new Error(`On-chain failure: ${JSON.stringify(failure)}`);
    }

    for (const job of jobs) {
      persistence.updateJob(job.id, {
        status: 'submitted',
        txHash: transactionHash,
        batchId,
      });

      resolveJob(job.id, {
        jobId: job.id,
        receiverId: job.receiverId,
        amount: job.amount,
        memo: job.memo,
        transactionHash,
        status: result?.finalExecutionStatus || 'submitted',
        batchId,
        submittedAt: nowIso,
      });
    }
  } catch (error) {
    const message = extractErrorMessage(error);
    log.error({ err: error, batchId, message }, 'Failed to process batch');
    for (const job of jobs) {
      handleJobFailure(job, batchId, error, message);
    }
  } finally {
    for (const jobId of jobIds) {
      inFlightJobs.delete(jobId);
    }
    if (lease) {
      try {
        lease.release();
      } catch (releaseError: any) {
        log.warn({ err: releaseError }, 'Failed to release signer lease');
      }
    }
  }
}

function handleJobFailure(job: JobState, batchId: string, error: unknown, message: string): void {
  const attempts = (job.attempts ?? 0) + 1;
  persistence.updateJob(job.id, {
    status: attempts < MAX_JOB_ATTEMPTS ? 'queued' : 'failed',
    attempts,
    batchId,
    lastError: message,
  });

  if (attempts < MAX_JOB_ATTEMPTS) {
    const delay = Math.min(JOB_RETRY_BASE_MS * attempts, 5000);
    log.warn({ jobId: job.id, attempts, delay }, 'Retrying job after failure');
    setTimeout(() => queueJob(job), delay);
    return;
  }

  rejectJob(job.id, createTransferError(message, error));
}

function resolveJob(jobId: string, payload: TransferExecutionResult): void {
  const pending = pendingResolutions.get(jobId);
  pendingResolutions.delete(jobId);
  if (pending?.resolve) {
    pending.resolve(payload);
  }
}

function rejectJob(jobId: string, error: Error): void {
  const pending = pendingResolutions.get(jobId);
  pendingResolutions.delete(jobId);
  if (pending?.reject) {
    pending.reject(error);
  }
}

function createTransferError(message: string, originalError: unknown): Error {
  const error = new Error(message);
  (error as any).cause = originalError ?? new Error(message);
  return error;
}

async function sendWithNonceRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let backoffMs = 150;
  while (attempt <= NONCE_RETRY_LIMIT) {
    try {
      return await fn();
    } catch (error: any) {
      if (isInvalidNonceError(error) && attempt < NONCE_RETRY_LIMIT) {
        const details = getInvalidNonceDetails(error);
        attempt += 1;
        log.warn({ attempt, details }, 'Retrying transaction due to nonce conflict');
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 1000);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Exceeded nonce retry limit');
}

function extractErrorMessage(error: any): string {
  if (error?.name === '$ZodError') {
    return 'RPC response parsing error - transaction result format invalid';
  }

  if (typeof error === 'string' && error.startsWith('[') && error.includes('$ZodError')) {
    return 'RPC response parsing error - transaction result format invalid';
  }

  if (error?.cause) {
    const cause = error.cause;

    if (cause.code === -429) {
      return 'RPC rate limit exceeded - please retry later';
    }

    if (cause.code === 'ECONNRESET' || cause.code === 'ETIMEDOUT') {
      return 'Network connection error - please check RPC connectivity';
    }

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

    if (cause.code === -32000) {
      return `Server error: ${cause.message || 'Unknown server error'}`;
    }
  }

  if (error?.message && error.message !== '[object Object]') {
    return error.message;
  }

  return 'Unknown error occurred during transaction processing';
}

function getInvalidNonceDetails(error: any) {
  const fromCause = error?.cause?.data?.TxExecutionError?.InvalidTxError?.InvalidNonce;
  if (fromCause) return fromCause;
  return error?.cause?.cause?.data?.TxExecutionError?.InvalidTxError?.InvalidNonce ?? null;
}

function isInvalidNonceError(error: any) {
  return Boolean(getInvalidNonceDetails(error));
}

function findFailureInOutcome(outcome: any): any | null {
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
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let delay = 200;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const code = error?.cause?.code ?? error?.code ?? error?.cause?.errno;
      const message = error?.message ? String(error.message).toLowerCase() : '';
      const retriableCodes = new Set<any>([
        -429,
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'EAI_AGAIN',
        'EPIPE',
      ]);
      const retriable =
        retriableCodes.has(code) ||
        message.includes('fetch failed') ||
        message.includes('socket hang up');

      if (!retriable || i === attempts - 1) {
        throw error;
      }

      log.warn({ attempt: i + 1, code, message }, 'Retrying RPC view call after transient error');
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('Exceeded retry attempts');
}
