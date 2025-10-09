# NEAR FT Claiming Service – Sandbox Performance Results

## Planned Benchmark (post logging fix)
- **Target date**: _TBD_
- **Command**: `SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh` (smoke validation) followed by `SANDBOX_BENCHMARK_10M=1 ./testing/test-complete-pipeline.sh`
- **Service Preparation**: `node scripts/prepare-benchmark.mjs --env sandbox`
- **Success Criteria**:
  - No occurrences of `_flushSync took too long` in `service.log`
  - `errors.ETIMEDOUT` reduced by ≥90% versus 2025-09-29 run
  - ≥95% scenario completion on 10-minute benchmark (100 TPS)
- **Artifacts to capture**: JSON + HTML reports under `testing/artillery/`, summarized metrics added below once run completes.

## Smoke Validation (2025-10-09)
- **Command**: `SANDBOX_SMOKE_TEST=1 ./testing/test-complete-pipeline.sh`
- **Artifacts**: [`testing/artillery/artillery-results-sandbox-20251009-133510.json`](testing/artillery/artillery-results-sandbox-20251009-133510.json)
- **Service Prep**:
  - Credentials exported from `~/.near-credentials/sandbox/service.test.near.json`
  - `node scripts/prepare-benchmark.mjs --env sandbox`
  - `MASTER_ACCOUNT_PRIVATE_KEYS` set to single helper key
  - Logging directed to synchronous file using `PINO_DESTINATION` (no `_flushSync` warnings observed)

### Key Metrics
| Metric | Value |
| --- | --- |
| Total requests | **3,025** |
| Successful responses (HTTP 200) | **121** |
| Failed responses (HTTP 500) | **257** |
| Scenarios completed | **378** (12.5%) |
| Errors – `ETIMEDOUT` | **2,018** |
| Errors – `ECONNRESET` | **629** |
| Median latency | **12.7 s** |
| 95th percentile latency | **24.1 s** |
| Max latency | **36.4 s** |
| Mean request rate | **24 req/s** |

### Observations
- Logging pipeline stayed healthy—no `_flushSync took too long` events in rotated logs.
- Majority of timeouts occurred under `/send-ft`; health checks mostly succeeded (121 × 200).
- Single signer key (from helper) limits throughput; nonce retries spiked once Artillery ramped beyond ~25 rps.
- Sandbox node emitted kernel tuning warnings (`net.core.rmem_max`, `tcp_rmem` etc.) but remained up; apply `scripts/set_kernel_params.sh` before long-duration runs.
- Artillery 2.x installation threw `EBADENGINE` warnings because Node 18.19.1 is below the required ≥22.13. Upgrade Node before the 10-minute benchmark to avoid incompatibilities.

## CI Benchmark (2025-10-09) – In Progress
- **Workflow Run**: [GitHub Actions benchmark](https://github.com/Psianturi/near-ft-claim-service/actions/workflows/benchmark.yml)
- **Scenario**: `testing/artillery/benchmark-sandbox.yml`
- **Status**: Currently executing sustained 10-minute phase (expect total runtime ~13 minutes from Artillery launch)
- **Next steps once artifacts land**:
  - Download `artillery-results-sandbox-*.json` artifact
  - Extract success rate, error breakdown, latency p95/p99
  - Append summarized metrics to this section and cross-check against `ensure` thresholds

## Latest Benchmark (2025-09-29)
- **Command**: `./testing/artillery/run-artillery-test.sh sandbox`
- **Configuration**: [`testing/artillery/benchmark-sandbox.yml`](testing/artillery/benchmark-sandbox.yml)
- **Service State**:
  - FT contract `ft.test.near` redeployed via `ci/deploy-sandbox-rpc.mjs`
  - Receiver accounts (`user1/2/3.test.near`, `alice.test.near`, `bob.test.near`) bootstrapped with storage deposits
  - API server running locally at `http://127.0.0.1:3000`
- **Artifacts**:
  - JSON summary: [`testing/artillery/artillery-results-sandbox-20250929-123051.json`](testing/artillery/artillery-results-sandbox-20250929-123051.json)
  - HTML report: [`testing/artillery/artillery-report-sandbox-20250929-123051.html`](testing/artillery/artillery-report-sandbox-20250929-123051.html)

### Key Metrics (Aggregated)
| Metric | Value |
| --- | --- |
| Requests completed | **172** |
| Successful responses (HTTP 200) | **139** |
| Failed responses (HTTP 500) | **33** |
| Scenarios attempted | **24,563** |
| Scenarios completed | **147** *(0.60% completion rate)* |
| Timeout errors (`ETIMEDOUT`) | **23,455** |
| Connection resets (`ECONNRESET`) | **936** |
| Median latency | **3.03 s** |
| 95th percentile latency | **9.74 s** |
| Maximum observed latency | **9.98 s** |
| Mean request rate (reported by Artillery) | **87.51 req/s** |

> **Success rate context:** 139 out of 24,563 attempted scenarios completed successfully (≈0.57%), indicating the current scenario intensity overwhelms the local sandbox deployment.

### Observations
- The majority of scenarios timed out before submitting a request, leading to high `ETIMEDOUT` counts and only 147 scenarios finishing. This suggests the configured arrival rates (peaking at 200rps) exceed what the local sandbox and API can sustain.
- 33 responses were HTTP 500. The API logs during the run showed intermittent `ECONNRESET` errors and NEAR transaction panics. These likely stem from RPC back-pressure and workers timing out while the queue is saturated.
- Median latency climbed to ~3 seconds with long tails approaching 10 seconds, confirming heavy queuing and retries under load.
- The API service remained online, but throughput degraded sharply once the stress phase began. Artillery reported 24k+ timeouts despite only 172 requests completing.

### Recommended Next Steps
1. **Right-size the load profile**: Start with lower arrival rates (e.g., peak 40–60 rps) to gather stable baseline metrics before repeating stress phases above 100 rps.
2. **Instrument worker backlog**: Capture queue depth and NEAR RPC response times during the run to correlate with timeouts and 500 errors.
3. **Inspect failure causes**: Tail `server.log` / console output to classify the 500 responses (contract panics vs queue rejections).
4. **Add storage/deposit guards**: If panics continue, ensure receivers are registered ahead of the test or call `storage_deposit` when missing.
5. **Iterate & document**: After tuning, rerun `./testing/artillery/run-artillery-test.sh sandbox` and append results to this report for comparison.

---
*Generated from Artillery run executed on 2025-09-29 at 12:30:51 local time.*