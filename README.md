# NEAR Fungible Token Claiming Service

[![CI](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml/badge.svg)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml)
[![Sandbox Integration](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/sandbox-integration.yml/badge.svg)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/sandbox-integration.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescript.org/)
[![NEAR Protocol](https://img.shields.io/badge/NEAR-Protocol-blue)](https://near.org/)

A TypeScript/Express service for orchestrating NEP-141 (fungible token) transfers on NEAR. It now includes profiles for both the original 60-second stress test and the sustained benchmark goal of **100 transfers per second for 10 minutes** (≈ 60,000 successful transfers), and supports the local sandbox plus public testnet environments.

---

## 1. TL;DR

| Item | Sandbox | Testnet |
| --- | --- | --- |
| Config file | `.env` | `.env.testnet` |
| Entry point | `npm run start:sandbox` | `npm run start:testnet` |
| Worker runner | `npm run run:worker:sandbox` | `npm run run:worker:testnet` |
| Cluster launcher | `npm run start:sandbox:cluster` (auto CPU count, toggle via `SANDBOX_USE_CLUSTER`) | `npm run start:testnet:cluster` (optional) |
| Load test | `./testing/artillery/run-artillery-test.sh sandbox` | `./testing/artillery/run-artillery-test.sh testnet` |
| Latest load snapshot (2025-10-01) | 186 / 25,800 requests OK (0.7 %), 93 RPS avg, ETIMEDOUT & nonce contention from single signer | 127 TPS avg (2025-09-28 run), requires FastNEAR RPC |

🔔 **Key insight**: the sandbox still struggles once arrival rates exceed what a single signer key can handle. Expect “nonce retries exceeded” and “account doesn’t have enough balance” around the 25k-request mark even after pre-registering receivers. The pipeline now launches the API in cluster mode by default and batches all `/send-ft` `transfers[]` into a single on-chain transaction, but we still need a larger key pool (one key per worker) to cross the 60k-transfer goal—see [§5 Benchmark status](#5-benchmark-status) for the latest metrics & mitigation plan.

---

## 2. Requirements

- Node.js ≥ 22.13 for load testing (Node 24 recommended; run `nvm use 24` before any `npm`/`npx` command to match CI)
- npm ≥ 9
- Rust toolchain (if rebuilding `fungible_token.wasm`)
- NEAR Sandbox (`npx near-sandbox`) for local runs
- FastNEAR RPC key for testnet high-throughput tests

Install dependencies once:

```bash
npm install
```

---

## 3. Environment files & key management

### 3.1 Files

| File | Purpose |
| --- | --- |
| `.env` | Local sandbox configuration (starter account, multi-key pool, worker count). |
| `.env.testnet` | Public testnet configuration. |
| `.env.example` | Template—copy and adjust for new environments. |

### 3.2 Sandbox master account setup

> Quick start: `.env.example` already contains the shared sandbox signer `service.test.near` and its key pool. Import that file as-is to get running immediately. Follow the steps below only if you need to recreate or rotate the sandbox account.

1. **Boot the sandbox node** (run `nvm use 24` in this shell first)
    ```bash
    npx near-sandbox init
    npx near-sandbox run
    ```
    Leave the node running in a separate shell.
2. **Create a dedicated signer account** (example: `service.test.near`). Use either:
    - **near-cli** (v3+):
       ```bash
       near account create service.test.near \
          --useFunder test.near \
          --initialBalance 50 \
          --networkId sandbox \
          --nodeUrl http://127.0.0.1:3030
       ```
    - **Inline Node script** (requires `near-api-js` already installed via `npm install`):
       ```bash
       node - <<'NODE'
       const { connect, keyStores, utils } = require("near-api-js");
       const networkId = "sandbox";
       const nodeUrl = "http://127.0.0.1:3030";
       const rootAccountId = "test.near";
       const newAccountId = "service.test.near"; // adjust as needed
       const initialDeposit = utils.format.parseNearAmount("50");
       (async () => {
          const keyStore = new keyStores.UnencryptedFileSystemKeyStore(`${process.env.HOME}/.near-credentials`);
          const near = await connect({ networkId, nodeUrl, keyStore });
          const root = await near.account(rootAccountId);
          const keyPair = utils.KeyPair.fromRandom("ed25519");
          await keyStore.setKey(networkId, newAccountId, keyPair);
          await root.createAccount(newAccountId, keyPair.getPublicKey(), initialDeposit);
          console.log(`Account: ${newAccountId}`);
          console.log(`Private key: ${keyPair.secretKey}`);
       })();
       NODE
       ```
       The default sandbox `test.near` key is stored in `~/.near-credentials/sandbox/test.near.json` after running `near-sandbox init`.
3. **Update `.env`** with the newly created account:
    - `MASTER_ACCOUNT=service.test.near`
    - `MASTER_ACCOUNT_PRIVATE_KEY=<primary secret key>`
    - `MASTER_ACCOUNT_PRIVATE_KEYS=<comma-separated list>`
   - Optional for hosted RPCs: set `SANDBOX_RPC_URL` and `SANDBOX_API_KEY` if your sandbox endpoint requires authentication.

### 3.3 Rotating sandbox access keys

Add extra keys so each worker can sign independently:

```bash
node - <<'NODE'
const { connect, keyStores, utils } = require("near-api-js");
const networkId = "sandbox";
const nodeUrl = process.env.NODE_URL || "http://127.0.0.1:3030";
const accountId = process.env.MASTER_ACCOUNT;
const primaryKey = process.env.MASTER_ACCOUNT_PRIVATE_KEY;
(async () => {
   if (!accountId || !primaryKey) {
      throw new Error("Set MASTER_ACCOUNT and MASTER_ACCOUNT_PRIVATE_KEY in your environment before running this script.");
   }
   const keyStore = new keyStores.InMemoryKeyStore();
   await keyStore.setKey(networkId, accountId, utils.KeyPair.fromString(primaryKey));
   const near = await connect({ networkId, nodeUrl, keyStore });
   const account = await near.account(accountId);
   for (let i = 0; i < 2; i++) {
      const kp = utils.KeyPair.fromRandom("ed25519");
      await account.addKey(kp.getPublicKey());
      console.log(kp.secretKey);
   }
})();
NODE
```

Append each printed key to `MASTER_ACCOUNT_PRIVATE_KEYS` (comma-separated) so the worker pool can rotate signers.

> ℹ️ The service now round-robins every request across the keys listed in `MASTER_ACCOUNT_PRIVATE_KEYS` (sandbox and testnet). Keep the pool size aligned with active workers to minimise nonce contention.

### 3.4 Testnet keys

- Use an existing funded testnet account (e.g., `posm.testnet`) or deploy the helper suite in [`near-ft-helper`](../near-ft-helper/).
- Create additional access keys via `near account add-key ...` or NEAR Wallet for higher throughput.
- Populate `.env.testnet` with:
   - `MASTER_ACCOUNT`
   - `MASTER_ACCOUNT_PRIVATE_KEY(S)`
   - `FT_CONTRACT`
   - Optional `FASTNEAR_API_KEY` if using the FastNEAR RPC.
- Store credentials under `~/.near-credentials/testnet/` and never commit them.

---

## 4. Sandbox runbook

Use this flow whenever you need a fresh sandbox; activate `nvm use 24` in each terminal before running Node/npm commands.

### Step 1 — Deploy the FT contract

```bash
set -a && source .env && set +a
export NEAR_SIGNER_ACCOUNT_ID=$MASTER_ACCOUNT
export NEAR_CONTRACT_ACCOUNT_ID=$FT_CONTRACT
export NEAR_SIGNER_ACCOUNT_PRIVATE_KEY=$MASTER_ACCOUNT_PRIVATE_KEY
node ci/deploy-sandbox-rpc.mjs
```

### Step 2 — Bootstrap receivers (subaccounts)

```bash
export SANDBOX_RECEIVER_LIST="user1.${MASTER_ACCOUNT},user2.${MASTER_ACCOUNT},user3.${MASTER_ACCOUNT}"
node ci/bootstrap-sandbox-accounts.mjs
```
This creates subaccounts and registers FT storage deposits.

### Step 3 — Launch API & worker pool

```bash
SANDBOX_CLUSTER_WORKERS=0 npm run start:sandbox:cluster > service-local.log 2>&1 &
npm run run:worker:sandbox > worker-local.log 2>&1 &
```
- `SANDBOX_CLUSTER_WORKERS=0` lets the launcher pick `availableParallelism()` automatically. Override with an explicit value (e.g. `CLUSTER_WORKERS=6`) or set `SANDBOX_USE_CLUSTER=0` to fall back to the single-process server for comparison.
- Adjust `WORKER_COUNT` in `.env` (default 8 after the latest tuning).
- Provide one access key per worker in `MASTER_ACCOUNT_PRIVATE_KEYS`; the API rotates through them automatically on each transaction.
- Health check: `curl http://127.0.0.1:3000/health`.
- Smoke transfer (`/send-ft` now batches any `transfers[]` payload into a single transaction):
   ```bash
   curl -X POST http://127.0.0.1:3000/send-ft \
      -H 'Content-Type: application/json' \
      -d '{"transfers":[{"receiverId":"user1.'"${MASTER_ACCOUNT}"'","amount":"1000000"},{"receiverId":"user2.'"${MASTER_ACCOUNT}"'","amount":"5000000"}]}'
   ```

### Step 4 — Load test

Run the scenario via the helper script and refer to the [Artillery Testing Guide](ARTILLERY_TESTING_GUIDE.md) for arrival rates, troubleshooting, and performance tuning tips. Set `SANDBOX_BENCHMARK_10M=1` to switch the pipeline to the sustained 600-second / 100 TPS profile defined in `testing/artillery/benchmark-sandbox-10m.yml`—the new warm-up+ramp adds ~3 minutes (plan for ~13 minutes end-to-end). Load hosts must run **Node.js ≥ 22.13** so Artillery 2.x can start without engine errors. The pipeline starts the API in cluster mode by default (`SANDBOX_USE_CLUSTER=1`); override `SANDBOX_CLUSTER_WORKERS` or disable clustering with `SANDBOX_USE_CLUSTER=0` when you need single-thread baselines.

```bash
nvm use 24
./testing/artillery/run-artillery-test.sh sandbox
```

Artifacts (JSON statistics) are written under `testing/artillery/artillery-results-sandbox-*.json`. Use `./testing/test-complete-pipeline.sh` for the end-to-end sandbox pipeline—it now deploys, bootstraps receivers (`ci/bootstrap-sandbox-accounts.mjs`), executes Artillery with the selected profile, and prints a JSON summary to the terminal. Always run `nvm use 24` before executing any script. The pipeline automatically caches the `near-sandbox` binary under `~/.cache/near-sandbox/`, so it works safely from any filesystem (including WSL `/mnt/*`). Set `ARTILLERY_CONFIG=<file.yml>` (or enable `SANDBOX_BENCHMARK_10M=1`) when you need a different scenario.

---

## 5. Benchmark status

| Date | Environment | Worker count | Key pool | Avg RPS | Success % | Major errors |
| --- | --- | --- | --- | --- | --- | --- |
| 2025-10-01 | Sandbox (cluster auto, Node 18) | auto (~8) | 1 key | 93 | 0.72% | `errors.ETIMEDOUT`, `errors.ECONNRESET`, nonce retries |
| 2025-10-01 | Testnet | 5 | 1 key | 93 | 0.43% | FastNEAR rate limiting (-429), RPC timeouts |

### 5.1 Roadmap to the 60k-transfer benchmark

- **Goal recap**: 100 successful FT transfers per second for 10 minutes (≈ 60,000 transfers). The profile lives at `testing/artillery/benchmark-sandbox-10m.yml` and is enabled via `SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh`.
- **Current bottleneck**: Sandbox runs saturate a single signer key—`nonce retries exceeded` dominates once 25k+ requests race for the same key, even after pre-registering receivers.
- **Mitigation plan**:
   1. Expand the signer key pool (one access key per worker / ~20 TPS) and rotate them via `MASTER_ACCOUNT_PRIVATE_KEYS`.
   2. Upgrade the load harness to Node 22+ and keep the new Artillery keep-alive/timeout settings so sockets aren’t churned under pressure.
   3. Keep the API in cluster mode and favour batched `/send-ft` payloads so each transaction carries many transfers; temporarily lower `CONCURRENCY_LIMIT`/`MAX_IN_FLIGHT` in `.env` to avoid nonce storms until rotation lands.
   4. Rerun the 10-minute profile and confirm ≥ 60,000 `http.codes.200` successes; capture deltas under `test-results/` for posterity.
   5. Apply the same key fan-out to testnet, pairing it with additional FastNEAR or RPC endpoints to maintain throughput without throttling.

Benchmark scripts live in `testing/artillery/benchmark-sandbox.yml`, `testing/artillery/benchmark-testnet.yml`, and `testing/artillery/run-artillery-test.sh`.

---

## 6. Testnet runbook

1. Copy `.env.example` → `.env.testnet` and fill in:
   - `MASTER_ACCOUNT=posm.testnet` (or your own)
   - `MASTER_ACCOUNT_PRIVATE_KEY(S)`
   - `FT_CONTRACT` (contract owner)
   - Optional: `FASTNEAR_API_KEY`
2. Start the API & worker:
   ```bash
   npm run start:testnet > service.log 2>&1 &
   npm run run:worker:testnet > worker.log 2>&1 &
   ```
3. Verify:
   ```bash
   curl http://127.0.0.1:3000/health
   curl -X POST http://127.0.0.1:3000/send-ft \
     -H 'Content-Type: application/json' \
     -d '{"receiverId":"receiver.testnet","amount":"1000000"}'
   ```
4. Load test:
   ```bash
   ./testing/artillery/run-artillery-test.sh testnet
   ```
   Ensure RPC quotas are large enough or add secondary `RPC_URLS` for failover.

---

## 7. Troubleshooting checklist

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `no matching key pair` | `MASTER_ACCOUNT_PRIVATE_KEY` missing/incorrect | Regenerate key (`near account add-key`), update `.env`. |
| `nonce retries exceeded` | Too many parallel tx on one key | Add more keys, lower arrival rate, or increase retry backoff. |
| `The account doesn't have enough balance` | FT contract drained | Mint more tokens or throttle storage deposits. |
| `errors.ETIMEDOUT` / `errors.ECONNRESET` | RPC saturation | Add RPC endpoints, reduce load, or slow ramp-up. |
| `Smart contract panicked: account not registered` | Receiver missing storage deposit | Ensure `bootstrap-sandbox-accounts.mjs` ran or enable `SKIP_STORAGE_CHECK=false`. |

Logs:
- API: `tail -f service-local.log`
- Workers: `tail -f worker-local.log`
- Sandbox node: `tail -f sandbox.log`

---

## 8. Script reference

### 8.1 Shell helpers (`.sh`)

| Script | Command to run | Purpose |
| --- | --- | --- |
| `testing/artillery/run-artillery-test.sh` | `./testing/artillery/run-artillery-test.sh sandbox` | Execute the sandbox Artillery scenario and save JSON/HTML reports under `testing/artillery/artillery-results-sandbox-*`. Supports overrides via `ARTILLERY_CONFIG=<file.yml>`. |
|  | `./testing/artillery/run-artillery-test.sh testnet` | Execute the testnet Artillery scenario (ensure RPC quotas and FastNEAR key). |
| `testing/test-complete-pipeline.sh` | `./testing/test-complete-pipeline.sh` | End-to-end pipeline: deploy sandbox contract, bootstrap receivers, run smoke tests, then trigger the sandbox Artillery profile. Set `SANDBOX_BENCHMARK_10M=1` for the 600-second benchmark or `ARTILLERY_CONFIG=<file.yml>` to point at a custom scenario. |
| `ci/run-local-sandbox.sh` | `./ci/run-local-sandbox.sh` | Spin up a local sandbox node plus helper processes (used by CI, also handy for local bring-up). |
| `Artillery CLI` | `npx artillery report <json> --output report.html` | Convert saved JSON output into an HTML report for sharing. |

> Shell utilities live under `testing/` (Artillery) and the repo root (`ci/`). Run `chmod +x testing/**/*.sh ci/*.sh` once if your checkout stripped executable bits.
> The sandbox benchmark now ships with an extended warm-up and ramp to reduce nonce spikes; clone the YAML if you need an even gentler profile or want to reintroduce aggressive surge phases.

### 8.2 Node/npm scripts

| Command | Purpose |
| --- | --- |
| `npm run start:sandbox` | Start API in sandbox mode (reads `.env`). |
| `npm run run:worker:sandbox` | Launch Bull worker processing queue jobs. |
| `node ci/deploy-sandbox-rpc.mjs` | Deploy and initialise the FT contract on the sandbox RPC. |
| `node ci/bootstrap-sandbox-accounts.mjs` | Create receiver subaccounts and submit storage deposits. |
| `npm run start:testnet` / `npm run run:worker:testnet` | Testnet equivalents reading `.env.testnet`. |
| `npm run test:sandbox` / `npm run test:testnet` | near-workspaces smoke suites for each environment. |
| `npm run typecheck` / `npm run build` | TypeScript project validation and compilation. |

---

## 9. Account & subaccount tutorial

### 9.1 Sandbox walkthrough

1. **Obtain the root sandbox key** – after `npx near-sandbox init`, the key for `test.near` is stored in `~/.near-credentials/sandbox/test.near.json`.
2. **Create a new master account** (example: `service.test.near`). Choose either path:
   - near-cli:
     ```bash
     near account create service.test.near \
       --useFunder test.near \
       --initialBalance 50 \
       --networkId sandbox \
       --nodeUrl http://127.0.0.1:3030
     ```
   - Inline Node script (see [§3.2](#32-sandbox-master-account-setup)).
3. **Add worker keys** – run the rotation script in [§3.3](#33-rotating-sandbox-access-keys) until you have one key per worker, then paste them into `MASTER_ACCOUNT_PRIVATE_KEYS`.
4. **Create receiver subaccounts** (manual alternative to `bootstrap-sandbox-accounts.mjs`):
   ```bash
   export MASTER_ACCOUNT=service.test.near
   export NETWORK_OPTS="--networkId sandbox --nodeUrl http://127.0.0.1:3030"

   near account create user1.service.test.near --useFunder $MASTER_ACCOUNT --initialBalance 5 $NETWORK_OPTS
   near account create user2.service.test.near --useFunder $MASTER_ACCOUNT --initialBalance 5 $NETWORK_OPTS
   near account create user3.service.test.near --useFunder $MASTER_ACCOUNT --initialBalance 5 $NETWORK_OPTS

   near call $FT_CONTRACT storage_deposit '{"account_id":"user1.service.test.near"}' --amount 0.00125 --accountId $MASTER_ACCOUNT $NETWORK_OPTS
   near call $FT_CONTRACT storage_deposit '{"account_id":"user2.service.test.near"}' --amount 0.00125 --accountId $MASTER_ACCOUNT $NETWORK_OPTS
   near call $FT_CONTRACT storage_deposit '{"account_id":"user3.service.test.near"}' --amount 0.00125 --accountId $MASTER_ACCOUNT $NETWORK_OPTS
   ```
5. **Mint tokens for testing** (if receivers need balances):
   ```bash
   near call $FT_CONTRACT ft_mint '{"account_id":"service.test.near","amount":"1000000000000"}' \
     --accountId $MASTER_ACCOUNT --amount 0 --gas 300000000000000 $NETWORK_OPTS
   ```

### 9.2 Testnet pointers

1. Create or pick a funded account on https://wallet.testnet.near.org/ (e.g., `posm.testnet`).
2. Export its private key via NEAR Wallet **or** `near account export posm.testnet --networkId testnet` and place it in `~/.near-credentials/testnet/`.
3. Create worker access keys (generate fresh key pairs with `near generate-key <alias> --networkId testnet`, then add the public key to the account):
   ```bash
   near account add-key posm.testnet --networkId testnet --publicKey <ed25519:...>
   ```
   Repeat for as many workers as you plan to run.
4. Create receiver accounts (subaccounts or standalone) and register storage:
   ```bash
   near account create receiver1.posm.testnet --useFunder posm.testnet --initialBalance 5 --networkId testnet
   near call $FT_CONTRACT storage_deposit '{"account_id":"receiver1.posm.testnet"}' --amount 0.00125 --accountId posm.testnet --networkId testnet
   ```
5. Update `.env.testnet` with the new keys and the deployed FT contract ID before launching the service.

---

## 10. License

MIT – see [LICENSE](./LICENSE).
