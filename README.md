# NEAR Fungible Token Claiming Service

A TypeScript/Express service that queues and signs NEP-141 transfers for NEAR accounts. It supports the NEAR sandbox and public testnet, includes a worker pool for concurrency, and ships with tooling for benchmarking and a minimal frontend demo.

---

## Overview

- **REST API** – `/send-ft` accepts single or batched transfers and rotates through a key pool.
- **Workers** – background processors execute queued transfers and respect per-key throttles.
- **Environment awareness** – `.env` (sandbox) and `.env.testnet` keep credentials isolated.
- **Tooling** – Artillery profiles, Playwright smoke tests, and helper scripts for deployment and minting.

**Recent updates:** tuned per-key throttle defaults, refreshed frontend presets, and added CI notes for the load-testing pipeline.

Use this service when you need a repeatable way to distribute fungible tokens with controlled throughput.

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

Sample transfer:
```bash
curl -X POST http://127.0.0.1:3000/send-ft \
  -H 'Content-Type: application/json' \
  -d '{"receiverId":"receiver.test.near","amount":"1000000"}'
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
| `npm run test` | Playwright smoke tests for the frontend demo. |
| `npm run test:sandbox` | Integration checks against sandbox. |
| `npm run test:testnet` | Integration checks against testnet. |
| `./testing/artillery/run-artillery-test.sh sandbox` | Artillery load profile for sandbox. |
| `./testing/artillery/run-artillery-test.sh testnet` | Artillery load profile for testnet. |

Before running Artillery, ensure Node 22+ is active and your key pool matches the worker count referenced in the environment file.

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

The contract deployed to `posm.testnet` exposes a guarded `ft_mint` method. To top up balances:

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
   const contractId = process.env.FT_CONTRACT || 'posm.testnet';
   const signerId = contractId;
   const amount = process.env.FT_MINT_AMOUNT;
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
