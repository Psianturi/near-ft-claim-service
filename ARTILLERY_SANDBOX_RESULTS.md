# NEAR FT Claiming Service – Sandbox Performance Results

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