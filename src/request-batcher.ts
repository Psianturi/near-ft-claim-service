/**
 * Request Batching Layer
 *
 * Batches multiple incoming /send-ft requests into single blockchain transactions
 * to maximize throughput and reduce overhead.
 *
 * Strategy:
 * - Batch requests within 600ms window (1 block production time)
 * - Or until batch reaches MAX_BATCH_SIZE (default 10)
 * - Each batch = 1 blockchain transaction with multiple ft_transfer actions
 * - 300 TGas limit / 30 TGas per transfer = max ~10 transfers per transaction
 *
 * Benefits:
 * - Reduces RPC overhead by 3-5x
 * - Better nonce management (fewer transactions)
 * - Higher sustainable throughput
 */

import { createLogger } from './logger.js';
import { EventEmitter } from 'events';

const log = createLogger({ module: 'request-batcher' });

export interface BatchableTransfer {
  jobId: string;
  receiverId: string;
  amount: string;
  memo?: string;
  resolve?: (result: any) => void;
  reject?: (error: any) => void;
  timestamp?: number;
}

export class RequestBatcher extends EventEmitter {
  private batch: BatchableTransfer[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private readonly batchWindowMs: number;
  private readonly maxBatchSize: number;
  private stats = {
    totalRequests: 0,
    batchesSent: 0,
    avgBatchSize: 0,
  };

  constructor() {
    super();
    this.batchWindowMs = parseInt(process.env.BATCH_WINDOW_MS || '600', 10); // 600ms = 1 block time
    this.maxBatchSize = parseInt(process.env.MAX_BATCH_SIZE || '10', 10); // Max transfers per transaction
    
    log.info({
      batchWindowMs: this.batchWindowMs,
      maxBatchSize: this.maxBatchSize,
    }, 'Request batcher initialized');
  }

  queue(transfer: BatchableTransfer): void {
    const request = {
      ...transfer,
      timestamp: transfer.timestamp ?? Date.now(),
    };

    this.batch.push(request);
    this.stats.totalRequests++;

    log.debug({
      batchSize: this.batch.length,
      maxBatchSize: this.maxBatchSize,
    }, 'Request added to batch');

    if (this.batch.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => this.flush(), this.batchWindowMs);
    }
  }

  /**
   * Flush current batch - send as single blockchain transaction
   */
  private flush(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }

    if (this.batch.length === 0) return;

    const currentBatch = this.batch.splice(0, this.maxBatchSize);
    this.stats.batchesSent++;
    this.stats.avgBatchSize = this.stats.totalRequests / this.stats.batchesSent;

    log.info({
      batchSize: currentBatch.length,
      batchesSent: this.stats.batchesSent,
      avgBatchSize: this.stats.avgBatchSize.toFixed(2),
    }, 'Flushing batch');

    // Emit event for processing
    this.emit('batch', currentBatch);

    // If there are more items, schedule next flush
    if (this.batch.length > 0) {
      this.batchTimeout = setTimeout(() => this.flush(), this.batchWindowMs);
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentBatchSize: this.batch.length,
      hasPendingBatch: this.batch.length > 0,
    };
  }

  /**
   * Force flush (useful for graceful shutdown)
   */
  forceFlush(): void {
    if (this.batch.length > 0) {
      log.warn({ batchSize: this.batch.length }, 'Force flushing pending batch');
      this.flush();
    }
  }
}

export const requestBatcher = new RequestBatcher();