#!/usr/bin/env node

/**
 * Configuration Validator for 100+ TPS
 * 
 * Validates .env configuration to ensure it's optimized for achieving 100+ TPS throughput.
 * 
 * Usage:
 *   node scripts/validate-config.mjs
 *   node scripts/validate-config.mjs --env sandbox
 *   node scripts/validate-config.mjs --env testnet
 */

import { readFileSync } from 'fs';
import { parseArgs } from 'node:util';
import { resolve } from 'path';

const { values } = parseArgs({
  options: {
    env: { type: 'string', default: 'sandbox' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(`
Configuration Validator for 100+ TPS

Usage: node scripts/validate-config.mjs [options]

Options:
  --env <sandbox|testnet>   Environment to validate (default: sandbox)
  --help                    Show this help message

Example:
  node scripts/validate-config.mjs --env sandbox
  node scripts/validate-config.mjs --env testnet

What it checks:
  ✓ Key pool size (need 5+ keys for 100 TPS)
  ✓ Concurrency limits
  ✓ Throttle settings
  ✓ Storage check configuration
  ✓ Batch processing settings
  ✓ Worker count
  ✓ RPC configuration (testnet)
  ✓ Transaction finality

Output:
  - Configuration score (0-100)
  - Grade (A-F)
  - Estimated max TPS
  - Actionable recommendations
`);
  process.exit(0);
}

const env = values.env;
const envFile = env === 'sandbox' ? '.env' : '.env.testnet';
const envPath = resolve(envFile);

console.log(`
╔════════════════════════════════════════════════════════════════════════╗
║  Configuration Validator for 100+ TPS                                 ║
╚════════════════════════════════════════════════════════════════════════╝

Environment: ${env}
Config File: ${envFile}

`);

// Read and parse .env file
let config = {};
try {
  const content = readFileSync(envPath, 'utf-8');
  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
} catch (error) {
  console.error(`❌ Error reading ${envFile}: ${error.message}`);
  console.log(`\nCreate ${envFile} first:`);
  console.log(`  cp .env.example ${envFile}`);
  process.exit(1);
}

// Validation checks
const checks = [];
let criticalIssues = 0;
let warnings = 0;
let score = 0;
const maxScore = 100;

// Helper functions
const getInt = (key, defaultVal = 0) => {
  const val = config[key];
  return val ? parseInt(val, 10) : defaultVal;
};

const getString = (key, defaultVal = '') => {
  return config[key] || defaultVal;
};

const countKeys = (keysString) => {
  if (!keysString) return 0;
  return keysString.split(',').filter(k => k.trim().length > 0).length;
};

// Check 1: Key Pool Size (Critical - 20 points)
const keyCount = countKeys(getString('MASTER_ACCOUNT_PRIVATE_KEYS'));
const minKeysFor100TPS = 5;
const optimalKeys = 6;

if (keyCount >= optimalKeys) {
  checks.push({ type: '✅', category: 'CRITICAL', name: 'Key Pool Size', message: `${keyCount} keys configured (optimal for 100+ TPS)`, score: 20 });
  score += 20;
} else if (keyCount >= minKeysFor100TPS) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Key Pool Size', message: `${keyCount} keys configured (minimum for 100 TPS, add ${optimalKeys - keyCount} more for headroom)`, score: 15 });
  score += 15;
  warnings++;
} else if (keyCount > 0) {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Key Pool Size', message: `Only ${keyCount} keys configured (need ${minKeysFor100TPS}+ for 100 TPS). Max TPS: ~${keyCount * 20}`, score: 5 });
  score += 5;
  criticalIssues++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Key Pool Size', message: 'No keys configured in MASTER_ACCOUNT_PRIVATE_KEYS', score: 0 });
  criticalIssues++;
}

// Check 2: Concurrency Limits (15 points)
const concurrency = getInt('CONCURRENCY_LIMIT', 0);
const minConcurrency = env === 'sandbox' ? 600 : 800;

if (concurrency >= minConcurrency) {
  checks.push({ type: '✅', category: 'PERFORMANCE', name: 'Concurrency Limit', message: `${concurrency} (optimal for ${env})`, score: 15 });
  score += 15;
} else if (concurrency >= minConcurrency * 0.7) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Concurrency Limit', message: `${concurrency} (increase to ${minConcurrency} for 100 TPS)`, score: 10 });
  score += 10;
  warnings++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Concurrency Limit', message: `${concurrency} (too low, set to ${minConcurrency})`, score: 5 });
  score += 5;
  criticalIssues++;
}

// Check 3: Max In-Flight (10 points)
const maxInFlight = getInt('MAX_IN_FLIGHT', 0);
const minInFlight = env === 'sandbox' ? 250 : 300;

if (maxInFlight >= minInFlight) {
  checks.push({ type: '✅', category: 'PERFORMANCE', name: 'Max In-Flight', message: `${maxInFlight} (optimal)`, score: 10 });
  score += 10;
} else if (maxInFlight >= minInFlight * 0.7) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Max In-Flight', message: `${maxInFlight} (increase to ${minInFlight})`, score: 7 });
  score += 7;
  warnings++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Max In-Flight', message: `${maxInFlight} (too low, set to ${minInFlight})`, score: 3 });
  score += 3;
  criticalIssues++;
}

