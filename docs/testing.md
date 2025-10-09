# Frontend & Service Testing Strategy

This project layers several automated checks to keep the sample frontend UI and the NEAR FT service healthy. The current strategy focuses on fast feedback for contributors and parity between local development and CI, while ensuring the new persistence-backed transfer coordinator keeps durable job state intact.

## 1. Type safety first

- **Command:** `npm run typecheck`
- **Tooling:** TypeScript (`tsc --noEmit`)
- **Purpose:** Catch mismatched contract payloads, unsafe JSON parsing, and missing environment variables before runtime.
- **When to run:** Automatically in CI and whenever changing TypeScript sources locally.

## 2. Browser UI smoke tests

- **Command:** `npm run test:frontend`
- **Tooling:** Playwright + `http-server`
- **Scope:**
  - Loads `examples/send-ft-frontend` in Chromium.
  - Mocks `/send-ft` and `/health` responses to keep tests deterministic.
  - Asserts request payload formatting, response rendering, loading and error states, the request log panel, and the durability metadata (`jobId`, `transactionHash`, `status`).
- **Why this approach:**
  - Keeps the static demo UI functional without requiring a running NEAR node during tests.
  - Mirrors how real users interact with the `/send-ft` endpoint, including form validation.
  - Headless by default for speed; use `npm run test:frontend:headed` when debugging interactions.
- **CI integration:** Runs on every pull request and push to `main`. Artifacts (HTML report, traces) are uploaded when a failure occurs.

## 3. API integration smoke tests

- **Commands:**
  - `npm run test:sandbox` (near-workspaces powered local chain)
  - `npm run test:testnet` (real FastNEAR RPC)
- **Scope:** Spins up the API, deploys/contracts, executes real `/send-ft` calls, validates on-chain balances, and confirms that persisted jobs can be queried via `/transfer/:jobId`.
- **Usage:** Longer-running checks triggered manually or in dedicated pipelines to avoid leaking secrets.

## 4. Security posture

- **Command:** `npm run security`
- **Tooling:** `audit-ci --fail-on critical`
- **Goal:** Block merges when npm reports critical vulnerabilities; high severity results are surfaced but do not fail the pipeline by default.

## 5. Local developer workflow

```bash
# One-time
npm install
npx playwright install --with-deps

# Fast feedback loop
npm run typecheck
npm run test:frontend
```

- Keep VS Code Playwright or Testing sidebar open for per-test debugging.
- When validating durability end-to-end, run the API and worker locally (`npm run start:<env>` + `npm run run:worker:<env>`) before launching integration tests so persisted jobs get replayed.
- To mimic CI, run all commands together:

```bash
npm run typecheck && npm run security && npm run test:frontend
```

## 6. Roadmap & extensions

- Add visual regression snapshots (Playwright trace viewer) once UI stabilises.
- Expand API coverage with contract-state assertions for storage deposits.
- Wire sandbox load scenarios (`./testing/artillery/run-artillery-test.sh sandbox`) into optional nightly jobs.

## 7. Benchmark & recovery checks

- The sandbox benchmark pipeline (`testing/test-complete-pipeline.sh`) now defaults to `WAIT_UNTIL=Included` for fast confirmations and sets `SANDBOX_MAX_IN_FLIGHT_PER_KEY=6` to keep multiple transactions flying per access key. `WAIT_UNTIL=None` is not supported by the NEAR client shim and will be coerced back to `Included`.
- GitHub Actions passes `ARTILLERY_PROFILE=benchmark-sandbox.yml` so CI exercises the same 10-minute, 100 TPS scenario documented in the README instead of the aggressive local smoke profile.
- After each Artillery run, the script queries `/metrics/jobs` and fails the job if no transfers reach the `submitted` state, catching regressions where the coordinator stalls or all requests time out.
- Local developers can mimic CI by exporting the same environment variables before launching the API/worker or running `testing/test-complete-pipeline.sh`.

With this structure we balance quick safety nets (type checking & Playwright) against deeper blockchain validation that still relies on existing integration scripts.
