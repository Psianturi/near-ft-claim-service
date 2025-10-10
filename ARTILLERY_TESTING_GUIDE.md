# Artillery Load Testing Guide

Focused notes on how we exercise the claiming service with Artillery. Keep it light: start the API, run the helper script, read the JSON output, and iterate based on the metrics.

## 1. Prerequisites

- Dependencies installed (`nvm use 24 && npm install`).
- Environment configured: `.env` for sandbox, `.env.testnet` for public network.
- API & worker processes running for the target network (`npm run start:<env>` and, when needed, `npm run run:worker:<env>`).
- For testnet: a FastNEAR API key (Pro tier in this project) and sufficient FT balances for the signer and receivers.

## 2. Running the scenarios

### Sandbox

```bash
# One-click pipeline (deploy, bootstrap receivers, run load + summary)
nvm use 24
./testing/test-complete-pipeline.sh

# 90-second smoke (fast feedback while iterating)
SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh

# Ten-minute benchmark (100 TPS × 600 s)
SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh

# Manual sequence (reusing the generated profile)
npm run start:sandbox        # terminal 1
nvm use 24
ARTILLERY_CONFIG=artillery-local.yml ./testing/artillery/run-artillery-test.sh sandbox  # terminal 2
```

The script stores results as `testing/artillery/artillery-results-sandbox-*.json` and prints `RESULT_JSON=<path>` at the end. When you need to inspect the latest run, capture that line from stdout or read `testing/artillery/.last-artillery-run.log` (written automatically). The pipeline also caches the `near-sandbox` binary under `~/.cache/near-sandbox/`, so it runs safely from WSL mounts or other filesystems without `EXDEV` errors. Override `ARTILLERY_CONFIG` or enable `SANDBOX_BENCHMARK_10M=1` for longer scenarios such as `benchmark-sandbox-10m.yml`.

### Testnet

```bash
nvm use 24
npm run start:testnet        # ensure service is live
nvm use 24
./testing/artillery/run-artillery-test.sh testnet

# Or run the full orchestration (API + worker + load + summary)
./testing/test-complete-pipeline-testnet.sh            # uses .env.testnet
# Custom env or overrides
TEST_DURATION=300 TESTNET_TARGET_TPS=70 ./testing/test-complete-pipeline-testnet.sh path/to/custom.env
```

Use the FastNEAR key in `.env.testnet`. If you add secondary RPC endpoints, list them in `RPC_URLS`.

#### Quick rerun checklist (2025-10-10)

1. **Pastikan konfigurasi terbaru**
   - `TESTNET_TARGET_TPS=50` (default baru) dan `TESTNET_HTTP_TIMEOUT=120` memberi ruang napas ekstra pada FastNEAR.
   - Tambahkan `MAX_IN_FLIGHT_PER_KEY` dan `MASTER_ACCOUNT_PRIVATE_KEYS` secukupnya agar setiap akses key menangani beban seimbang.
2. **Mulai ulang service & worker**
   ```bash
   npm run start:testnet:cluster
   TESTNET_LAUNCH_WORKER=1 npm run run:worker:testnet
   ```
   Pastikan log worker tidak lagi menampilkan "NEAR connection not initialized" setelah perbaikan `src/run-worker.ts`.
3. **Jalankan pipeline**
   ```bash
   TESTNET_TARGET_TPS=50 TESTNET_HTTP_TIMEOUT=120 ./testing/test-complete-pipeline-testnet.sh
   ```
4. **Evaluasi hasil**
   - Cek ringkasan Artillery (`REQUESTS`, `200s`, `errors.*`, `p95`).
   - Tinjau `api-testnet.log` untuk konflik nonce dan `worker-testnet.log` untuk status requeue.
   - Pastikan seluruh kunci pada `MASTER_ACCOUNT_PRIVATE_KEYS` sudah terdaftar on-chain; jalankan bootstrap bila perlu.

## 3. Scenario profile (default `testing/artillery/benchmark-*.yml`)

| Phase | Duration | Target rate |
| --- | --- | --- |
| Warm-up | 30 s | 5 rps |
| Ramp | 60 s | 10 → 50 rps |
| Sustained | 120 s | 100 rps |
| Peak | 60 s | 150 → 200 rps |
| Hyperdrive (optional) | 90 s | 250 → 600 rps |

For quick iterations, `benchmark-sandbox-smoke.yml` trims the run to ~90 seconds (15 s warm-up → 40 TPS sustain). Set `SANDBOX_SMOKE_TEST=1` when invoking `test-complete-pipeline.sh` or pass `ARTILLERY_CONFIG=testing/artillery/benchmark-sandbox-smoke.yml` to `run-artillery-test.sh` directly.

The long-form benchmark under `benchmark-sandbox-10m.yml` extends the sustained phase to 600 seconds at a flat 100 rps after a 10-second warm-up, matching the “100 TPS for 10 minutes” requirement. Expect the full run (pipeline + teardown) to last just over 12 minutes.

