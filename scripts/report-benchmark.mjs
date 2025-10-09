import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const artilleryDir = path.join(repoRoot, 'testing', 'artillery');
const logPath = path.join(artilleryDir, '.last-artillery-run.log');

const formatNumber = (value) => {
  if (value == null || Number.isNaN(Number(value))) {
    return '0';
  }
  return Number(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
};

const findResultFile = () => {
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const match = lines[i].match(/RESULT_JSON=(.+)$/);
      if (match) {
        const relativePath = match[1].trim();
        const resolved = path.resolve(artilleryDir, relativePath);
        if (fs.existsSync(resolved)) {
          return resolved;
        }
      }
    }
  }

  if (!fs.existsSync(artilleryDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(artilleryDir)
    .filter((file) => file.startsWith('artillery-results-sandbox-') && file.endsWith('.json'))
    .map((file) => {
      const fullPath = path.join(artilleryDir, file);
      const stats = fs.statSync(fullPath);
      return { fullPath, mtime: stats.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  return candidates[0]?.fullPath ?? null;
};

const resultFile = findResultFile();

if (!resultFile) {
  console.warn('⚠️  No Artillery result file found.');
  console.log('## 🔬 Sandbox benchmark summary\n\nNo Artillery result file found.');
  process.exit(0);
}

let raw;
try {
  raw = fs.readFileSync(resultFile, 'utf8');
} catch (error) {
  console.error('Failed to read Artillery result file:', error);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (error) {
  console.error('Failed to parse Artillery result file as JSON:', error);
  process.exit(1);
}

const aggregate = payload?.aggregate ?? {};
const counters = aggregate.counters ?? {};
const rates = aggregate.rates ?? {};
const summaries = aggregate.summaries ?? {};

const totalRequests = Number(counters['http.requests'] ?? 0);
const success200 = Number(counters['http.codes.200'] ?? 0);
const error5xx = Object.entries(counters)
  .filter(([key]) => key.startsWith('http.codes.5'))
  .reduce((sum, [, value]) => sum + Number(value), 0);
const error4xx = Object.entries(counters)
  .filter(([key]) => key.startsWith('http.codes.4'))
  .reduce((sum, [, value]) => sum + Number(value), 0);
const timeouts = Number(counters['errors.ETIMEDOUT'] ?? 0);
const econnreset = Number(counters['errors.ECONNRESET'] ?? 0);
const requestRate = Number(rates['http.request_rate'] ?? 0);
const latencySummary = summaries['http.response_time'] ?? {};

const failureCount = totalRequests - success200;
const successRate = totalRequests > 0 ? (success200 / totalRequests) * 100 : 0;

const durationMs = Math.max(0, (aggregate.lastCounterAt ?? 0) - (aggregate.firstCounterAt ?? 0));
const durationSeconds = durationMs / 1000;

const summaryLines = [
  '## 🔬 Sandbox benchmark summary',
  '',
  `**Result file:** \`${path.relative(repoRoot, resultFile)}\``,
  '',
  '| Metric | Value |',
  '| --- | --- |',
  `| Total requests | ${formatNumber(totalRequests)} |`,
  `| Successful (200) | ${formatNumber(success200)} |`,
  `| Failures (total) | ${formatNumber(failureCount)} |`,
  `| 4xx responses | ${formatNumber(error4xx)} |`,
  `| 5xx responses | ${formatNumber(error5xx)} |`,
  `| ETIMEDOUT errors | ${formatNumber(timeouts)} |`,
  `| ECONNRESET errors | ${formatNumber(econnreset)} |`,
  `| Mean RPS | ${formatNumber(requestRate)} |`,
  `| Median latency (ms) | ${formatNumber(latencySummary.median ?? latencySummary.p50)} |`,
  `| p95 latency (ms) | ${formatNumber(latencySummary.p95)} |`,
  `| Max latency (ms) | ${formatNumber(latencySummary.max)} |`,
  `| Duration (s) | ${formatNumber(durationSeconds)} |`,
  `| Success rate | ${successRate.toFixed(2)}% |`,
];

const health = successRate >= 95 && error5xx === 0 && timeouts === 0;
const successMessage = '✅ Benchmark meets success threshold (≥95% success and no 5xx/timeouts)';
const failureMessage = '⚠️ Benchmark did not meet success threshold';

summaryLines.push('');
summaryLines.push(health ? successMessage : failureMessage);

const guardWarnings = [];
if (successRate < 10) {
  guardWarnings.push(`• Success rate ${successRate.toFixed(2)}% is below the 10% threshold`);
}

const p95Latency = Number(latencySummary.p95 ?? 0);
if (p95Latency > 20000) {
  guardWarnings.push(`• p95 latency ${formatNumber(p95Latency)} ms exceeds the 20,000 ms limit`);
}

if (guardWarnings.length > 0) {
  summaryLines.push('');
  summaryLines.push('### ⚠️ Guard checks');
  summaryLines.push('');
  summaryLines.push(...guardWarnings.map((item) => `- ${item}`));
}

const summary = summaryLines.join('\n');

console.log(summary);
