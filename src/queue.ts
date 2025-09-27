import { EventEmitter } from 'events';

class SimpleQueue extends EventEmitter {
  private queue: any[] = [];
  private processing = false;
  private concurrency = 8;

  async add(job: any) {
    this.queue.push(job);
    this.process();
    return { id: Date.now() };
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