// Check 4: Global Throttle (10 points)
const globalThrottle = getInt('MAX_TX_PER_SECOND', 0);
const minGlobalThrottle = 180;

if (globalThrottle >= minGlobalThrottle) {
  checks.push({ type: '✅', category: 'THROTTLE', name: 'Global Throttle', message: `${globalThrottle} TPS limit (sufficient)`, score: 10 });
  score += 10;
} else if (globalThrottle >= 100) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Global Throttle', message: `${globalThrottle} TPS limit (increase to ${minGlobalThrottle} for headroom)`, score: 7 });
  score += 7;
  warnings++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Global Throttle', message: `${globalThrottle} TPS limit (too low, set to ${minGlobalThrottle})`, score: 3 });
  score += 3;
  criticalIssues++;
}

// Check 5: Per-Key Throttle (10 points)
const perKeyThrottle = getInt('MAX_TX_PER_KEY_PER_SECOND', 0);
const minPerKeyThrottle = 20;

if (perKeyThrottle >= minPerKeyThrottle) {
  checks.push({ type: '✅', category: 'THROTTLE', name: 'Per-Key Throttle', message: `${perKeyThrottle} TPS per key (optimal)`, score: 10 });
  score += 10;
} else if (perKeyThrottle >= 15) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Per-Key Throttle', message: `${perKeyThrottle} TPS per key (increase to ${minPerKeyThrottle})`, score: 7 });
  score += 7;
  warnings++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Per-Key Throttle', message: `${perKeyThrottle} TPS per key (too low, set to ${minPerKeyThrottle})`, score: 3 });
  score += 3;
  criticalIssues++;
}

// Check 6: Storage Check Optimization (10 points)
const skipStorage = getString('SKIP_STORAGE_CHECK', 'false').toLowerCase();

if (skipStorage === 'true') {
  checks.push({ type: '✅', category: 'OPTIMIZATION', name: 'Storage Check', message: 'Disabled (2x performance boost)', score: 10 });
  score += 10;
} else {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Storage Check', message: 'Enabled (consider SKIP_STORAGE_CHECK=true if receivers pre-registered)', score: 5 });
  score += 5;
  warnings++;
}

// Check 7: Batch Size (10 points)
const batchSize = getInt('BATCH_SIZE', 0);
const minBatch = 100;

if (batchSize >= minBatch) {
  checks.push({ type: '✅', category: 'PERFORMANCE', name: 'Batch Size', message: `${batchSize} (optimal)`, score: 10 });
  score += 10;
} else if (batchSize >= 50) {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Batch Size', message: `${batchSize} (increase to ${minBatch} for better throughput)`, score: 7 });
  score += 7;
  warnings++;
} else {
  checks.push({ type: '❌', category: 'CRITICAL', name: 'Batch Size', message: `${batchSize} (too small, set to ${minBatch})`, score: 3 });
  score += 3;
  criticalIssues++;
}