**CI runtime tip:** The GitHub Action that drives `benchmark-sandbox.yml` spends ~2 minutes bootstrapping (sandbox start, receiver registration, API validation) before Artillery even begins the 10 minute sustained phase (+45 s warm-up, +60 s ramp, +30 s cooldown). Budget 13–14 minutes for the job to transition from “launch load test” to completion.

Traffic mix: ~70 % single `ft_transfer`, 20 % `/health`, 10 % batch transfers.

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
| Sandbox (single validator key) | 25,800 requests | 158 (0.61 %) | Nonce retries, storage deposits racing against transfers |
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
- In sandbox runs, tune `SANDBOX_MAX_IN_FLIGHT_PER_KEY` (default 4) so each access key signs only a handful of concurrent transactions; increase slowly while watching for `InvalidNonce` spikes.
- Pre-fund receiver accounts and disable the storage check only when you are certain every receiver is registered.
- Use staggered phases (e.g., multiple shorter sustained segments) to observe when bottlenecks appear.
- Capture before/after metrics in `test-results/` so trends are easy to compare.

## 8. Rerun checklist (post logging fix)

1. **Clean up stale processes and logs**
   - Stop any lingering `start:<env>` and `run:worker:<env>` processes.
   - Rotate or archive `service.log`, `worker.log`, and `api.log` so the new run starts with fresh files (the helper `node scripts/prepare-benchmark.mjs --env sandbox` takes care of this automatically).
2. **Set environment overrides**
   - Ensure `LOG_LEVEL=warn` (or lower verbosity) to minimize write volume. The helper prints ready-to-eval `export` commands.
   - Point logs to fast storage: `export PINO_DESTINATION=./service.log` (defaults to synchronous writes).
   - Leave `PINO_SYNC=true` unless you have profiled the filesystem under load; optionally raise `PINO_MIN_LENGTH` only when running async.
3. **Restart API + worker**
   - `NEAR_ENV=sandbox npm run start:sandbox`
   - `NEAR_ENV=sandbox npm run run:worker:sandbox`
4. **Verify health before load**
   - Hit `/health` for liveness and `/metrics/jobs` for queued/submitted counts. Optional: scrape `/metrics` to ensure Prometheus exporters are online and `maxInFlight` matches expectations.
5. **Execute the chosen scenario**
   - For a smoke validation: `SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh`.
   - For the 10-minute benchmark: `SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh`.
6. **Monitor during run**
   - Tail `service.log` for unexpected `warn`/`error` entries; absence of `_flushSync took too long` confirms the fix.
   - Watch `worker.log` for nonce retries or RPC errors.
7. **Collect and compare metrics**
   - Parse Artillery output with `jq '.aggregate' <result>.json`.
   - Note success rate, `errors.ETIMEDOUT`, and latency p95/p99; confirm improvements relative to pre-fix runs.
   - Capture highlights in `ARTILLERY_SANDBOX_RESULTS.md` for historical tracking.

### After the run (CI or local)

- Download the JSON artifact referenced by the pipeline log (for CI, use the "Summarize Artillery results" step or the uploaded artifact bundle).
- Snapshot key metrics (success count, error mix, `p95`/`p99`, mean RPS) into `ARTILLERY_SANDBOX_RESULTS.md` or your notes tracker.
- Compare against the target assertions (`maxErrorRate`, `p95`, `p99`) and flag regressions immediately.
- Record environment context: Node version, key count, throttles, and any kernel/sysctl flags applied during the run.

## 9. Mitigation playbook

When smoke results still show heavy `ETIMEDOUT`/`ECONNRESET`, walk through these levers before re-running the long benchmark:

1. **Runtime prerequisites**
   - Upgrade to Node ≥22.13 so Artillery 2.x and `near-workspaces@5` no longer emit `EBADENGINE` warnings.
   - Apply sandbox kernel tuning by running `sudo ./node_modules/.bin/near-sandbox scripts/set_kernel_params.sh` (or copy the sysctl values manually) to unlock higher socket buffers.
2. **Key pool & concurrency**
   - Ensure `MASTER_ACCOUNT_PRIVATE_KEYS` lists ≥5 sandbox keys. Use the helper (`near-ft-helper/deploy.js`) or `ci/bootstrap-sandbox-accounts.mjs` to mint extras, then export them before launching the worker.
   - Align `WORKER_COUNT` with the key count; drop `MAX_TX_PER_KEY_PER_SECOND` if retries spike.
3. **Arrival shaping**
   - Adjust `benchmark-sandbox-smoke.yml` arrival rates (reduce peak to 20–25 rps) until success rate clears 80%, then ramp up gradually.
   - Increase `BATCH_WINDOW_MS` or lower `MAX_BATCH_SIZE` temporarily to shrink batch signing pressure.
4. **Observability checks**
   - Tail `service.log` and `worker.log` for `InvalidNonce` and retry bursts; inspect `sandbox.log` for RPC stalls.
   - If timeouts persist, switch `/send-ft` validation to a warm-up phase (lower arrival) before sustained load.

That’s all—run the script, read the JSON, adjust, repeat. Reach out to the benchmark table in the main `README.md` for the latest headline numbers and mitigation ideas.
