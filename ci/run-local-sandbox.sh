#!/usr/bin/env bash
set -euo pipefail

# Local-first Sandbox + Deploy + Service test runner
# - Works on Windows/WSL by forcing TMPDIR/HOME inside project to avoid EXDEV rename issues
# - Deploys FT to test.near (no subaccount creation) to avoid signerId undefined path
# - Starts API service and performs a test transfer

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Local Sandbox Runner =="
echo "Project: $ROOT_DIR"
cd "$ROOT_DIR"

# 1) Prepare local TMP and HOME to avoid cross-device rename errors on WSL/Windows mounts
mkdir -p .tmp .home
export TMPDIR="$ROOT_DIR/.tmp"
export HOME="$ROOT_DIR/.home"

echo "TMPDIR=$TMPDIR"
echo "HOME=$HOME"

# 2) Start near-sandbox (init + run)
echo "== Starting near-sandbox =="
npx near-sandbox init || true
nohup npx near-sandbox run > neard-local.log 2>&1 &
sleep 2

# 3) Wait for RPC
echo "== Waiting for sandbox RPC (127.0.0.1:3030) =="
for i in $(seq 1 60); do
  if curl -sS http://127.0.0.1:3030/status >/dev/null 2>&1; then
    echo "✅ sandbox ready"
    break
  fi
  sleep 1
done
curl -sS http://127.0.0.1:3030/status || (echo "❌ sandbox not responding"; tail -n +1 neard-local.log; exit 1)

# 4) Deploy FT to test.near (no subaccount creation)
export NODE_URL="${NODE_URL:-http://127.0.0.1:3030}"
export MASTER_ACCOUNT="${MASTER_ACCOUNT:-test.near}"
export FT_CONTRACT="${FT_CONTRACT:-test.near}"
export RECEIVER_ID="${RECEIVER_ID:-$MASTER_ACCOUNT}"

echo "== Deploy FT via RPC =="
echo "NODE_URL=$NODE_URL"
echo "MASTER_ACCOUNT=$MASTER_ACCOUNT"
echo "FT_CONTRACT=$FT_CONTRACT"
echo "RECEIVER_ID=$RECEIVER_ID"

node ci/deploy-sandbox-rpc.mjs

echo "✅ Deploy finished"

# 5) Start API service and wait for health
echo "== Starting API service (sandbox) =="
NEAR_ENV=sandbox npm run start:sandbox > service-local.log 2>&1 &
sleep 2

for i in $(seq 1 60); do
  if curl -sS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "✅ service up"
    break
  fi
  echo "⏳ waiting service ($i/60)"
  sleep 1
done

if ! curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
  echo "❌ service not responding"
  echo "----- service-local.log (tail) -----"
  tail -n 200 service-local.log || true
  exit 1
fi

# 6) Test transfer to RECEIVER_ID
echo "== Testing /send-ft endpoint =="
RES=$(curl -s -X POST http://127.0.0.1:3000/send-ft \
  -H "Content-Type: application/json" \
  -d "{\"receiverId\":\"${RECEIVER_ID}\",\"amount\":\"1000000\",\"memo\":\"local test\"}" || echo "connection_error")

echo "API Response: $RES"

if echo "$RES" | grep -q '"message"' && echo "$RES" | grep -q "FT transfer"; then
  echo "✅ Local FT transfer test passed"
else
  echo "⚠️ Local FT transfer test did not match success pattern"
  exit 1
fi

echo "== Done =="