// Check 8: Worker Count (5 points)
const workerCount = getInt('WORKER_COUNT', 0);
const minWorkers = env === 'sandbox' ? 12 : 10;

if (workerCount >= minWorkers) {
  checks.push({ type: '✅', category: 'PERFORMANCE', name: 'Worker Count', message: `${workerCount} workers (good)`, score: 5 });
  score += 5;
} else {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Worker Count', message: `${workerCount} workers (increase to ${minWorkers})`, score: 3 });
  score += 3;
  warnings++;
}

// Check 9: RPC Configuration (Testnet only - 5 points)
if (env === 'testnet') {
  const rpcUrls = getString('RPC_URLS', '');
  const rpcCount = rpcUrls ? rpcUrls.split(',').length : 0;
  
  if (rpcCount >= 3) {
    checks.push({ type: '✅', category: 'RPC', name: 'RPC Endpoints', message: `${rpcCount} RPC URLs configured (load balancing enabled)`, score: 5 });
    score += 5;
  } else if (rpcCount >= 2) {
    checks.push({ type: '⚠️', category: 'WARNING', name: 'RPC Endpoints', message: `${rpcCount} RPC URLs (add more for better reliability)`, score: 3 });
    score += 3;
    warnings++;
  } else {
    checks.push({ type: '❌', category: 'CRITICAL', name: 'RPC Endpoints', message: 'Single RPC URL (add multiple for load balancing)', score: 0 });
    criticalIssues++;
  }
} else {
  score += 5; // Skip this check for sandbox
}

// Check 10: Transaction Finality (5 points)
const waitUntil = getString('WAIT_UNTIL', '');

if (waitUntil === 'Included') {
  checks.push({ type: '✅', category: 'CONFIG', name: 'Transaction Finality', message: 'Included (fast for load testing)', score: 5 });
  score += 5;
} else if (waitUntil === 'Final') {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Transaction Finality', message: 'Final (slower but safer, use Included for load tests)', score: 3 });
  score += 3;
  warnings++;
} else {
  checks.push({ type: '⚠️', category: 'WARNING', name: 'Transaction Finality', message: `${waitUntil || 'not set'} (set to Included for load testing)`, score: 2 });
  score += 2;
  warnings++;
}

