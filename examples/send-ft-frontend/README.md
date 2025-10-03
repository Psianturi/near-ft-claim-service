# NEAR FT Send Demo Frontend

A minimal browser client that calls the `POST /send-ft` endpoint of the NEAR fungible token API service.

## Prerequisites
- A running instance of the API (`npm run start:testnet` or `npm run start:sandbox`).
- Node.js 20+ is recommended for the backend service (matches project requirement).
- Any static file server (e.g. `npx http-server`, `npx serve`, or your favourite dev server).

## Quick start

```bash
# From the ft-claiming-service root
npm run start:testnet
# In another terminal, serve the static frontend
cd examples/send-ft-frontend
npx http-server
```

Open the printed URL (typically http://127.0.0.1:8080). Pick one of the **Quick presets** to fill the API base URL (local sandbox, local testnet, or a remote placeholder) or type your own value. The form remembers the last values you entered via `localStorage` so you only have to set them once per browser.

## API base URL cheatsheet

| Environment | When to use | Base URL example | Notes |
|-------------|-------------|------------------|-------|
| Sandbox (local) | Running `npm run start:sandbox` on the same machine | `http://127.0.0.1:3000` | Only use if every receiver account has already called `storage_deposit`; otherwise the token transfer will panic. |
| Testnet (local runner) | Running `npm run start:testnet` on the same machine | `http://127.0.0.1:3000` | Even though transactions go to NEAR testnet, the REST API still runs locally. |
| Remote deployment | API hosted elsewhere (e.g. EC2, Docker, Fly.io) | `https://your-domain.example.com` | Replace with the public URL where the FT API service is exposed. |

### Which environment should I use?

- **Testnet** is the default for the demo. The contract auto-registers storage as needed (`SKIP_STORAGE_CHECK=false`), so any valid testnet account can receive tokens immediately.
- **Sandbox** is useful for local experiments but requires you to pre-register every receiver with `storage_deposit`. The demo will surface the raw “account is not registered” error when this prerequisite is missing.


## Using the form
1. Enter the target receiver account ID and the amount (in yocto).
2. Optionally add a memo.
3. (Optional) Use the quick preset buttons to switch environments instantly. The selected base URL is logged for traceability.
4. Click **Send tokens** to POST to `/send-ft`.
5. Inspect the **Response** panel for JSON output and use the **Check health** shortcut to hit `/health`.
	- If you see `The account <id> is not registered`, the API was run with storage checks disabled. Either enable them (`SKIP_STORAGE_CHECK=false`) or pre-register the account with `storage_deposit` before retrying.

The request log at the bottom lists each call with a timestamp to help with manual testing and debugging.

## Capturing backend logs

The frontend only reports HTTP status codes. To see the detailed blockchain/queue errors:

```bash
# From ft-claiming-service/
npm run start:testnet           # or npm run start:sandbox
```

Leave this terminal open to stream structured pino logs. For long runs you can redirect output:

```bash
npm run start:testnet | tee api.log
```

Later, inspect with `tail -f api.log` or search for specific error IDs. Each failed request logs the NEAR RPC error, queue rejection, or validation issue.

## Deploying the demo to Vercel

The frontend is a static site, so it works flawlessly on Vercel:

1. Install the Vercel CLI (`npm i -g vercel`) and log in (`vercel login`).
2. From `examples/send-ft-frontend/`, run `vercel` once to create the project. When prompted, choose **Other** → **Static Site**. Build command and output directory can stay empty (Vercel will serve the repo files directly).
3. For production, run `vercel --prod`.

The UI still needs an API base URL. You have two options:

- Ask users to fill in the field manually (default remains `http://127.0.0.1:3000`).
- Or fork the project and hard-code your hosted API URL in `main.js` (update the `value` attribute of the `#apiBase` input) before deploying.

Ensure the deployed API service allows your Vercel domain via `CORS_ALLOW_ORIGINS` (e.g. `CORS_ALLOW_ORIGINS=https://your-vercel-app.vercel.app`).
