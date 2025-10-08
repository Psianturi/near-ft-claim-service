import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.jsonl');

export type JobState = {
  id: string;
  createdAt: string;
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

const COMPACT_THRESHOLD = parseInt(process.env.COMPACT_THRESHOLD || '1000', 10);
const COMPACT_INTERVAL_MS = parseInt(process.env.COMPACT_INTERVAL_MS || String(30 * 60 * 1000), 10); // 30 minutes

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(JOBS_FILE)) {
    fs.writeFileSync(JOBS_FILE, '');
  }
}

function appendEvent(obj: any) {
  const line = JSON.stringify(obj) + '\n';
  fs.appendFileSync(JOBS_FILE, line, 'utf8');
  eventCounter++;
  // Trigger compaction when threshold reached
  if (eventCounter >= COMPACT_THRESHOLD) {
    try {
      compact();
    } catch (e) {
      // ignore compaction errors
    }
  }
}

function compact() {
  // Snapshot latest job states and replace jobs.jsonl atomically
  ensureDataDir();
  const tmp = JOBS_FILE + '.tmp';
  const out = fs.createWriteStream(tmp, { encoding: 'utf8' });
  for (const job of jobs.values()) {
    out.write(JSON.stringify({ type: 'job', action: 'create', job }) + '\n');
  }
  out.end();
  out.on('finish', () => {
    try {
      const backup = JOBS_FILE + '.old';
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      if (fs.existsSync(JOBS_FILE)) fs.renameSync(JOBS_FILE, backup);
      fs.renameSync(tmp, JOBS_FILE);
      eventCounter = 0;
    } catch (e) {
      // best-effort
    }
  });
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
