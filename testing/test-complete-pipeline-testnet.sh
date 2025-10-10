#!/bin/bash
# Complete Testnet Testing Script for FT Service with Artillery
# Orchestrates environment validation, service startup, sanity checks, and load testing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTILLERY_DIR="$PROJECT_ROOT/testing/artillery"
DEFAULT_ENV_FILE="$PROJECT_ROOT/.env.testnet"

cd "$PROJECT_ROOT"

# Colours for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_success() { echo -e "${GREEN}✅ $1${NC}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }
mask_value() {
  local value="$1"
  if [ -z "$value" ]; then
    return
  fi
  if [ ${#value} -le 8 ]; then
    echo "${value:0:1}****"
    return
  fi
  echo "${value:0:4}****${value: -4}"
}

check_port() {
  local port=$1
  if command -v lsof >/dev/null 2>&1 && lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

kill_port() {
  local port=$1
  if ! command -v lsof >/dev/null 2>&1; then
    return
  fi
  local pids
  pids=$(lsof -ti:"$port" || true)
  if [ -n "$pids" ]; then
    log_info "🔪 Menghentikan proses pada port $port: $pids"
    kill -9 $pids 2>/dev/null || true
    sleep 2
  fi
}

kill_worker_processes() {
  local pids
  pids=$(pgrep -f "run-worker.ts" || true)
  if [ -n "$pids" ]; then
    log_info "🔪 Menghentikan worker lama: $pids"
    kill $pids 2>/dev/null || true
    sleep 2
  fi
}

wait_for_service() {
  local url=$1
  local max_attempts=$2
  local label=${3:-Service}
  for i in $(seq 1 "$max_attempts"); do
    if curl -sS "$url" >/dev/null 2>&1; then
      log_success "$label siap"
      return 0
    fi
    log_info "Menunggu $label... ($i/$max_attempts)"
    sleep 3
  done
  log_error "$label gagal siap dalam $((max_attempts * 3)) detik"
  return 1
}

# -----------------------------------------------------------------------------
# 1. Environment preparation
# -----------------------------------------------------------------------------
ENV_FILE=${ENV_FILE:-$DEFAULT_ENV_FILE}
if [ ! -f "$ENV_FILE" ]; then
  log_error "Environment file not found: $ENV_FILE"
  exit 1
fi

log_info "Loading environment from $ENV_FILE"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

NEAR_ENV=${NEAR_ENV:-testnet}
if [ "$NEAR_ENV" != "testnet" ]; then
  log_warning "NEAR_ENV is '$NEAR_ENV' (expected 'testnet'). Overriding for this session."
  export NEAR_ENV=testnet
fi

PORT=${PORT:-3000}
API_URL="http://127.0.0.1:$PORT"
NODE_URL=${NODE_URL:-https://rpc.testnet.fastnear.com}
TARGET_TPS=${TESTNET_TARGET_TPS:-50}
HEADROOM_PERCENT=${TESTNET_HEADROOM_PERCENT:-90}
TESTNET_TEST_DURATION=${TESTNET_TEST_DURATION:-300}
TESTNET_WARMUP_DURATION=${TESTNET_WARMUP_DURATION:-60}
TESTNET_RAMP_DURATION=${TESTNET_RAMP_DURATION:-60}
TESTNET_COOLDOWN_DURATION=${TESTNET_COOLDOWN_DURATION:-30}
TESTNET_HTTP_TIMEOUT=${TESTNET_HTTP_TIMEOUT:-120}
TESTNET_HTTP_POOL=${TESTNET_HTTP_POOL:-150}
TESTNET_HTTP_MAX_SOCKETS=${TESTNET_HTTP_MAX_SOCKETS:-400}
TESTNET_USE_CLUSTER=${TESTNET_USE_CLUSTER:-1}
CLUSTER_WORKERS=${TESTNET_CLUSTER_WORKERS:-${CLUSTER_WORKERS:-}}
TESTNET_LAUNCH_WORKER=${TESTNET_LAUNCH_WORKER:-1}
ARTILLERY_PROFILE=${ARTILLERY_PROFILE:-benchmark-testnet-generated.yml}
ARTILLERY_CONFIG_PATH="$ARTILLERY_DIR/$ARTILLERY_PROFILE"
TESTNET_RECEIVER_LIST=${TESTNET_RECEIVER_LIST:-"posma-badge.testnet"}
TESTNET_AMOUNT_OPTIONS=${TESTNET_AMOUNT_OPTIONS:-"100000000,500000000,1000000000"}
TESTNET_FORCE_CLEANUP=${TESTNET_FORCE_CLEANUP:-1}
TESTNET_RESET_LOGS=${TESTNET_RESET_LOGS:-0}
API_LOG=${API_LOG:-api-testnet.log}
WORKER_LOG=${WORKER_LOG:-worker-testnet.log}

REQUIRED_ENV=(
  MASTER_ACCOUNT
  MASTER_ACCOUNT_PRIVATE_KEY
  MASTER_ACCOUNT_PRIVATE_KEYS
  FT_CONTRACT
  FASTNEAR_API_KEY
  NODE_URL
)

missing_env=()
for var in "${REQUIRED_ENV[@]}"; do
  if [ -z "${!var:-}" ]; then
    missing_env+=("$var")
  fi
done

if [ ${#missing_env[@]} -gt 0 ]; then
  log_error "Missing required environment variables: ${missing_env[*]}"
  exit 1
fi

SUSTAINED_DURATION=$(( TESTNET_TEST_DURATION - TESTNET_WARMUP_DURATION - TESTNET_RAMP_DURATION ))
if [ "$SUSTAINED_DURATION" -lt 60 ]; then
  log_warning "Computed sustained duration under 60s; adjusting to 60s"
  SUSTAINED_DURATION=60
fi
TOTAL_DURATION=$(( TESTNET_WARMUP_DURATION + TESTNET_RAMP_DURATION + SUSTAINED_DURATION + TESTNET_COOLDOWN_DURATION ))

log_info "🚀 Starting Complete FT Service Testnet Pipeline"
log_info "📋 Configuration:" 
log_info "   - API Port: $PORT" 
log_info "   - Node URL: $NODE_URL" 
log_info "   - Master Account: $MASTER_ACCOUNT" 
log_info "   - FT Contract: $FT_CONTRACT"
log_info "   - Target TPS: $TARGET_TPS (headroom ${HEADROOM_PERCENT}%)" 
log_info "   - Phase durations (warm/ramp/sustain/cool): ${TESTNET_WARMUP_DURATION}/${TESTNET_RAMP_DURATION}/${SUSTAINED_DURATION}/${TESTNET_COOLDOWN_DURATION} (total ≈ ${TOTAL_DURATION}s)" 
log_info "   - Cluster mode: ${TESTNET_USE_CLUSTER} (workers=${CLUSTER_WORKERS:-auto})"
log_info "   - Worker enabled: ${TESTNET_LAUNCH_WORKER}"
log_info "   - FASTNEAR key prefix: $(mask_value "$FASTNEAR_API_KEY")"

# -----------------------------------------------------------------------------
# 2. Helpers
# -----------------------------------------------------------------------------

cleanup() {
  local exit_code=$?
  log_info "Cleaning up processes..."
  if [ -n "${ARTILLERY_PID:-}" ] && kill -0 "$ARTILLERY_PID" 2>/dev/null; then
    kill "$ARTILLERY_PID" 2>/dev/null || true
  fi
  if [ -n "${API_PID:-}" ] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [ -n "${WORKER_PID:-}" ] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  if [ "${TESTNET_FORCE_CLEANUP:-1}" = "1" ]; then
    kill_port "$PORT"
    kill_worker_processes
  fi
  exit "$exit_code"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Required command not found: $1"
    exit 1
  fi
}

require_command curl
require_command jq
require_command lsof
require_command npm
require_command node

# -----------------------------------------------------------------------------
# 3. Generate Artillery profile
# -----------------------------------------------------------------------------

WARMUP_RAMP_TARGET=$(( TARGET_TPS / 2 ))
if [ "$WARMUP_RAMP_TARGET" -lt 10 ]; then
  WARMUP_RAMP_TARGET=10
fi
if [ "$HEADROOM_PERCENT" -lt 10 ] || [ "$HEADROOM_PERCENT" -gt 100 ]; then
  HEADROOM_PERCENT=90
fi

ARTILLERY_TARGET_TPS=$(( TARGET_TPS * HEADROOM_PERCENT / 100 ))
if [ "$ARTILLERY_TARGET_TPS" -lt 1 ]; then
  ARTILLERY_TARGET_TPS=1
fi
if [ "$ARTILLERY_TARGET_TPS" -gt "$TARGET_TPS" ]; then
  ARTILLERY_TARGET_TPS=$TARGET_TPS
fi

SUSTAINED_RATE=$ARTILLERY_TARGET_TPS
RAMP_START_RATE=$(( WARMUP_RAMP_TARGET > 10 ? WARMUP_RAMP_TARGET : 10 ))
COOLDOWN_TARGET=$(( RAMP_START_RATE > 5 ? RAMP_START_RATE : 5 ))

IFS=',' read -ra RECEIVERS <<< "$TESTNET_RECEIVER_LIST"
IFS=',' read -ra AMOUNTS <<< "$TESTNET_AMOUNT_OPTIONS"

log_info "🛠️  Generating Artillery profile at $ARTILLERY_CONFIG_PATH"
cat > "$ARTILLERY_CONFIG_PATH" <<EOF
config:
  target: '$API_URL'
  http:
    timeout: $TESTNET_HTTP_TIMEOUT
    pool: $TESTNET_HTTP_POOL
    maxSockets: $TESTNET_HTTP_MAX_SOCKETS
  phases:
    - duration: $TESTNET_WARMUP_DURATION
      arrivalRate: 5
      rampTo: $WARMUP_RAMP_TARGET
      name: "Warm-up"
    - duration: $TESTNET_RAMP_DURATION
      arrivalRate: $RAMP_START_RATE
      rampTo: $ARTILLERY_TARGET_TPS
      name: "Ramp to Target"
    - duration: $SUSTAINED_DURATION
      arrivalRate: $SUSTAINED_RATE
      name: "Sustained Load"
    - duration: $TESTNET_COOLDOWN_DURATION
      arrivalRate: $SUSTAINED_RATE
      rampTo: $COOLDOWN_TARGET
      name: "Cool-down"
  variables:
    receiverId:
EOF
for receiver in "${RECEIVERS[@]}"; do
  echo "      - \"$receiver\"" >> "$ARTILLERY_CONFIG_PATH"
done
cat >> "$ARTILLERY_CONFIG_PATH" <<EOF
    amount:
EOF
for amount in "${AMOUNTS[@]}"; do
  echo "      - \"$amount\"" >> "$ARTILLERY_CONFIG_PATH"
done
cat >> "$ARTILLERY_CONFIG_PATH" <<'EOF'
scenarios:
  - name: "Single FT Transfer"
    weight: 80
    flow:
      - post:
          url: "/send-ft"
          headers:
            Content-Type: "application/json"
          json:
            receiverId: "{{ receiverId }}"
            amount: "{{ amount }}"
            memo: "Testnet load {{ $timestamp }}"
          expect:
            - statusCode: [200, 400, 409, 429, 500]
  - name: "Batch FT Transfer"
    weight: 10
    flow:
      - post:
          url: "/send-ft"
          headers:
            Content-Type: "application/json"
          json:
            transfers:
              - receiverId: "{{ receiverId }}"
                amount: "{{ amount }}"
                memo: "Batch test A"
              - receiverId: "{{ receiverId }}"
                amount: "{{ amount }}"
                memo: "Batch test B"
          expect:
            - statusCode: [200, 400, 409, 429, 500]
  - name: "Health Check"
    weight: 10
    flow:
      - get:
          url: "/health"
          expect:
            - statusCode: 200
ensure:
  maxErrorRate: 25
  p95: 15000
  p99: 30000
EOF

# -----------------------------------------------------------------------------
# 4. Start services
# -----------------------------------------------------------------------------

if [ "$TESTNET_FORCE_CLEANUP" = "1" ]; then
  log_info "🧹 Membersihkan proses lokal sebelum start"
  kill_port "$PORT"
  kill_worker_processes
fi

if [ "$TESTNET_RESET_LOGS" = "1" ]; then
  log_info "🧾 Mengosongkan log API/worker"
  : > "$API_LOG" || true
  : > "$WORKER_LOG" || true
fi

log_info "🔧 Preparing runtime..."
export NODE_URL
export MASTER_ACCOUNT
export MASTER_ACCOUNT_PRIVATE_KEY
export MASTER_ACCOUNT_PRIVATE_KEYS
export FT_CONTRACT
export FASTNEAR_API_KEY
export NEAR_SIGNER_ACCOUNT_ID=${NEAR_SIGNER_ACCOUNT_ID:-$MASTER_ACCOUNT}
export NEAR_SIGNER_ACCOUNT_PRIVATE_KEY=${NEAR_SIGNER_ACCOUNT_PRIVATE_KEY:-$MASTER_ACCOUNT_PRIVATE_KEY}
export NEAR_CONTRACT_ACCOUNT_ID=${NEAR_CONTRACT_ACCOUNT_ID:-$FT_CONTRACT}
export NEAR_NODE_URL=$NODE_URL

# Optional: setup test accounts
if [ "${TESTNET_SETUP_ACCOUNTS:-0}" = "1" ]; then
  log_info "👥 Setting up test accounts..."
  NEAR_NETWORK_CONNECTION=testnet node ci/setup-test-accounts.mjs || log_warning "Test account setup failed; proceeding"
fi

# Start API
if [ "$TESTNET_USE_CLUSTER" = "1" ]; then
  log_info "🌐 Launching API in cluster mode"
  if [ -n "$CLUSTER_WORKERS" ]; then
    CLUSTER_WORKERS=$CLUSTER_WORKERS npm run start:testnet:cluster > "$API_LOG" 2>&1 &
  else
    npm run start:testnet:cluster > "$API_LOG" 2>&1 &
  fi
else
  log_info "🌐 Launching API in single-process mode"
  npm run start:testnet > "$API_LOG" 2>&1 &
fi
API_PID=$!

# Start worker (optional)
SHOULD_LAUNCH_WORKER=0
case "${TESTNET_LAUNCH_WORKER,,}" in
  1|true|yes|on)
    SHOULD_LAUNCH_WORKER=1
    ;;
esac

if [ "$SHOULD_LAUNCH_WORKER" -eq 1 ]; then
  log_info "🧵 Launching worker"
  npm run run:worker:testnet > "$WORKER_LOG" 2>&1 &
  WORKER_PID=$!
else
  log_info "🧵 Worker launch skipped (TESTNET_LAUNCH_WORKER=$TESTNET_LAUNCH_WORKER)"
fi

if ! wait_for_service "$API_URL/health" 40 "API service"; then
  log_error "API failed to become healthy. See $API_LOG"
  tail -n 40 "$API_LOG" || true
  exit 1
fi

# -----------------------------------------------------------------------------
# 5. Sanity checks
# -----------------------------------------------------------------------------

log_info "🧪 Running API validation tests..."

if curl -sS "$API_URL/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
  log_success "Health check passed"
else
  log_error "Health check failed"
  exit 1
fi

INVALID_RESPONSE=$(curl -sS -w "%{http_code}" -o /tmp/invalid-testnet.json \
  -X POST "$API_URL/send-ft" \
  -H "Content-Type: application/json" \
  -d '{"receiverId":"invalid..account","amount":"1000000"}')
if [ "$INVALID_RESPONSE" = "400" ]; then
  log_success "Invalid receiver validation passed"
else
  log_warning "Invalid receiver validation returned HTTP $INVALID_RESPONSE"
  cat /tmp/invalid-testnet.json
fi

log_success "Sanity checks complete"

# -----------------------------------------------------------------------------
# 6. Execute Artillery
# -----------------------------------------------------------------------------

log_info "🚀 Launching Artillery load test (testnet profile)..."
export ARTILLERY_CONFIG="$ARTILLERY_CONFIG_PATH"
ARTILLERY_LOG="$ARTILLERY_DIR/.last-artillery-run-testnet.log"
if "$ARTILLERY_DIR/run-artillery-test.sh" testnet | tee "$ARTILLERY_LOG"; then
  RESULT_FILE=$(grep 'RESULT_JSON=' "$ARTILLERY_LOG" | tail -n 1 | cut -d'=' -f2-)
  if [ -n "$RESULT_FILE" ] && [ -f "$RESULT_FILE" ]; then
    RESULT_PATH="$RESULT_FILE"
  else
    RESULT_PATH=$(ls -t "$ARTILLERY_DIR"/artillery-results-testnet-*.json 2>/dev/null | head -n 1)
  fi

  if [ -z "$RESULT_PATH" ] || [ ! -f "$RESULT_PATH" ]; then
    log_error "Unable to locate Artillery result file"
    exit 1
  fi

  log_success "Artillery load test completed. Results: $RESULT_PATH"
  if command -v jq >/dev/null 2>&1; then
    echo ""
    echo "📈 Artillery summary (via jq):"
    jq -r '
      def counter(key): (.aggregate.counters[key] // 0);
      def rate(key): (.aggregate.rates[key] // 0);
      def summary(key): (.aggregate.summaries[key] // {});
      def sum4xx:
          ( .aggregate.counters
                | to_entries
                | map(select(.key | startswith("http.codes.4")))
                | map(.value)
                | add ) // 0;
      "Requests: \(counter("http.requests"))",
      "200s: \(counter("http.codes.200"))",
      "4xx: \(sum4xx)",
      "5xx: \(counter("http.codes.500"))",
      "ETIMEDOUT: \(counter("errors.ETIMEDOUT"))",
      "ECONNRESET: \(counter("errors.ECONNRESET"))",
      "p95 latency: \(summary("http.response_time").p95 // 0) ms",
      "Mean RPS: \(rate("http.request_rate"))"
    ' "$RESULT_PATH"
  fi
else
  log_error "Artillery load test failed"
  exit 1
fi

echo ""
echo "🎯 Testnet load pipeline completed"
log_success "🎉 Complete FT service testnet pipeline finished successfully!"
