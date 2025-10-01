# Artillery Load Testing Guide

Focused notes on how we exercise the claiming service with Artillery. Keep it light: start the API, run the helper script, read the JSON output, and iterate based on the metrics.

## 1. Prerequisites

- Dependencies installed (`npm install`).
- Environment configured: `.env` for sandbox, `.env.testnet` for public network.
- API & worker processes running for the target network (`npm run start:<env>` and, when needed, `npm run run:worker:<env>`).
- For testnet: a FastNEAR API key (Pro tier in this project) and sufficient FT balances for the signer and receivers.

## 2. Running the scenarios

### Sandbox

```bash
# One-click pipeline (deploy, bootstrap, load test)
./test-complete-pipeline.sh

# Manual sequence
npm run start:sandbox        # terminal 1
./run-artillery-test.sh sandbox  # terminal 2
```

The script stores results as `artillery-results-sandbox-*.json`.

### Testnet

```bash
npm run start:testnet        # ensure service is live
./run-artillery-test.sh testnet
```

Use the FastNEAR key in `.env.testnet`. If you add secondary RPC endpoints, list them in `RPC_URLS`.

## 3. Scenario profile (default `benchmark-*.yml`)

| Phase | Duration | Target rate |
| --- | --- | --- |
| Warm-up | 30 s | 5 rps |
| Ramp | 60 s | 10 → 50 rps |
| Sustained | 120 s | 100 rps |
| Peak | 60 s | 150 → 200 rps |

Traffic mix: ~70 % single `ft_transfer`, 20 % `/health`, 10 % batch transfers.

Adapt the YAML if you need a calmer profile (e.g., lower the peak to 40–60 rps when validating sandbox changes).

## 4. Reading the results

1. Inspect the summary printed by `run-artillery-test.sh` (total requests, success count, error distribution).
2. For deeper analysis, open the JSON:
   ```bash
   jq '.aggregate' artillery-results-<env>-<timestamp>.json
   ```
3. Optional HTML report:
   ```bash
   npx artillery@latest report artillery-results-<env>-<timestamp>.json
   ```

Key metrics to watch:
- **Success count / success rate** – the effective TPS.
- **`http.response_time` p95/p99** – end-to-end latency under load.
- **`errors.*` counters** – tells you whether the bottleneck is RPC, contract logic, or client timeouts.

## 5. Recent observations (2025‑10‑01)

| Environment | Load | Successes | Main blockers |
| --- | --- | --- | --- |
| Sandbox (8 workers, 3 keys) | 13,950 requests | 39 (0.28 %) | Nonce retries, receivers running out of FT balance |
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

- Keep the worker count and key pool aligned (N workers ⇒ N keys).
- Pre-fund receiver accounts and disable the storage check only when you are certain every receiver is registered.
- Use staggered phases (e.g., multiple shorter sustained segments) to observe when bottlenecks appear.
- Capture before/after metrics in `test-results/` so trends are easy to compare.

That’s all—run the script, read the JSON, adjust, repeat. Reach out to the benchmark table in the main `README.md` for the latest headline numbers and mitigation ideas.