// Print results
console.log('╔════════════════════════════════════════════════════════════════════════╗');
console.log('║  Validation Results                                                    ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

checks.forEach(check => {
  console.log(`${check.type} [${check.category}] ${check.name}`);
  console.log(`   ${check.message}`);
  console.log(`   Score: ${check.score}/${check.score <= 5 ? 5 : check.score <= 10 ? 10 : check.score <= 15 ? 15 : 20}\n`);
});

// Summary
console.log('╔════════════════════════════════════════════════════════════════════════╗');
console.log('║  Summary                                                               ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

const percentage = Math.round((score / maxScore) * 100);
let grade, status;

if (percentage >= 90) {
  grade = 'A';
  status = '✅ EXCELLENT - Ready for 100+ TPS';
} else if (percentage >= 80) {
  grade = 'B';
  status = '✅ GOOD - Should achieve 100 TPS with minor tweaks';
} else if (percentage >= 70) {
  grade = 'C';
  status = '⚠️  FAIR - May struggle with 100 TPS, needs optimization';
} else if (percentage >= 60) {
  grade = 'D';
  status = '⚠️  POOR - Unlikely to achieve 100 TPS, significant changes needed';
} else {
  grade = 'F';
  status = '❌ FAIL - Critical issues, cannot achieve 100 TPS';
}

console.log(`Overall Score:     ${score}/${maxScore} (${percentage}%)`);
console.log(`Grade:             ${grade}`);
console.log(`Status:            ${status}`);
console.log(`Critical Issues:   ${criticalIssues}`);
console.log(`Warnings:          ${warnings}\n`);

// Estimated TPS
const estimatedTPS = Math.min(
  keyCount * perKeyThrottle,  // Key pool limit
  globalThrottle,              // Global throttle limit
  concurrency * 2              // Concurrency limit (rough estimate)
);

console.log(`Estimated Max TPS: ~${estimatedTPS} TPS`);
console.log(`   Based on:`);
console.log(`   - Key Pool:    ${keyCount} keys × ${perKeyThrottle} TPS = ${keyCount * perKeyThrottle} TPS`);
console.log(`   - Global:      ${globalThrottle} TPS limit`);
console.log(`   - Concurrency: ${concurrency} concurrent\n`);

if (estimatedTPS >= 100) {
  console.log('✅ Configuration should support 100+ TPS\n');
} else {
  console.log(`⚠️  Configuration may only support ~${estimatedTPS} TPS\n`);
}

// Recommendations
if (criticalIssues > 0 || warnings > 0 || estimatedTPS < 100) {
  console.log('╔════════════════════════════════════════════════════════════════════════╗');
  console.log('║  Recommendations                                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

  if (keyCount < minKeysFor100TPS) {
    console.log(`1. 🔑 Generate more keys (need ${minKeysFor100TPS - keyCount} more):`);
    console.log(`   Current: ${keyCount} keys → Target: ${minKeysFor100TPS}+ keys`);
    console.log(`   Each key can handle ~20 TPS\n`);
  }

  if (concurrency < minConcurrency) {
    console.log(`2. ⚡ Increase concurrency limit in ${envFile}:`);
    console.log(`   CONCURRENCY_LIMIT=${minConcurrency}\n`);
  }

  if (maxInFlight < minInFlight) {
    console.log(`3. 🚀 Increase max in-flight transactions:`);
    console.log(`   MAX_IN_FLIGHT=${minInFlight}\n`);
  }

  if (!globalThrottle || globalThrottle < minGlobalThrottle) {
    console.log(`4. 📊 Add/update global throttle:`);
    console.log(`   MAX_TX_PER_SECOND=${minGlobalThrottle}`);
    console.log(`   GLOBAL_THROTTLE_WINDOW_SEC=1\n`);
  }

  if (!perKeyThrottle || perKeyThrottle < minPerKeyThrottle) {
    console.log(`5. 🔐 Add/update per-key throttle:`);
    console.log(`   MAX_TX_PER_KEY_PER_SECOND=${minPerKeyThrottle}`);
    console.log(`   PER_KEY_THROTTLE_WINDOW_SEC=1\n`);
  }

  if (skipStorage !== 'true') {
    console.log(`6. 🚀 Optional: Enable storage check optimization (if receivers pre-registered):`);
    console.log(`   SKIP_STORAGE_CHECK=true\n`);
  }

  if (env === 'testnet' && config['RPC_URLS'] && config['RPC_URLS'].split(',').length < 2) {
    console.log(`7. 🌐 Add multiple RPC endpoints for load balancing:`);
    console.log(`   RPC_URLS=https://rpc.testnet.fastnear.com,https://rpc.testnet.near.org\n`);
  }
}

// Next steps
console.log('╔════════════════════════════════════════════════════════════════════════╗');
console.log('║  Next Steps                                                            ║');
console.log('╚════════════════════════════════════════════════════════════════════════╝\n');

if (criticalIssues === 0 && estimatedTPS >= 100) {
  console.log('✅ Configuration looks good! Ready to test:\n');
  console.log(`   artillery run testing/artillery/benchmark-${env}.yml\n`);
} else {
  console.log('1. Apply recommended fixes above');
  console.log('2. Re-run validation: node scripts/validate-config.mjs --env ' + env);
  console.log('3. Test performance with Artillery');
  console.log('4. Monitor TPS in server logs\n');
}

// Exit code
process.exit(criticalIssues > 0 ? 1 : 0);