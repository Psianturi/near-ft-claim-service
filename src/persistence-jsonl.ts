import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.jsonl');

export type JobState = {
  id: string;
  createdAt: string;
  submittedAt?: string;
  updatedAt?: string;
  status: string;
  receiverId: string;
  amount: string;
  memo?: string;
  attempts?: number;
  txHash?: string;
  batchId?: string;
  lastError?: string;
  expiresAt?: string;
};

const jobs = new Map<string, JobState>();
let eventCounter = 0;

const COMPACT_THRESHOLD = parseInt(process.env.COMPACT_THRESHOLD || '5000', 10); // Increased threshold
const COMPACT_INTERVAL_MS = parseInt(process.env.COMPACT_INTERVAL_MS || String(60 * 60 * 1000), 10); // 1 hour - reduced frequency

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, '');
  }
}

function appendEvent(obj: any) {
  try {
    ensureDataDir();
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(JOBS_FILE, line, 'utf8');
    eventCounter++;

    // Trigger compaction when threshold reached (but not during high load)
    if (eventCounter >= COMPACT_THRESHOLD) {
      // Use setImmediate to avoid blocking the event loop during high load
      setImmediate(() => {
        try {
          compact();
        } catch (e) {
          // ignore compaction errors during high load
        }
      });
    }
  } catch (error) {
    // Log but don't crash - persistence should be best-effort during high load
    console.warn('Failed to append persistence event:', error);
  }
}

function compact() {
  // Snapshot latest job states and replace jobs.jsonl atomically
  try {
    ensureDataDir();
    const tmp = JOBS_FILE + '.tmp';

    // Use synchronous operations to avoid stream issues during high load
    let content = '';
    for (const job of jobs.values()) {
      content += JSON.stringify({ type: 'job', action: 'create', job }) + '\n';
    }

    // Write to temp file synchronously
    fs.writeFileSync(tmp, content, 'utf8');

    // Atomic rename operations
    const backup = JOBS_FILE + '.old';
    if (fs.existsSync(backup)) {
      try {
        fs.unlinkSync(backup);
      } catch (e) {
        // ignore backup cleanup errors
      }
    }

    if (fs.existsSync(JOBS_FILE)) {
      fs.renameSync(JOBS_FILE, backup);
    }

    fs.renameSync(tmp, JOBS_FILE);
    eventCounter = 0;

  } catch (error) {
    // Log but don't crash - compaction is best-effort
    console.warn('Persistence compaction failed:', error);
  }
}

export function rehydrate() {
  try {
    ensureDataDir();
    const content = fs.readFileSync(JOBS_FILE, 'utf8');
    if (!content) return;
    const lines = content.split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const ev = JSON.parse(l);
        if (ev && ev.type === 'job') {
          if (ev.action === 'create' && ev.job && ev.job.id) {
            jobs.set(ev.job.id, ev.job as JobState);
          } else if (ev.action === 'update' && ev.jobId) {
            const cur = jobs.get(ev.jobId) || ({} as JobState);
            const updated = { ...cur, ...(ev.patch || {}) } as JobState;
            jobs.set(ev.jobId, updated);
          }
        }
      } catch (e) {
        // ignore malformed lines
      }
    }
  } catch (e) {
    // ignore
  }
}

export function createJob(initial: {
  receiverId: string;
  amount: string;
  memo?: string;
  expiresAt?: string;
}) {
  ensureDataDir();
  const id = (globalThis as any).crypto?.randomUUID?.() || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
  const job: JobState = {
    id,
    createdAt: new Date().toISOString(),
    status: 'queued',
    receiverId: initial.receiverId,
    amount: initial.amount,
    memo: initial.memo,
    attempts: 0,
    expiresAt: initial.expiresAt,
  };
  appendEvent({ type: 'job', action: 'create', job });
  jobs.set(id, job);
  return job;
}

export function updateJob(jobId: string, patch: Partial<JobState>) {
  ensureDataDir();
  appendEvent({ type: 'job', action: 'update', jobId, patch });
  const cur = jobs.get(jobId) || ({} as JobState);
  const updated = { ...cur, ...(patch as any) } as JobState;
  jobs.set(jobId, updated);
  return updated;
}

export function getJob(jobId: string) {
  return jobs.get(jobId) || null;
}

export function listAllJobs() {
  return Array.from(jobs.values());
}

// initialize on load
try {
  rehydrate();
} catch {
  // noop
}

// Periodic compaction
try {
  setInterval(() => {
    try {
      compact();
    } catch (e) {
      // ignore
    }
  }, COMPACT_INTERVAL_MS);
} catch {
  // noop
}

export default {
  rehydrate,
  createJob,
  updateJob,
  getJob,
  listAllJobs,
};
