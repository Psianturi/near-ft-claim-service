# Continuous Integration Overview

## Primary workflow: `CI`

Triggered on every push to `main` and on pull requests.

Steps:
1. **Install dependencies** – `npm ci` with node 20.x cache.
2. **Playwright install** – `npx playwright install --with-deps` to provision headless Chromium.
3. **Build TypeScript** – `npm run build` guarantees the code compiles before tests.
4. **Type check** – `npm run typecheck` to validate TypeScript types.
5. **Sandbox integration tests** – `npm run test:sandbox` spins up near-workspaces inside the runner and exercises `/send-ft` end-to-end.
6. **Security audit** – `npm run security` (`audit-ci --fail-on critical`). High severity issues surface in logs but do not fail unless marked critical.
7. **Frontend smoke tests** – `npm run test:frontend` ensures the static UI remains functional.
8. **Artifacts** – On failure, uploads `playwright-report/` and sandbox logs for debugging.

Environment: GitHub-hosted Ubuntu runners (Node.js 20). No blockchain access required—the sandbox chain is created in-process via `near-workspaces`.

## Local vs CI parity

- Developers run `npm run typecheck && npm run security && npm run test:frontend` locally to match CI.
- Integration pipelines (`npm run test:sandbox`, `npm run test:testnet`) remain available locally for deeper checks outside the standard CI loop. CI already covers the sandbox path on every push.
- The dedicated **Sandbox Benchmark** GitHub Action reuses `testing/test-complete-pipeline.sh` with `ARTILLERY_PROFILE=benchmark-sandbox.yml`, `WAIT_UNTIL=Included`, and `SANDBOX_MAX_IN_FLIGHT_PER_KEY=6`. It also verifies `/metrics` after the load test to ensure jobs actually reach the `submitted` state. Run the same script locally to reproduce benchmark behaviour.

## Secrets required

- None for the standard CI workflow. All sandbox accounts are generated on the fly.
- Optional: add `TESTNET_PRIVATE_KEY`, `MASTER_ACCOUNT`, etc. only if you wire an additional testnet workflow in the future.

Store secrets in **Settings → Secrets and variables → Actions** if you later reintroduce external environments.
