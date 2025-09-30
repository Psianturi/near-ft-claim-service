# Continuous Integration Overview

## Primary workflow: `CI`

Triggered on every push to `main` and on pull requests.

Steps:
1. **Install dependencies** – `npm ci` with node 20.x cache.
2. **Playwright install** – `npx playwright install --with-deps` to provision headless Chromium.
3. **Type check** – `npm run typecheck` to validate TypeScript types.
4. **Security audit** – `npm run security` (`audit-ci --fail-on critical`). High severity issues surface in logs but do not fail unless marked critical.
5. **Frontend smoke tests** – `npm run test:frontend` ensures the static UI remains functional.
6. **Artifacts** – On failure, uploads `playwright-report/` for debugging.

Environment: GitHub-hosted Ubuntu runners (Node.js 20). No blockchain access required.

## Secondary workflow: `Sandbox Integration (CI)`

Runs on schedule (daily at 01:00 WIB), on demand via **Run workflow**, and automatically when FT source files change.

Flow:
- Uses `near-workspaces` to spin up an ephemeral sandbox chain directly inside the GitHub runner.
- Executes `npm run test:sandbox`, which deploys the FT contract, registers accounts, calls `/send-ft` thrice, and asserts the resulting balances.
- Fails fast if the API cannot boot, storage deposits regress, or transfers stop succeeding.

Environment choice: **Sandbox** keeps CI self-contained—no external RPC credentials required and deterministic chain state for every run. Testnet runs remain available via `npm run test:testnet` when you need production parity.

## Local vs CI parity

- Developers run `npm run typecheck && npm run security && npm run test:frontend` locally to match CI.
- Integration pipelines (`npm run test:sandbox`, `npm run test:testnet`) are still available for deeper checks outside the standard CI loop.

## Secrets required

- None for the sandbox workflow. All accounts are generated on the fly.
- Optional: add `TESTNET_PRIVATE_KEY`, `MASTER_ACCOUNT`, etc. only if you wire an additional testnet workflow in the future.

Store secrets in **Settings → Secrets and variables → Actions** if you later reintroduce external environments.
