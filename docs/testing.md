# Frontend & Service Testing Strategy

This project layers several automated checks to keep the sample frontend UI and the NEAR FT service healthy. The current strategy focuses on fast feedback for contributors and parity between local development and CI.

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
  - Asserts request payload formatting, response rendering, loading and error states, and the request log panel.
- **Why this approach:**
  - Keeps the static demo UI functional without requiring a running NEAR node during tests.
  - Mirrors how real users interact with the `/send-ft` endpoint, including form validation.
  - Headless by default for speed; use `npm run test:frontend:headed` when debugging interactions.
- **CI integration:** Runs on every pull request and push to `main`. Artifacts (HTML report, traces) are uploaded when a failure occurs.

## 3. API integration smoke tests

- **Commands:**
  - `npm run test:sandbox` (near-workspaces powered local chain)
  - `npm run test:testnet` (real FastNEAR RPC)
- **Scope:** Spins up the API, deploys/contracts, executes real `/send-ft` calls, and validates on-chain balances.
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
yarn?  # (optional alternative)
npm run typecheck
npm run test:frontend
```

- Keep VS Code Playwright or Testing sidebar open for per-test debugging.
- To mimic CI, run all commands together:

```bash
npm run typecheck && npm run security && npm run test:frontend
```

## 6. Roadmap & extensions

- Add visual regression snapshots (Playwright trace viewer) once UI stabilises.
- Expand API coverage with contract-state assertions for storage deposits.
- Wire sandbox load scenarios (`./run-artillery-test.sh sandbox`) into optional nightly jobs.

With this structure we balance quick safety nets (type checking & Playwright) against deeper blockchain validation that still relies on existing integration scripts.
