import { EventEmitter } from 'events';
import persistence from './persistence-jsonl.js';

class SimpleQueue extends EventEmitter {
  private queue: any[] = [];
  private processing = false;
  private concurrency = 8;

  async add(job: any) {
    // Persist job and return jobId immediately
    const expiresAt = job.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const created = persistence.createJob({ receiverId: job.receiverId, amount: String(job.amount), memo: job.memo, expiresAt });
    const jobWithId = { ...job, jobId: created.id };
    this.queue.push(jobWithId);
    this.process();
    return { id: created.id };
  }

  /**
   * Enqueue an existing persisted job (do not create a new persistence record)
   */
  async enqueueExisting(job: any) {
    const jobWithId = { ...job };
    this.queue.push(jobWithId);
    this.process();
    return { id: jobWithId.jobId || jobWithId.id };
  }

  private async process() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        try {
          await this.emit('job', job);
        } catch (error) {
          this.emit('failed', job, error);
        }
      }
    }

    this.processing = false;
  }

  on(event: string, listener: (...args: any[]) => void) {
    super.on(event, listener);
    return this;
  }
}

const transferQueue = new SimpleQueue();

export default transferQueue;