#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SERVICE_DIR="$ROOT"

echo "Building service..."
cd "$SERVICE_DIR"
npm run build

echo "Starting service (SKIP_NEAR_INIT=true)..."
SKIP_NEAR_INIT=true node dist/index.js > /tmp/service.log 2>&1 &
PID=$!
echo $PID > /tmp/service.pid
echo "Service started with PID $PID"


    echo "Waiting for server to listen on 3000..."
    for i in {1..10}; do
      ss -ltn | grep :3000 && break || true
      sleep 1
    done

echo "Posting /send-ft..."
RESP=$(curl -sS -X POST http://localhost:3000/send-ft -H 'Content-Type: application/json' -d '{"receiverId":"smoke.test.near","amount":"1"}')
echo "Response: $RESP"

JOBID=$(echo "$RESP" | jq -r '.jobIds[0] // .jobId')
if [ -z "$JOBID" ] || [ "$JOBID" = "null" ]; then
  echo "No jobId returned, abort"
  exit 1
fi

echo "Job created: $JOBID"

echo "Stopping service (PID $PID)..."
kill $PID || true
wait $PID 2>/dev/null || true

echo "Restarting service..."
SKIP_NEAR_INIT=true node dist/index.js > /tmp/service.log 2>&1 &
PID2=$!
echo $PID2 > /tmp/service.pid
echo "Service restarted with PID $PID2"

echo "Polling job status..."
for i in {1..30}; do
  sleep 1
  STATUS=$(curl -sS http://localhost:3000/transfer/$JOBID | jq -r '.job.status // .jobId // empty' || true)
  echo "[$i] status=$STATUS"
  if [ "$STATUS" = "finalized" ] || [ "$STATUS" = "failed" ]; then
    echo "Job completed with status: $STATUS"
    exit 0
  fi
done

echo "Job did not finalize within timeout"
exit 2
