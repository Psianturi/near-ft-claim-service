# NEAR Fungible Token Claiming Service

[![CI](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml/badge.svg)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/ci.yml)
[![Sandbox Integration](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/sandbox-integration.yml/badge.svg)](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/sandbox-integration.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescript.org/)
[![NEAR Protocol](https://img.shields.io/badge/NEAR-Protocol-blue)](https://near.org/)

A TypeScript/Express service for orchestrating NEP-141 (fungible token) transfers on NEAR. It is used in load tests that target **100+ TPS sustained for 60 seconds**, and supports both the local sandbox and public testnet environments.

---

## 1. TL;DR

| Item | Sandbox | Testnet |
| --- | --- | --- |
| Config file | `.env` | `.env.testnet` |
| Entry point | `npm run start:sandbox` | `npm run start:testnet` |
| Worker runner | `npm run run:worker:sandbox` | `npm run run:worker:testnet` |
| Load test | `./run-artillery-test.sh sandbox` | `./run-artillery-test.sh testnet` |
| Latest load snapshot (2025-10-01) | 39 / 13,950 requests OK, 71 RPS avg, heavy timeouts & nonce stalls | 127 TPS avg (2025-09-28 run), requires FastNEAR RPC |

🔔 **Key insight**: the sandbox struggles under the current Artillery schedule even after raising workers to 8 and rotating three access keys. Expect “nonce retries exceeded” and “account doesn’t have enough balance” when the queue has to mint storage or when receipts get re-ordered. See [§5 Benchmark status](#5-benchmark-status) for the latest metrics & mitigations.

---

## 2. Requirements

- Node.js ≥ 20 (Node 24 recommended for undici `File` support used by Artillery 2.x)
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

1. **Boot the sandbox node**
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

Use this flow whenever a fresh sandbox test is required.

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
npm run start:sandbox > service-local.log 2>&1 &
npm run run:worker:sandbox > worker-local.log 2>&1 &
```
- Adjust `WORKER_COUNT` in `.env` (default 8 after the latest tuning).
- Health check: `curl http://127.0.0.1:3000/health`.
- Smoke transfer:
  ```bash
  curl -X POST http://127.0.0.1:3000/send-ft \
    -H 'Content-Type: application/json' \
    -d '{"receiverId":"user1.'"${MASTER_ACCOUNT}"'","amount":"1000000"}'
  ```

### Step 4 — Load test

```bash
./run-artillery-test.sh sandbox
```
Artifacts land in `artillery-results-sandbox-*.json` and `artillery-report-sandbox-*.html`.

▶️ **Shortcut**: `./test-complete-pipeline.sh` chains Steps 1–4 automatically for a fresh sandbox smoke + load run.

**Observed 2025-10-01 (8 workers, 3 keys):**
- Total requests: 13,950; HTTP 200: 39; timeouts: 13,455.
- Average RPS: 71 (below the 100 TPS goal).
- Errors dominated by `nonce retries exceeded` (3,783 occurrences) and FT panics when subaccounts ran out of tokens.

**Mitigations to try next:**
- Increase `MASTER_ACCOUNT_PRIVATE_KEYS` pool (one key per worker).
- Lower Artillery phases (e.g., cap at 40 rps) or stagger with `arrivalCount` blocks.
- Refill `service.test.near` and receivers (FT burn from failed deposits drains balances).
- Enable `SKIP_STORAGE_CHECK=false` only if receivers are pre-registered.

---

## 5. Benchmark status

| Date | Environment | Worker count | Key pool | Avg RPS | Success % | Major errors |
| --- | --- | --- | --- | --- | --- | --- |
| 2025-10-01 | Sandbox | 8 | 3 keys | 71 | 0.28% | Nonce retries, FT insufficient balance |
| 2025-10-01 | Sandbox | 5 | 1 key | 43 | 0.93% | Nonce retries, FT insufficient balance |
| 2025-09-28 | Testnet | 5 | 4 keys | 127 | ~100% | Stable (uses FastNEAR RPC) |

Benchmark scripts live in `benchmark-sandbox.yml`, `benchmark-testnet.yml`, and `run-artillery-test.sh`.

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
   ./run-artillery-test.sh testnet
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
| `run-artillery-test.sh` | `./run-artillery-test.sh sandbox` | Execute the sandbox Artillery scenario and save JSON/HTML reports under `artillery-results-sandbox-*`. |
|  | `./run-artillery-test.sh testnet` | Execute the testnet Artillery scenario (ensure RPC quotas and FastNEAR key). |
| `test-complete-pipeline.sh` | `./test-complete-pipeline.sh` | End-to-end pipeline: deploy sandbox contract, bootstrap receivers, run smoke tests, then trigger the sandbox Artillery profile. |
| `ci/run-local-sandbox.sh` | `./ci/run-local-sandbox.sh` | Spin up a local sandbox node plus helper processes (used by CI, also handy for local bring-up). |
| `Artillery CLI` | `npx artillery report <json> --output report.html` | Convert saved JSON output into an HTML report for sharing. |

> All shell scripts live at the repo root. Run `chmod +x *.sh` once if your checkout stripped executable bits.

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
