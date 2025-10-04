# NEAR Fungible Token Claiming Service

[![CI](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml)
[![Sandbox Benchmark](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml/badge.svg?branch=main)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml)

A TypeScript/Express service that queues and signs NEP-141 transfers for NEAR accounts. It supports the NEAR sandbox and public testnet, includes a worker pool for concurrency, and ships with tooling for benchmarking and a minimal frontend demo.

---

## Overview

- **REST API** – `/send-ft` accepts single or batched transfers and rotates through a key pool.
- **Workers** – background processors execute queued transfers and respect per-key throttles.
- **Environment awareness** – `.env` (sandbox) and `.env.testnet` keep credentials isolated.
- **Tooling** – Artillery profiles, Playwright smoke tests, and helper scripts for deployment and minting.

**Recent updates:** tuned per-key throttle defaults, refreshed frontend presets, documented the sandbox load-testing pipeline (MAX_TX_PER_SECOND=180, headroom 85%), and captured the latest Artillery snapshot (~105 RPS sustained).

Use this service when you need a repeatable way to distribute fungible tokens with controlled throughput.

---

## Quick start checklist

1. **Clone & enter the workspace.**
   ```bash
   git clone https://github.com/Psianturi/near-ft-claim-service.git
   cd near-ft-claim-service/ft-claiming-service
   ```
2. **Match the toolchain and install dependencies.**
   ```bash
   nvm install 24
   nvm use 24
   npm install
   npx playwright install --with-deps
   ```
3. **Configure credentials.** Copy `.env.example` to `.env` (sandbox) and/or `.env.testnet`, then fill in NEAR accounts, private keys, and contract IDs.
4. **Boot the API + worker.** Use two terminals for sandbox or testnet:
   ```bash
   # Terminal 1
   NEAR_ENV=sandbox npm run start:sandbox

   # Terminal 2
   NEAR_ENV=sandbox npm run run:worker:sandbox
   ```
   Swap `sandbox` with `testnet` to hit real RPCs. The worker respects per-key throttles and queues transfers.
5. **Smoke-test the endpoint.** Replace `your-receiver.testnet` with an account that has registered storage on the FT contract.
   ```bash
   curl http://127.0.0.1:3000/health
   curl -X POST http://127.0.0.1:3000/send-ft \
     -H 'Content-Type: application/json' \
       -d '{"receiverId":"your-receiver.testnet","amount":"1000000"}'
   ```
6. **Run the quality gates (same as CI).**
   ```bash
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

- Node.js 22 or newer (Node 24 recommended; run `nvm use 24`).
- npm 9 or newer.
- Rust toolchain if you plan to rebuild the contract WASM in `ft/`.
- NEAR account credentials for the target environment.

Install dependencies once:

```bash
npm install
```

---

## Configuration

1. Copy the sample environment file:
   - Sandbox: `cp .env.example .env`
   - Testnet: `cp .env.example .env.testnet`
2. Populate the essentials:
   - `MASTER_ACCOUNT` / `MASTER_ACCOUNT_PRIVATE_KEY`
   - `MASTER_ACCOUNT_PRIVATE_KEYS` (comma-separated list, one per worker recommended)
   - `FT_CONTRACT`
   - Optional overrides: `RPC_URLS`, throttle limits, ports
3. Secrets stay local—never commit `.env*` files. The service loads `.env` when `NEAR_ENV=sandbox`; otherwise `.env.testnet` is used by default.

### Key pool hints

- Generate extra function-call keys with `near account add-key` (testnet) or sandbox helper scripts.
- Match the number of keys to the number of workers to avoid nonce contention.
- Tune `MAX_IN_FLIGHT_PER_KEY` and per-key throttles if you see `InvalidNonce` errors.

### Storage registration

- By default the API checks `storage_balance_of` and attaches a `storage_deposit` action before the transfer if the receiver has never registered on the FT contract.
- Leave `SKIP_STORAGE_CHECK=false` in your environment files unless every receiver is already registered; skipping the check will surface on-chain panics like `The account <id> is not registered`.
- `STORAGE_MIN_DEPOSIT` controls the deposit attached for new receivers (`1250000000000000000000` yocto ≈ 0.00125 NEAR by default).

---

## Running the service

### Sandbox

```bash
nvm use 24
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

### Testnet

```bash
nvm use 24
npm run start:testnet
npm run run:worker:testnet
```

The same health and transfer endpoints apply; the service picks up `.env.testnet` automatically.

---

## Testing and benchmarks

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Validate TypeScript signatures and NEP-141 payload shapes. |
| `npm run security` | Audit npm dependencies (fails on critical issues). |
| `npm run test:frontend` | Playwright smoke tests for the static UI (Chromium). |
| `npm run test:sandbox` | Integration checks on an ephemeral sandbox chain (near-workspaces). |
| `npm run test:testnet` | Integration checks against FastNEAR RPC on public testnet. |
| `npm run benchmark` | Local throughput sampler using internal queue throttles. |
| `./testing/artillery/run-artillery-test.sh sandbox` | Sustained 10-minute load at 100 TPS on sandbox. |
| `./testing/artillery/run-artillery-test.sh testnet` | Single-run load verification on public testnet. |

Before running Artillery, ensure Node 22+ is active and your key pool matches the worker count referenced in the environment file. For rationale, see `docs/testing.md`; CI wiring is described in `docs/ci.md`.

### CI-powered sandbox benchmark

- The **Sandbox Benchmark** workflow (`.github/workflows/benchmark.yml`) now runs automatically on every push to `main`, on a weekly schedule (Tuesday 01:00 WIB), and on-demand via the *Run workflow* button.
- Each run executes `testing/test-complete-pipeline.sh` with CI-tuned knobs (`TEST_DURATION=240`, `MAX_TPS=180`, `CLUSTER_WORKERS=4`, `SANDBOX_MAX_IN_FLIGHT_PER_KEY=2`) and uploads sandbox/API logs plus raw Artillery JSON under the `sandbox-benchmark-artifacts` bundle.
- A helper script `scripts/report-benchmark.mjs` parses the latest Artillery output and appends a Markdown summary (RPS, latency, success rate) directly to the GitHub Actions job summary so results are easy to inspect.
- Trigger locally if you want the same summary: `node scripts/report-benchmark.mjs`.

### Sandbox load-test snapshot (2025-10-04)

- **Environment knobs (.env):** `MAX_TX_PER_SECOND=180`, `MAX_TX_PER_KEY_PER_SECOND=20`, `CONCURRENCY_LIMIT=600`, `BATCH_SIZE=100`, `WORKER_COUNT=12`, `QUEUE_SIZE=25000`, `SANDBOX_MAX_IN_FLIGHT_PER_KEY=3`, `SKIP_STORAGE_CHECK=true`.
- **Derived targets:** Headroom factor is 85%, yielding `ARTILLERY_TARGET_TPS≈153` and a warm-up ramp at ~50% of the goal.
- **Pipeline health:** `./testing/test-complete-pipeline.sh` now regenerates `artillery-local.yml` with 2-space indentation, exports `timestamp`, injects storage deposits automatically, and validates the API before load.
- **Latest sandbox run:** 34,530 requests executed, 3,443 HTTP 200s, 31,087 timeouts (no 4xx/5xx), mean rate ~105 RPS, p95 latency 36 ms, tail spikes when near-sandbox RPC saturates.
- **Interpretation:** The sandbox binary tops out before the service; lower `ARTILLERY_TARGET_TPS` or increase RPC headroom if timeouts become a blocker. The API and worker pool remained healthy during the run (no 5xx responses).

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

## Logs and troubleshooting

- API and worker processes use structured logs (Pino). Pipe to files with `npm run start:testnet | tee service.log`.
- Frequent 500 responses usually point to nonce contention or missing storage deposits. Expand the key pool and inspect worker logs for hints.
- When pushing load, rotate or pool RPC endpoints via `RPC_URLS` to avoid rate limits.

---

## Repository layout

```
ft/                      # NEP-141 contract (Rust)
ft-claiming-service/
  src/                   # Express API, worker, helpers
  tests/                 # Playwright + integration suites
  testing/               # Artillery load scenarios
  examples/send-ft-frontend/  # Static demo UI
near-ft-helper/          # Deployment utilities for testnet
```

This README stays intentionally high-level. Add environment-specific runbooks under `docs/` whenever deeper guidance is required.
