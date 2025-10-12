# NEAR Fungible Token Claiming Service

[![CI](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml)
[![Benchmark](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml/badge.svg?branch=main)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml)

High-performance service for distributing NEP-141 tokens on NEAR blockchain. Handles concurrent transfers, batching, durable job tracking, and benchmarking for sandbox & testnet.

## Features
- 🚀 30+ TPS sustained (sandbox/testnet)
- Durable batching & job recovery
- Key pool management & nonce conflict prevention
- REST API `/send-ft` for single/batch transfer
- Artillery benchmark integration

---

## Lifecycle Setup (Developer)

### 1. Contract (ft)
- Clone [near-examples/FT](https://github.com/near-examples/FT)
- Build: `cargo build --target wasm32-unknown-unknown --release`
- Deploy: `near deploy ...` (sandbox/testnet)

### 2. near-ft-helper
- Clone [Psianturi/near-ft-helper](https://github.com/Psianturi/near-ft-helper)
- Bootstrap sandbox/testnet, generate key pool, deploy contract
- Command: `node deploy.js` (sandbox) / `node deploy-testnet.js` (testnet)

### 3. ft-claiming-service
- Clone [Psianturi/near-ft-claim-service](https://github.com/Psianturi/near-ft-claim-service)
- Install: `npm install`
- Configure `.env`/`.env.testnet`/`.env.testnet.backup`
- Start API & worker:
  - Sandbox: `npm run start:sandbox` + `npm run run:worker:sandbox`
  - Testnet: `npm run start:testnet` + `npm run run:worker:testnet`
- Benchmark:
  - Sandbox: `./testing/test-complete-pipeline.sh`
  - Testnet: `./testing/test-complete-pipeline-testnet.sh`

---

## Quick Test (Public User)

### Sandbox
1. Copy `.env.example` ke `.env`
2. Jalankan API & worker (sandbox)
3. Jalankan benchmark: `./testing/test-complete-pipeline.sh`
4. Cek hasil di `testing/pipeline-summary.json`

### Testnet
1. Copy `.env.example` to `.env.testnet` and fill with your testnet credentials
2. Start API & worker (testnet)
3. Run benchmark: `./testing/test-complete-pipeline-testnet.sh`
4. Check results in `testing/pipeline-summary.json`

---

## Benchmark & Analysis
- Hasil: `testing/pipeline-summary.json`
- Success: Success rate > 95%, latency < 10s, error minimal
- Tuning: Atur batch/concurrency/key pool di `.env.*` jika error tinggi

---

## Documentation & Links
- [Benchmark Quick Reference](docs/BENCHMARK_QUICK_REFERENCE.md)
- [Workflow Analysis](docs/WORKFLOW_SANDBOX_BENCHMARK_ANALYSIS.md)
- [Testing Strategy](docs/testing.md)

---

## License
Apache-2.0
   npm run typecheck && npm run security && npm run test:frontend
   ```
7. **Exercise blockchain flows.** Kick off the sandbox or testnet suites when you need end-to-end coverage:
   ```bash
   npm run test:sandbox
   npm run test:testnet
   ```
8. **Benchmark throughput.**
   ```bash
   npm run benchmark
   ./testing/artillery/run-artillery-test.sh sandbox
   ./testing/artillery/run-artillery-test.sh testnet
   ```
   Artillery results land in `ARTILLERY_*` JSON files under `testing/artillery/` and summarized reports in `test-results/`.
9. **Review docs for deeper dives.** `docs/testing.md` covers the rationale for each suite, while `docs/ci.md` explains the GitHub Actions workflows and secrets.

Follow the detailed sections below for configuration nuances, deployment hints, and troubleshooting tips.

---

## Requirements

- **Node.js 20+** (Node 22 or 24 recommended for newest dependencies)
   ```bash
   nvm install 22 && nvm use 22
   ```
- **npm 9+**
- **NEAR Account** with 5+ function-call access keys (for 100+ TPS)
- **Rust toolchain** (optional, only if rebuilding FT contract)
- **Artillery** (for benchmarking)
  ```bash
  npm install -g artillery@latest
  ```

**Install dependencies:**
```bash
npm install
npx playwright install --with-deps
```

---

## Configuration

### Quick Start

1. **Copy environment template:**
   ```bash
   # For sandbox
   cp .env.example .env
   
   # For testnet
   cp .env.example .env.testnet
   ```

2. **Configure credentials:**
   ```env
   MASTER_ACCOUNT=your-account.testnet
   MASTER_ACCOUNT_PRIVATE_KEYS=key1,key2,key3,key4,key5  # 5+ keys for 100 TPS
   FT_CONTRACT=your-ft-contract.testnet
   ```

3. **Optimize for 100+ TPS:**
   ```env
   # Throughput settings
   MAX_TX_PER_SECOND=150              # 30% margin above target
   MAX_TX_PER_KEY_PER_SECOND=30       # 30 TPS per key
   SANDBOX_MAX_IN_FLIGHT_PER_KEY=8    # Concurrent tx per key
   
   # Performance optimizations
   SKIP_STORAGE_CHECK=true            # Pre-register receivers
   WAIT_UNTIL=Included                # Fastest finality (WAIT_UNTIL=None is no longer supported)
   CONCURRENCY_LIMIT=600              # High concurrency
   ```

### Key Pool Configuration

**Critical for 100+ TPS:**
- **Minimum 5 keys** required for 100 TPS target
- Each key handles ~30 TPS max
- Keys must be function-call keys (not full-access)

**Generate keys:**
```bash
# Testnet
for i in {1..5}; do
  near account add-key your-account.testnet --allowanceGrant
done

# Sandbox (via near-ft-helper)
node near-ft-helper/deploy.js  # Auto-generates keys
```

### Logging

- `LOG_LEVEL` controls verbosity (`warn` is recommended for high-throughput runs).
- Set `PINO_DESTINATION=/path/to/service.log` (or the legacy `PINO_LOG_PATH`) to stream logs to a file. Run `node scripts/prepare-benchmark.mjs` to rotate old logs and emit the relevant `export` commands.
- File destinations default to **synchronous writes** so benchmarks no longer trip `_flushSync took too long` errors from `thread-stream`.
- Override the behavior with `PINO_SYNC=false` only if you have fast storage and want buffered writes. Tune the buffer with `PINO_MIN_LENGTH=<bytes>` when running async.

> Tip: Place log files on tmpfs or NVMe when running sustained load tests to avoid I/O stalls.

### Storage Registration

**For maximum performance, pre-register all receivers:**
```bash
# Register storage before benchmarking
SKIP_STORAGE_CHECK=true  # Enable in .env

# Pre-register receivers
for receiver in user1.near user2.near user3.near; do
  near call $FT_CONTRACT storage_deposit \
    '{"account_id":"'$receiver'"}' \
    --accountId $MASTER_ACCOUNT \
    --amount 0.00125
done
```

**Storage deposit**: 0.00125 NEAR per receiver (NEP-145 standard)

---

## Running the service

### Sandbox

```bash
nvm use 22
NEAR_ENV=sandbox npm run start:sandbox
NEAR_ENV=sandbox npm run run:worker:sandbox
```

Health check: `curl http://127.0.0.1:3000/health`

Sample transfer :
```bash
curl -X POST http://127.0.0.1:3000/send-ft \
   -H 'Content-Type: application/json' \
    -d '{"receiverId":"sandbox-receiver.testnet","amount":"1000000"}'
```

Track job persistence by querying the status API:

```bash
curl http://127.0.0.1:3000/transfer/<jobId>
```

### Testnet

```bash
nvm use 22
npm run start:testnet
npm run run:worker:testnet
```

The same health and transfer endpoints apply; the service picks up `.env.testnet` automatically.

### Deployment checklist

1. **Provision infrastructure.** Target any Node.js 20+ runtime (PM2, systemd, Docker). Mount the `data/` directory on persistent storage so job logs survive restarts.
2. **Configure environment.** Copy `.env.example`, fill in `MASTER_ACCOUNT`, `MASTER_ACCOUNT_PRIVATE_KEYS`, `FT_CONTRACT`, and set throttles / RPC URLs for your network. Repeat for `.env.testnet` if needed.
3. **Install dependencies & compile.**
   ```bash
   npm ci
   npm run build
   ```
4. **Launch API and worker.** Start both processes under your supervisor:
   ```bash
   NEAR_ENV=<env> npm run start:<env>
   NEAR_ENV=<env> npm run run:worker:<env>
   ```
5. **Monitor health.**
   - `/health` — liveness check
   - `/metrics` — Prometheus metrics (HTTP totals, latency histogram, queue gauges)
   - `/metrics/jobs` — JSON job counts (queued, processing, submitted, failed)
   - `/transfer/:jobId` — full lifecycle of an individual transfer
6. **Scale horizontally (optional).** When running multiple API instances, back the JSONL persistence with a shared volume or object storage so all coordinators see the same jobs.

---

## Testing and Benchmarks

### Quick Test Commands

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | Validate TypeScript signatures |
| `npm run security` | Audit dependencies (fails on critical) |
| `npm run test:frontend` | Playwright UI tests |
| `npm run test:sandbox` | Sandbox integration tests |

### Benchmark Commands

| Command | Description |
|---------|-------------|
| `npm run benchmark` | Quick local throughput test |
| `./testing/artillery/run-artillery-test.sh sandbox` | **10-minute sustained 100 TPS test** |
| `./testing/artillery/run-artillery-test.sh testnet` | Testnet load verification |
| `MAX_TPS=65 TEST_DURATION=540 ./testing/test-complete-pipeline.sh` | **Automated sandbox: 65 TPS, 9 minutes** |
| `TESTNET_TARGET_TPS=70 TESTNET_TEST_DURATION=540 ./testing/test-complete-pipeline-testnet.sh` | **Automated testnet: 70 TPS, 9 minutes** |
| `SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh` | 90-second smoke with auto sandbox + Artillery |

```

### 🎯 Automated Benchmark Commands

**Sandbox (65 TPS, 9 minutes):**
```bash
MAX_TPS=65 TEST_DURATION=540 ./testing/test-complete-pipeline.sh
```

**Testnet (70 TPS, 9 minutes):**
```bash
TESTNET_TARGET_TPS=70 TESTNET_TEST_DURATION=540 ./testing/test-complete-pipeline-testnet.sh
```

### 🎯 Legacy 100+ TPS Benchmark (10 Minutes)

**Primary benchmark target (10-minute 100 TPS run):**

```bash
# Step 1: Setup (one-time)
cp .env.example .env
# Edit .env: Add 5+ keys, set SKIP_STORAGE_CHECK=true, WAIT_UNTIL=Included
# Sandbox defaults for fast confirmations & concurrency
export WAIT_UNTIL=Included
export SANDBOX_MAX_IN_FLIGHT_PER_KEY=6
export MAX_IN_FLIGHT_PER_KEY=6

# Artillery ≥2.0 requires Node 22.13+. `nvm use 22` (or newer) before running the pipeline to avoid EBADENGINE warnings.

# Step 2: Start services
# Terminal 1
cd near-ft-helper && node deploy.js

# Terminal 2
cd ft-claiming-service
NEAR_ENV=sandbox npm run start:sandbox

# Terminal 3
NEAR_ENV=sandbox npm run run:worker:sandbox

# Step 3: Pre-register receivers
node ci/bootstrap-sandbox-accounts.mjs

# Step 4: Run 10-minute benchmark (60,000+ transfers)
ARTILLERY_PROFILE=benchmark-sandbox.yml \
npx artillery run testing/artillery/benchmark-sandbox.yml \
  --output test-results/benchmark-10min-$(date +%Y%m%d-%H%M%S).json
```


📚 **Detailed guide**: [docs/PERFORMANCE_OPTIMIZATION.md](docs/PERFORMANCE_OPTIMIZATION.md)

🔍 **Metrics sanity check:** After the run, hit `http://127.0.0.1:3000/metrics/jobs` to confirm the `submitted` counter is >0. For dashboards, scrape `http://127.0.0.1:3000/metrics` (Prometheus format) to visualise success/error trends. The benchmark CI pipeline now fails automatically when no jobs reach `submitted`.

### CI/CD Integration

- **Automated benchmarks** run on every push to `main`
- **Weekly schedule**: Tuesday 01:00 WIB
- **On-demand**: Manual trigger via GitHub Actions
- **Artifacts**: Logs, JSON results, HTML reports

---

## Frontend demo

The static UI in `examples/send-ft-frontend/` lets you exercise the API from a browser. It offers quick presets (local sandbox, local testnet, remote host), remembers form values with `localStorage`, and logs responses for manual QA.

Quick start:

```bash
# Terminal 1 – start API (sandbox or testnet)
npm run start:testnet

# Terminal 2 – serve the static files
cd examples/send-ft-frontend
npx http-server
```

Open the served URL (usually `http://127.0.0.1:8080`), pick a preset, then submit a transfer. The Playwright suite in `tests/frontend/send-ft.spec.ts` automates the same flow.

---

## Minting supply

Deploy the FT contract to a dedicated account you control (for example, `ft.your-org.testnet`). To top up balances:

1. Rebuild the WASM if the contract changed:
   ```bash
   cd ft
   cargo build --target wasm32-unknown-unknown --release
   ```
2. Deploy the new WASM (via `near-api-js` or `near` CLI).
3. Call `ft_mint` from the contract owner, attaching 1 yoctoNEAR and passing the raw amount (`tokens × 10^decimals`):
   ```bash
   node --input-type=module - <<'NODE'
   import { connect, keyStores } from 'near-api-js';
   import os from 'os';
   import path from 'path';

   const networkId = 'testnet';
   const contractId = process.env.FT_CONTRACT;
   const signerId = contractId;
   const amount = process.env.FT_MINT_AMOUNT;
   if (!contractId) throw new Error('Set FT_CONTRACT to your deployed FT contract (e.g., ft.your-org.testnet).');
   if (!amount) throw new Error('Set FT_MINT_AMOUNT (raw units).');

   const keyStore = new keyStores.UnencryptedFileSystemKeyStore(path.join(os.homedir(), '.near-credentials'));
   const near = await connect({ networkId, nodeUrl: process.env.NODE_URL, deps: { keyStore } });
   const account = await near.account(signerId);

   await account.functionCall({
     contractId,
     methodName: 'ft_mint',
     args: { account_id: signerId, amount },
     gas: '300000000000000',
     attachedDeposit: '1'
   });

   console.log('Mint complete');
   NODE
   ```

Ensure the recipient has registered storage (`storage_deposit`) before minting to that account.

---

### Logs and Debugging

**Structured logging (Pino):**
```bash
# Save logs to file
npm run start:testnet | tee service.log

# Monitor in real-time
tail -f service.log | grep -E '(TPS|error|throttle)'
```

**Debug modes:**
```env
LOG_LEVEL=debug  # Verbose logging
ENABLE_MEMORY_MONITORING=true  # Memory tracking
```

---


## Repository Layout

```
├── ft/                       # NEP-141 FT contract (Rust)
│   ├── src/                  # Contract source code
│   └── target/               # Compiled WASM
│
├── near-ft-helper/           # Sandbox/testnet helper scripts
│   └── deploy.js             # Automated setup
│
├── ft-claiming-service/      # Main API service
│   ├── src/                  # API, coordinator, batching, persistence
│   ├── scripts/              # Testnet setup scripts
│   ├── testing/              # Artillery configs & pipeline scripts
│   ├── docs/                 # Documentation
│   └── examples/             # Demo frontend
```

## Documentation

- **[Performance Optimization Guide](docs/PERFORMANCE_OPTIMIZATION.md)** - Achieving 100+ TPS
- **[Testing Guide](docs/testing.md)** - Test strategy and best practices
- **[CI/CD Guide](docs/ci.md)** - GitHub Actions workflows
- **[API Documentation](docs/api.md)** - REST API reference (TODO)
- **[NEAR FT Reference Implementation](https://github.com/near-examples/FT)** - Canonical NEP-141 contract spec
- **[near-ft-helper Sandbox Toolkit](https://github.com/Psianturi/near-ft-helper)** - Helper scripts for provisioning sandbox accounts and keys
