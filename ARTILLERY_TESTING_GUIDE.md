# Artillery Load Testing Guide

Focused notes on how we exercise the claiming service with Artillery. Keep it light: start the API, run the helper script, read the JSON output, and iterate based on the metrics.

## 1. Prerequisites

- Dependencies installed (`npm install`).
- **Node.js ≥ 22.13** (Artillery 2.0.26 enforces this engine). Install with `nvm install 22 && nvm use 22` if your global runtime is older.
- Environment configured: `.env` for sandbox, `.env.testnet` for public network.
- API & worker processes running for the target network (`npm run start:<env>` and, when needed, `npm run run:worker:<env>`).
- For testnet: a FastNEAR API key (Pro tier in this project) and sufficient FT balances for the signer and receivers.

## 2. Running the scenarios

### Sandbox

```bash
# One-click pipeline (deploy, bootstrap receivers, run load + summary)
./testing/test-complete-pipeline.sh

# Ten-minute benchmark (100 TPS × 600 s with extended ramp-up)
SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh

# Manual sequence (reusing the generated profile)
npm run start:sandbox        # terminal 1 (cluster mode default)
ARTILLERY_CONFIG=artillery-local.yml ./testing/artillery/run-artillery-test.sh sandbox  # terminal 2
```

The script stores results as `testing/artillery/artillery-results-sandbox-*.json` and prints `RESULT_JSON=<path>` at the end. When you need to inspect the last run, capture that line from stdout or read it from `testing/artillery/.last-artillery-run.log` (written by the pipeline helper). Override `ARTILLERY_CONFIG` or set `SANDBOX_BENCHMARK_10M=1` to point at long-running profiles such as `benchmark-sandbox-10m.yml`.

### Testnet

```bash
npm run start:testnet        # ensure service is live
./testing/artillery/run-artillery-test.sh testnet
```

Use the FastNEAR key in `.env.testnet`. If you add secondary RPC endpoints, list them in `RPC_URLS`.

## 3. Scenario profile (default `testing/artillery/benchmark-*.yml`)

| Phase | Duration | Target rate |
| --- | --- | --- |
| Extended warm-up | 60 s | 5 → 25 rps |
| Ramp to target | 120 s | 25 → 100 rps |
| Sustained target | 120 s | 100 rps |
| Controlled surge (optional) | 60 s | 100 → 160 rps |

Each profile now enables HTTP keep-alive (`pool: 100`) and an explicit `timeout: 30` to reduce socket churn under load.

The long-form benchmark under `benchmark-sandbox-10m.yml` adds a 60 s warm-up plus a 120 s ramp before the 600 s sustained window, matching the “100 TPS for 10 minutes” requirement without the initial nonce storm. Expect the full run (pipeline + teardown) to last ~13 minutes.

Traffic mix: ~70 % batched `/send-ft` payloads (2–3 transfers per request), 20 % single transfers, 10 % `/health` checks.

Adapt the YAML if you need a calmer profile (e.g., remove the "Hyperdrive" stanza or clone the file under another name). The hyperdrive phase is inspired by [`omni-relayer-benchmark`](https://github.com/frolvanya/omni-relayer-benchmark) which demonstrates 600+ transfers/sec with a Rust-based driver.

## 4. Reading the results

1. Inspect the summary printed by `testing/artillery/run-artillery-test.sh` (total requests, success count, error distribution).
2. For deeper analysis, open the JSON:
   ```bash
   jq '.aggregate' testing/artillery/artillery-results-<env>-<timestamp>.json
   ```
3. Optional HTML report:
   ```bash
   npx artillery@latest report testing/artillery/artillery-results-<env>-<timestamp>.json
   ```

Key metrics to watch:
- **Success count / success rate** – the effective TPS.
- **`http.response_time` p95/p99** – end-to-end latency under load.
- **`errors.*` counters** – tells you whether the bottleneck is RPC, contract logic, or client timeouts.

## 5. Recent observations (2025‑10‑01)

| Environment | Load | Successes | Main blockers |
| --- | --- | --- | --- |
| Sandbox (single validator key) | 25,800 requests | 186 (0.72 %) | Nonce retries, RPC timeouts (ETIMEDOUT), ECONNRESET |
| Testnet (5 workers, 1 key) | 24,450 requests | 106 (0.43 %) | FastNEAR rate limiting (`-429`), RPC timeouts |

Notes:
- The sandbox profile is intentionally aggressive; start with a trimmed phase schedule when validating changes.
- Testnet runs currently saturate the FastNEAR Pro quota. Rotate additional access keys and spread requests across multiple RPC endpoints to reach higher sustained TPS.

## 6. Quick troubleshooting

| Symptom | Likely cause | Remedy |
| --- | --- | --- |
| `errors.ETIMEDOUT`, `errors.ECONNRESET` | RPC endpoint saturated | Add RPC URLs, reduce arrival rate, or pause between phases. |
| `InvalidNonce` failures | Too many concurrent tx per key | Expand `MASTER_ACCOUNT_PRIVATE_KEYS` (one key per worker) or lower concurrency. |
| `FT transfer failed: account not registered` | Receiver missing storage | Run the bootstrap script or set `SKIP_STORAGE_CHECK=false`. |
| `Rate limits exceeded (-429)` | FastNEAR quota reached | Wait for quota reset, rotate to a secondary key, or upgrade plan. |

## 7. Tips for higher TPS

- Keep the worker count and key pool aligned (N workers ⇒ N keys); the service round-robins across `MASTER_ACCOUNT_PRIVATE_KEYS` automatically once configured.
- Pre-fund receiver accounts and disable the storage check only when you are certain every receiver is registered.
- Use the extended warm-up/ramp phases (or lengthen them further) any time sandbox stability is an issue.
- Upgrade the load host to Node 22+ so Artillery can take advantage of the latest undici improvements.
- Capture before/after metrics in `test-results/` so trends are easy to compare.

That’s all—run the script, read the JSON, adjust, repeat. Reach out to the benchmark table in the main `README.md` for the latest headline numbers and mitigation ideas.